let adminKey = '';
let allPages = [];

const $ = (s) => document.querySelector(s);

// Login
$('#login-btn').addEventListener('click', async () => {
  const key = $('#admin-key').value.trim();
  if (!key) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      adminKey = key;
      sessionStorage.setItem('ws_key', key);
      showDashboard();
    } else {
      $('#login-error').textContent = 'Invalid key';
    }
  } catch {
    $('#login-error').textContent = 'Connection error';
  }
});

// Auto-login
const saved = sessionStorage.getItem('ws_key');
if (saved) { adminKey = saved; showDashboard(); }

function showDashboard() {
  $('#login-view').classList.remove('active');
  $('#dashboard-view').classList.add('active');
  loadPages();
}

$('#logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('ws_key');
  adminKey = '';
  location.reload();
});

// Load pages
async function loadPages() {
  const res = await fetch('/api/pages', {
    headers: { 'Authorization': `Bearer ${adminKey}` }
  });
  if (!res.ok) return;
  const data = await res.json();
  allPages = data.pages;
  renderPages();
  updateStats();
}

function updateStats() {
  $('#total-count').textContent = allPages.length;
  $('#private-count').textContent = allPages.filter(p => !p.isPublic).length;
  $('#public-count').textContent = allPages.filter(p => p.isPublic).length;
}

function renderPages() {
  const query = $('#search-input').value.toLowerCase();
  const sort = $('#sort-select').value;

  let filtered = allPages.filter(p => p.filename.toLowerCase().includes(query));
  filtered.sort((a, b) => {
    if (sort === 'newest') return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    if (sort === 'oldest') return new Date(a.uploadedAt) - new Date(b.uploadedAt);
    return a.filename.localeCompare(b.filename);
  });

  const privateList = $('#private-list');
  const publicList = $('#public-list');

  const privatePages = filtered.filter(p => !p.isPublic);
  const publicPages = filtered.filter(p => p.isPublic);

  privateList.innerHTML = privatePages.length ? '' : '<div class="empty-state">No private pages</div>';
  publicList.innerHTML = publicPages.length ? '' : '<div class="empty-state">No published pages</div>';

  privatePages.forEach(p => privateList.appendChild(createCard(p)));
  publicPages.forEach(p => publicList.appendChild(createCard(p)));
}

function createCard(page) {
  const div = document.createElement('div');
  div.className = 'page-card';
  const date = new Date(page.uploadedAt).toLocaleDateString();
  const badge = page.isPublic ? '<span class="badge public">Public</span>' : '<span class="badge private">Private</span>';

  div.innerHTML = `
    <div class="page-info">
      <div class="page-name">${escapeHtml(page.filename)}</div>
      <div class="page-meta">${badge} · ${date}</div>
    </div>
    <div class="page-actions">
      <button class="action-btn" title="Preview" data-action="preview" data-id="${page.id}">👁</button>
      <button class="action-btn" title="Open" data-action="open" data-id="${page.id}">↗</button>
      ${page.isPublic 
        ? `<button class="action-btn" title="Make Private" data-action="unpublish" data-id="${page.id}">🔒</button>
           <button class="action-btn" title="Copy Link" data-action="copy" data-id="${page.id}">🔗</button>`
        : `<button class="action-btn" title="Publish" data-action="publish" data-id="${page.id}">🌐</button>`
      }
      <button class="action-btn danger" title="Delete" data-action="delete" data-id="${page.id}">🗑</button>
    </div>
  `;

  div.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id));
  });

  return div;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function handleAction(action, id) {
  if (action === 'preview' || action === 'open') {
    window.open(`/p/${id}`, '_blank');
    return;
  }

  if (action === 'copy') {
    const url = `${location.origin}/p/${id}`;
    await navigator.clipboard.writeText(url);
    toast('Link copied');
    return;
  }

  if (action === 'delete') {
    if (!confirm('Delete this page permanently?')) return;
    await fetch(`/api/pages/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminKey}` }
    });
    toast('Deleted');
    loadPages();
    return;
  }

  if (action === 'publish' || action === 'unpublish') {
    const isPublic = action === 'publish';
    await fetch(`/api/pages/${id}/publish`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isPublic })
    });
    toast(isPublic ? 'Published' : 'Now private');
    loadPages();
  }
}

// Upload
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.html') && !ext.endsWith('.htm')) {
    toast('Only .html or .htm files allowed');
    return;
  }
  if (file.size > 1024 * 1024) {
    toast('File exceeds 1MB limit');
    return;
  }

  $('#upload-text').textContent = 'Uploading...';
  $('#upload-progress').textContent = file.name;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminKey}` },
      body: formData
    });

    if (res.ok) {
      toast('Uploaded successfully');
      loadPages();
    } else {
      const err = await res.json();
      toast(err.error || 'Upload failed');
    }
  } catch {
    toast('Upload error');
  } finally {
    $('#upload-text').textContent = 'Upload HTML';
    $('#upload-progress').textContent = '';
    e.target.value = '';
  }
});

// Search & sort
$('#search-input').addEventListener('input', renderPages);
$('#sort-select').addEventListener('change', renderPages);

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
