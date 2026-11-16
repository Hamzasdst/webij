// Webspace Worker - Private HTML Library + Public Hosting
// Security: Admin auth via Bearer token (ADMIN_KEY secret)

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_EXTENSIONS = ['.html', '.htm'];

// Metadata storage: Since no D1/KV is used, store metadata as R2 custom metadata
// Keys: pages/{id}.html, customMetadata: { filename, uploadedAt, isPublic }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requireAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  return token === env.ADMIN_KEY;
}

function generateId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS for API
    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          }
        });
      }
    }

    // ========== API Routes ==========

    // Login verification
    if (path === '/api/login' && request.method === 'POST') {
      const body = await request.json();
      if (body.key === env.ADMIN_KEY) {
        return json({ ok: true });
      }
      return json({ error: 'Invalid key' }, 401);
    }

    // Upload page
    if (path === '/api/upload' && request.method === 'POST') {
      if (!requireAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return json({ error: 'No file' }, 400);

      const name = file.name.toLowerCase();
      const ext = ALLOWED_EXTENSIONS.find(e => name.endsWith(e));
      if (!ext) return json({ error: 'Only .html/.htm allowed' }, 400);

      if (file.size > MAX_FILE_SIZE) return json({ error: 'File too large (max 1MB)' }, 400);

      const id = generateId();
      const key = `pages/${id}.html`;
      const content = await file.text();

      await env.PAGES_BUCKET.put(key, content, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        customMetadata: {
          filename: file.name,
          uploadedAt: new Date().toISOString(),
          isPublic: 'false',
        }
      });

      return json({ ok: true, id, filename: file.name });
    }

    // List pages (admin)
    if (path === '/api/pages' && request.method === 'GET') {
      if (!requireAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

      const listed = await env.PAGES_BUCKET.list({ prefix: 'pages/' });
      const pages = listed.objects.map(obj => {
        const meta = obj.customMetadata || {};
        const id = obj.key.replace('pages/', '').replace('.html', '');
        return {
          id,
          filename: meta.filename || 'untitled',
          uploadedAt: meta.uploadedAt || '',
          isPublic: meta.isPublic === 'true',
        };
      });
      return json({ pages });
    }

    // Public gallery (no auth)
    if (path === '/api/public/pages' && request.method === 'GET') {
      const listed = await env.PAGES_BUCKET.list({ prefix: 'pages/' });
      const pages = listed.objects
        .filter(obj => obj.customMetadata?.isPublic === 'true')
        .map(obj => {
          const meta = obj.customMetadata || {};
          const id = obj.key.replace('pages/', '').replace('.html', '');
          return { id, filename: meta.filename || 'untitled' };
        });
      return json({ pages });
    }

    // Toggle publish status
    if (path.match(/^\/api\/pages\/[^/]+\/publish$/) && request.method === 'PUT') {
      if (!requireAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

      const id = path.split('/')[3];
      const key = `pages/${id}.html`;
      const obj = await env.PAGES_BUCKET.get(key);
      if (!obj) return json({ error: 'Not found' }, 404);

      const body = await request.json();
      const isPublic = body.isPublic === true ? 'true' : 'false';

      // Re-put with updated metadata (preserve body)
      const content = await obj.text();
      await env.PAGES_BUCKET.put(key, content, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        customMetadata: {
          ...obj.customMetadata,
          isPublic,
        }
      });

      return json({ ok: true, isPublic: isPublic === 'true' });
    }

    // Delete page
    if (path.match(/^\/api\/pages\/[^/]+$/) && request.method === 'DELETE') {
      if (!requireAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

      const id = path.split('/')[3];
      await env.PAGES_BUCKET.delete(`pages/${id}.html`);
      return json({ ok: true });
    }

    // ========== Public Page Serving ==========

    // /p/:id — public page view
    if (path.startsWith('/p/')) {
      const id = path.slice(3);
      const key = `pages/${id}.html`;
      const obj = await env.PAGES_BUCKET.get(key);

      if (!obj) return new Response('Not Found', { status: 404 });

      const meta = obj.customMetadata || {};
      if (meta.isPublic !== 'true') {
        return new Response('Not Found', { status: 404 });
      }

      const html = await obj.text();
      // Serve inside a full-page response with CSP sandbox
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; img-src *; script-src 'unsafe-inline';",
          'X-Frame-Options': 'DENY',
        }
      });
    }

    // Static assets fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
