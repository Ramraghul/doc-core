/* Docucore web UI — dependency-free, CSP-safe (no inline scripts, no innerHTML: every value is
   inserted with textContent, so document titles/filenames can never inject markup). */
(() => {
  'use strict';

  const API = '/api/v1';
  const TOKEN_KEY = 'docucore.token';

  const state = {
    token: safeGet(TOKEN_KEY),
    user: null,
    usage: null,
    config: null,
    scope: 'all', q: '', tag: '', sort: 'updatedAt', order: 'desc', page: 1,
    list: null,
    doc: null, versions: [], activity: [], tab: 'versions',
  };

  // ------------------------------------------------------------------ helpers
  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }

  /** h('div', {class:'x', onclick: fn}, 'text', childNode) — tiny hyperscript. */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const $ = (sel, root = document) => root.querySelector(sel);

  function formatBytes(n) {
    if (n == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function timeAgo(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
    }
    return 'just now';
  }
  const fullDate = (iso) => new Date(iso).toLocaleString();

  function iconFor(mime = '') {
    if (mime === 'application/pdf') return '📕';
    if (mime.startsWith('image/')) return '🖼️';
    if (/spreadsheet|excel|csv/.test(mime)) return '📊';
    if (/presentation|powerpoint/.test(mime)) return '📽️';
    if (/word|msword/.test(mime)) return '📄';
    if (mime === 'application/zip') return '🗜️';
    if (mime === 'application/json') return '🧩';
    return '📝';
  }

  function toast(message, type = 'info') {
    const box = $('#toasts');
    const el = h('div', { class: `toast ${type}` }, message);
    box.append(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  }

  class ApiError extends Error {
    constructor(message, code, status, details) { super(message); this.code = code; this.status = status; this.details = details; }
  }

  async function api(path, { method = 'GET', body, form, raw } = {}) {
    const headers = {};
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

    const res = await fetch(API + path, { method, headers, body: payload });
    if (res.ok && raw) return res;
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error || {};
      if (res.status === 401 && state.token && path !== '/auth/login') {
        logout();
        toast('Your session has expired — please sign in again.', 'error');
      }
      const detail = err.details?.map((d) => d.message).join('; ');
      throw new ApiError(detail ? `${err.message}: ${detail}` : err.message || res.statusText, err.code, res.status, err.details);
    }
    return data;
  }

  async function guarded(fn, successMsg) {
    try {
      const out = await fn();
      if (successMsg) toast(successMsg);
      return out;
    } catch (e) {
      toast(e.message || 'Something went wrong', 'error');
      return undefined;
    }
  }

  async function saveBlob(res, filename) {
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ------------------------------------------------------------------ auth
  function logout() {
    state.token = null; state.user = null; state.doc = null;
    safeSet(TOKEN_KEY, null);
    render();
  }

  async function establish(result) {
    state.token = result.token;
    safeSet(TOKEN_KEY, result.token);
    state.user = result.user;
    await refreshUsage();
    state.scope = 'all'; state.q = ''; state.tag = ''; state.page = 1;
    render();
    await loadList();
  }

  async function refreshUsage() {
    const me = await api('/auth/me');
    state.user = me.user;
    state.usage = me.usage;
  }

  function renderAuth() {
    let mode = 'login';
    const errorBox = h('div', { class: 'form-error hidden', role: 'alert' });
    const nameField = h('div', { class: 'field hidden' }, h('label', { for: 'f-name' }, 'Name'), h('input', { id: 'f-name', type: 'text', autocomplete: 'name', maxlength: 80 }));
    const email = h('input', { id: 'f-email', type: 'email', required: true, autocomplete: 'email' });
    const password = h('input', { id: 'f-pass', type: 'password', required: true, autocomplete: 'current-password' });
    const hint = h('div', { class: 'small muted hidden' }, 'At least 8 characters, with a letter and a number.');
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const loginTab = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Sign in');
    const registerTab = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, 'Create account');

    const setMode = (m) => {
      mode = m;
      loginTab.setAttribute('aria-selected', String(m === 'login'));
      registerTab.setAttribute('aria-selected', String(m === 'register'));
      nameField.classList.toggle('hidden', m === 'login');
      hint.classList.toggle('hidden', m === 'login');
      password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
      errorBox.classList.add('hidden');
    };
    loginTab.addEventListener('click', () => setMode('login'));
    registerTab.addEventListener('click', () => setMode('register'));

    const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      errorBox.classList.add('hidden');
      submit.disabled = true;
      try {
        const body = mode === 'login'
          ? { email: email.value, password: password.value }
          : { name: $('#f-name').value, email: email.value, password: password.value };
        await establish(await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body }));
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.remove('hidden');
        submit.disabled = false;
      }
    } },
    h('div', { class: 'tabs', role: 'tablist' }, loginTab, registerTab),
    errorBox, nameField,
    h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'f-pass' }, 'Password'), password),
    hint, submit);

    const demo = state.config?.demo
      ? h('div', { class: 'demo-box stack' },
        h('div', {}, h('strong', {}, 'Just looking around? '), 'Use the shared demo account — it comes with sample documents.'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const r = await guarded(() => api('/auth/login', { method: 'POST', body: state.config.demo }));
          if (r) establish(r);
        } }, 'Try the demo account'))
      : null;

    return h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-card stack' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }, '🗂'), 'Docucore'),
        h('p', { class: 'muted', style: 'margin:0' }, 'Secure, versioned document management. Upload, version, share and search — backed by a documented REST API.'),
        form, demo,
        h('div', { class: 'small muted row spread' },
          h('a', { href: '/api-docs' }, 'API documentation →'),
          h('a', { href: '/health' }, 'Service health'))));
  }

  // ------------------------------------------------------------------ app shell
  function renderApp() {
    const u = state.usage;
    const pct = u ? Math.min(100, Math.round((u.usedBytes / u.quotaBytes) * 100)) : 0;

    const nav = (scope, label) => h('button', { class: 'nav-item', 'aria-current': String(state.scope === scope), onclick: () => { state.scope = scope; state.page = 1; state.doc = null; loadList(); } }, label);

    const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Document views' },
      nav('all', '📚 All documents'), nav('owned', '👤 Owned by me'), nav('shared', '🤝 Shared with me'), nav('trash', '🗑️ Trash'),
      u && h('div', { class: 'usage' },
        h('div', { class: 'row spread' }, h('strong', {}, 'Storage'), h('span', { class: 'muted' }, `${pct}%`)),
        h('div', { class: `meter ${pct > 85 ? 'high' : ''}`, role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: `width:${pct}%` })),
        h('div', { class: 'muted' }, `${formatBytes(u.usedBytes)} of ${formatBytes(u.quotaBytes)}`)));

    return h('div', {},
      h('header', { class: 'topbar' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }, '🗂'), 'Docucore'),
        h('div', { class: 'grow' }),
        h('div', { class: 'links' }, h('a', { href: '/api-docs' }, 'API docs'), h('a', { href: '/health' }, 'Health')),
        h('span', { class: 'muted small truncate' }, state.user.name, state.user.role === 'admin' ? ' (admin)' : ''),
        h('button', { class: 'btn sm', onclick: logout }, 'Sign out')),
      h('div', { class: 'layout' }, sidebar, h('main', { id: 'main' })),
      h('div', { id: 'drawer-root' }));
  }

  // ------------------------------------------------------------------ list
  let searchTimer;
  async function loadList() {
    const params = new URLSearchParams({ scope: state.scope, sort: state.sort, order: state.order, page: state.page, limit: 10 });
    if (state.q) params.set('q', state.q);
    if (state.tag) params.set('tag', state.tag);
    const data = await guarded(() => api(`/documents?${params}`));
    if (!data) return;
    state.list = data;
    render();
  }

  function renderMain() {
    const isTrash = state.scope === 'trash';
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search title, tags, description, filename…', 'aria-label': 'Search documents', value: state.q,
      oninput: (e) => { clearTimeout(searchTimer); const v = e.target.value; searchTimer = setTimeout(() => { state.q = v; state.page = 1; loadList(true); }, 300); } });

    const sortSel = h('select', { 'aria-label': 'Sort documents', onchange: (e) => { const [s, o] = e.target.value.split(':'); state.sort = s; state.order = o; state.page = 1; loadList(); } },
      ...[['updatedAt:desc', 'Recently updated'], ['createdAt:desc', 'Newest'], ['title:asc', 'Title A–Z'], ['size:desc', 'Largest']].map(([v, l]) => h('option', { value: v, selected: v === `${state.sort}:${state.order}` }, l)));

    const toolbar = h('div', { class: 'toolbar' }, search, sortSel,
      !isTrash && h('button', { class: 'btn primary', onclick: openUploadDialog }, '＋ Upload'));

    const chips = state.tag && h('div', { class: 'row', style: 'margin-bottom:12px' }, h('span', { class: 'chip' }, `tag: ${state.tag}`, h('button', { 'aria-label': 'Clear tag filter', onclick: () => { state.tag = ''; state.page = 1; loadList(); } }, '×')));

    const { data, meta } = state.list || { data: [], meta: { page: 1, totalPages: 1, total: 0 } };
    const body = data.length
      ? h('div', { class: 'doc-list' }, data.map(docRow))
      : h('div', { class: 'doc-list' }, h('div', { class: 'empty' }, isTrash ? 'The trash is empty.' : state.q || state.tag ? 'No documents match your search.' : 'No documents yet — upload your first file.'));

    const pager = meta.totalPages > 1 && h('div', { class: 'pager' },
      h('button', { class: 'btn sm', disabled: meta.page <= 1, onclick: () => { state.page -= 1; loadList(); } }, '← Prev'),
      h('span', { class: 'muted small' }, `Page ${meta.page} of ${meta.totalPages} · ${meta.total} documents`),
      h('button', { class: 'btn sm', disabled: meta.page >= meta.totalPages, onclick: () => { state.page += 1; loadList(); } }, 'Next →'));

    return [toolbar, chips, body, pager];
  }

  function docRow(d) {
    const isTrash = state.scope === 'trash';
    const open = () => !isTrash && openDoc(d.id);
    return h('div', { class: 'doc-row', role: 'button', tabindex: 0, 'aria-selected': String(state.doc?.id === d.id),
      onclick: (e) => { if (!e.target.closest('button')) open(); },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } },
    h('div', { class: 'doc-icon', 'aria-hidden': 'true' }, iconFor(d.latest?.mimeType)),
    h('div', { class: 'grow' },
      h('div', { class: 'doc-title truncate' }, d.title),
      h('div', { class: 'row wrap small muted' },
        h('span', { class: 'truncate' }, d.latest?.filename),
        d.tags.map((t) => h('button', { class: 'tag', title: `Filter by "${t}"`, onclick: () => { state.tag = t; state.page = 1; loadList(); } }, `#${t}`)))),
    h('div', { class: 'meta-col small muted', style: 'text-align:right' },
      h('div', {}, `${formatBytes(d.latest?.size)} · v${d.currentVersion}`),
      h('div', { title: fullDate(d.updatedAt) }, timeAgo(d.updatedAt))),
    isTrash
      ? h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => restoreDoc(d) }, 'Restore'),
        h('button', { class: 'btn sm danger', onclick: () => purgeDoc(d) }, 'Delete forever'))
      : h('span', { class: `badge ${d.permission}` }, d.permission));
  }

  async function restoreDoc(d) {
    await guarded(() => api(`/documents/${d.id}/restore`, { method: 'POST' }), 'Document restored');
    await refreshUsage(); loadList();
  }

  async function purgeDoc(d) {
    if (!confirm(`Permanently delete "${d.title}" and all its versions? This cannot be undone.`)) return;
    await guarded(() => api(`/documents/${d.id}/permanent`, { method: 'DELETE' }), 'Permanently deleted');
    await refreshUsage(); loadList();
  }

  // ------------------------------------------------------------------ upload dialog
  function openUploadDialog() {
    const max = state.config?.maxFileBytes;
    const file = h('input', { type: 'file', id: 'u-file', required: true, accept: (state.config?.allowedMimeTypes || []).join(',') + ',.md,.csv,.json' });
    const title = h('input', { type: 'text', id: 'u-title', maxlength: 200, placeholder: 'Defaults to the file name' });
    const desc = h('textarea', { id: 'u-desc', maxlength: 2000 });
    const tags = h('input', { type: 'text', id: 'u-tags', placeholder: 'invoice, 2026' });
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Upload');
    const dialog = h('dialog', {});
    const close = () => { dialog.close(); dialog.remove(); };

    dialog.append(h('form', { onsubmit: async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (!file.files[0]) return;
      if (max && file.files[0].size > max) { err.textContent = `File is larger than the ${formatBytes(max)} limit.`; err.classList.remove('hidden'); return; }
      const fd = new FormData();
      fd.append('file', file.files[0]);
      if (title.value.trim()) fd.append('title', title.value.trim());
      if (desc.value.trim()) fd.append('description', desc.value.trim());
      if (tags.value.trim()) fd.append('tags', tags.value.trim());
      submit.disabled = true; submit.textContent = 'Uploading…';
      try {
        await api('/documents', { method: 'POST', form: fd });
        close(); toast('Document uploaded');
        state.scope = 'all'; state.page = 1; state.sort = 'updatedAt'; state.order = 'desc';
        await refreshUsage(); loadList();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden');
        submit.disabled = false; submit.textContent = 'Upload';
      }
    } },
    h('h2', {}, 'Upload a document'),
    err,
    h('div', { class: 'field' }, h('label', { for: 'u-file' }, 'File'), file, h('span', { class: 'small muted' }, `PDF, images, Office files, text, CSV, JSON, ZIP · max ${formatBytes(max)}`)),
    h('div', { class: 'field' }, h('label', { for: 'u-title' }, 'Title'), title),
    h('div', { class: 'field' }, h('label', { for: 'u-desc' }, 'Description'), desc),
    h('div', { class: 'field' }, h('label', { for: 'u-tags' }, 'Tags (comma separated)'), tags),
    h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), submit)));
    dialog.addEventListener('cancel', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  // ------------------------------------------------------------------ drawer
  async function openDoc(id) {
    const [{ document: doc }, { versions }] = await guarded(() => Promise.all([api(`/documents/${id}`), api(`/documents/${id}/versions`)])) || [{}, {}];
    if (!doc) return;
    state.doc = doc; state.versions = versions; state.activity = [];
    state.tab = 'versions';
    render();
  }

  async function reloadDoc() {
    const id = state.doc.id;
    const [{ document: doc }, { versions }] = await Promise.all([api(`/documents/${id}`), api(`/documents/${id}/versions`)]);
    state.doc = doc; state.versions = versions;
    if (state.tab === 'activity') state.activity = (await api(`/documents/${id}/activity`)).activity;
    await refreshUsage();
    const params = new URLSearchParams({ scope: state.scope, sort: state.sort, order: state.order, page: state.page, limit: 10 });
    if (state.q) params.set('q', state.q);
    if (state.tag) params.set('tag', state.tag);
    state.list = await api(`/documents?${params}`);
    render();
  }

  const canEdit = (d) => d.permission === 'owner' || d.permission === 'editor';

  function renderDrawer() {
    const d = state.doc;
    if (!d) return null;
    const isOwner = d.permission === 'owner';
    const close = () => { state.doc = null; render(); };

    const tab = (id, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), onclick: async () => {
      state.tab = id;
      if (id === 'activity') state.activity = (await guarded(() => api(`/documents/${d.id}/activity`)))?.activity || [];
      render();
    } }, label);

    const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('versions', `Versions (${d.versionCount})`), isOwner && tab('sharing', 'Sharing'), canEdit(d) && tab('activity', 'Activity'));
    const panel = state.tab === 'versions' ? versionsPanel(d) : state.tab === 'sharing' && isOwner ? sharingPanel(d) : activityPanel();

    return h('div', {},
      h('div', { class: 'scrim', onclick: close }),
      h('aside', { class: 'drawer', role: 'dialog', 'aria-label': `Document ${d.title}` },
        h('header', { class: 'stack', style: 'gap:8px' },
          h('div', { class: 'row spread' },
            h('div', { class: 'row', style: 'min-width:0' }, h('span', { class: 'doc-icon' }, iconFor(d.latest?.mimeType)), h('h2', { class: 'truncate' }, d.title)),
            h('button', { class: 'btn ghost sm', 'aria-label': 'Close', onclick: close }, '✕')),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn primary sm', onclick: () => downloadVersion(d.latest.filename) }, '⬇ Download'),
            isOwner && h('button', { class: 'btn danger sm', onclick: () => trashDoc(d) }, 'Move to trash'))),
        h('div', { class: 'body stack' },
          metaSection(d), tabs, panel)));
  }

  function metaSection(d) {
    const title = h('input', { type: 'text', value: d.title, maxlength: 200, 'aria-label': 'Title', disabled: !canEdit(d) });
    const desc = h('textarea', { maxlength: 2000, 'aria-label': 'Description', disabled: !canEdit(d) }, d.description);
    const tags = h('input', { type: 'text', value: d.tags.join(', '), 'aria-label': 'Tags', disabled: !canEdit(d), placeholder: 'comma, separated' });
    const save = h('button', { class: 'btn sm primary', onclick: async () => {
      const ok = await guarded(() => api(`/documents/${d.id}`, { method: 'PATCH', body: { title: title.value, description: desc.value, tags: tags.value } }), 'Saved');
      if (ok) reloadDoc();
    } }, 'Save changes');
    return h('div', { class: 'stack' },
      h('div', { class: 'row wrap small muted' },
        h('span', { class: `badge ${d.permission}` }, `You are ${d.permission === 'owner' ? 'the owner' : `an ${d.permission}`}`),
        h('span', {}, `${d.latest?.filename} · ${formatBytes(d.latest?.size)}`)),
      h('div', { class: 'field' }, h('label', {}, 'Title'), title),
      h('div', { class: 'field' }, h('label', {}, 'Description'), desc),
      h('div', { class: 'field' }, h('label', {}, 'Tags'), tags),
      canEdit(d) && h('div', {}, save),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Owner'), h('dd', {}, `${d.owner?.name} (${d.owner?.email})`),
        h('dt', {}, 'Created'), h('dd', {}, fullDate(d.createdAt)),
        h('dt', {}, 'Checksum'), h('dd', { class: 'small', style: 'font-family:ui-monospace,monospace' }, `SHA-256 ${d.latest?.checksum.slice(0, 16)}…`)));
  }

  async function downloadVersion(filename, version) {
    const res = await guarded(() => api(`/documents/${state.doc.id}/download${version ? `?version=${version}` : ''}`, { raw: true }));
    if (res) saveBlob(res, filename);
  }

  async function trashDoc(d) {
    if (!confirm(`Move "${d.title}" to the trash? You can restore it later.`)) return;
    const ok = await guarded(() => api(`/documents/${d.id}`, { method: 'DELETE' }), 'Moved to trash');
    if (ok === undefined) return;
    state.doc = null; await refreshUsage(); loadList();
  }

  function versionsPanel(d) {
    const file = h('input', { type: 'file', 'aria-label': 'New version file' });
    const comment = h('input', { type: 'text', maxlength: 500, placeholder: 'What changed? (optional)', 'aria-label': 'Version comment' });
    const upload = canEdit(d) && h('div', { class: 'stack', style: 'gap:8px' },
      h('div', { class: 'section-title' }, 'Upload a new version'),
      file, comment,
      h('div', {}, h('button', { class: 'btn sm primary', onclick: async (e) => {
        if (!file.files[0]) return toast('Choose a file first', 'error');
        const fd = new FormData();
        fd.append('file', file.files[0]);
        if (comment.value.trim()) fd.append('comment', comment.value.trim());
        e.target.disabled = true;
        const ok = await guarded(() => api(`/documents/${d.id}/versions`, { method: 'POST', form: fd }), 'New version uploaded');
        e.target.disabled = false;
        if (ok) reloadDoc();
      } }, 'Upload version')),
      state.config && h('div', { class: 'small muted' }, `Only the newest ${state.config.maxVersionsPerDocument} versions are kept.`));

    return h('div', { class: 'stack' },
      upload,
      h('div', { class: 'section-title' }, 'History'),
      h('div', {}, state.versions.map((v) => h('div', { class: 'list-item' },
        h('span', { class: 'badge' }, `v${v.version}`),
        h('div', { class: 'grow' },
          h('div', { class: 'truncate' }, v.filename, v.isCurrent && h('span', { class: 'badge owner', style: 'margin-left:8px' }, 'current')),
          h('div', { class: 'small muted' }, `${formatBytes(v.size)} · ${v.uploadedBy?.name || 'unknown'} · `, h('span', { title: fullDate(v.uploadedAt) }, timeAgo(v.uploadedAt)), v.comment ? ` · ${v.comment}` : '')),
        h('button', { class: 'btn sm', onclick: () => downloadVersion(v.filename, v.version) }, 'Download')))));
  }

  function sharingPanel(d) {
    const email = h('input', { type: 'email', placeholder: 'colleague@example.com', 'aria-label': 'Share with email' });
    const perm = h('select', { 'aria-label': 'Permission' }, h('option', { value: 'viewer' }, 'Viewer'), h('option', { value: 'editor' }, 'Editor'));
    const hours = h('select', { 'aria-label': 'Link lifetime' }, ...[[1, '1 hour'], [24, '24 hours'], [168, '7 days'], [720, '30 days']].map(([v, l]) => h('option', { value: v, selected: v === 24 }, l)));
    const linkOut = h('div', {});

    const shareNow = async () => {
      if (!email.value.trim()) return;
      const ok = await guarded(() => api(`/documents/${d.id}/shares`, { method: 'POST', body: { email: email.value, permission: perm.value } }), 'Shared');
      if (ok) reloadDoc();
    };

    const showLink = (token) => {
      const url = `${location.origin}${API}/public/${token}/download`;
      const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Public link', onclick: (e) => e.target.select() });
      linkOut.replaceChildren(
        h('div', { class: 'linkbox' }, input, h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { input.select(); } } }, 'Copy')),
        h('div', { class: 'small muted' }, 'Copy it now — for security the link is shown only once.'));
    };

    return h('div', { class: 'stack' },
      h('div', { class: 'section-title' }, 'Share with a person'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, email), perm, h('button', { class: 'btn primary sm', onclick: shareNow }, 'Share')),
      h('div', { class: 'small muted' }, 'The person needs a Docucore account (registered with that email).'),
      h('div', { class: 'section-title' }, `People with access (${d.sharedWith?.length || 0})`),
      d.sharedWith?.length
        ? h('div', {}, d.sharedWith.map((s) => h('div', { class: 'list-item' },
          h('div', { class: 'grow' }, h('div', {}, s.user?.name), h('div', { class: 'small muted' }, s.user?.email)),
          h('span', { class: `badge ${s.permission}` }, s.permission),
          h('button', { class: 'btn sm danger', onclick: async () => { const ok = await guarded(() => api(`/documents/${d.id}/shares/${s.user.id}`, { method: 'DELETE' }), 'Access removed'); if (ok) reloadDoc(); } }, 'Remove'))))
        : h('div', { class: 'muted small' }, 'Only you can see this document.'),
      h('div', { class: 'section-title' }, 'Public link'),
      d.publicLink
        ? h('div', { class: 'small' }, d.publicLink.expired ? h('span', { class: 'badge' }, 'expired') : h('span', { class: 'badge owner' }, 'active'), ` expires ${fullDate(d.publicLink.expiresAt)}`)
        : h('div', { class: 'small muted' }, 'No public link. Anyone with a link can download the current version until it expires.'),
      h('div', { class: 'row' }, hours,
        h('button', { class: 'btn sm', onclick: async () => {
          const r = await guarded(() => api(`/documents/${d.id}/public-link`, { method: 'POST', body: { expiresInHours: Number(hours.value) } }));
          if (r) { showLink(r.token); const fresh = await api(`/documents/${d.id}`); state.doc = fresh.document; }
        } }, d.publicLink ? 'Replace link' : 'Create link'),
        d.publicLink && h('button', { class: 'btn sm danger', onclick: async () => { const ok = await guarded(() => api(`/documents/${d.id}/public-link`, { method: 'DELETE' }), 'Link revoked'); if (ok !== undefined) reloadDoc(); } }, 'Revoke')),
      linkOut);
  }

  const ACTION_LABELS = {
    'document.created': 'created the document', 'document.updated': 'edited details', 'document.version_added': 'uploaded a new version',
    'document.version_pruned': 'old versions were pruned (retention)', 'document.downloaded': 'downloaded', 'document.shared': 'shared',
    'document.unshared': 'removed access', 'document.trashed': 'moved to trash', 'document.restored': 'restored from trash',
    'document.purged': 'permanently deleted', 'document.link_created': 'created a public link', 'document.link_revoked': 'revoked the public link',
    'document.public_downloaded': 'downloaded via public link',
  };

  function activityPanel() {
    if (!state.activity.length) return h('div', { class: 'muted small' }, 'No activity yet.');
    return h('div', {}, state.activity.map((a) => h('div', { class: 'list-item' },
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, a.actor?.name || 'Anonymous visitor'), ` ${ACTION_LABELS[a.action] || a.action}`,
          a.meta?.with ? ` with ${a.meta.with} (${a.meta.permission})` : '',
          a.meta?.version && a.action === 'document.version_added' ? ` (v${a.meta.version})` : ''),
        h('div', { class: 'small muted', title: fullDate(a.createdAt) }, timeAgo(a.createdAt))))));
  }

  // ------------------------------------------------------------------ render
  function render() {
    const root = $('#app');
    const scrollY = window.scrollY;
    if (!state.token || !state.user) { root.replaceChildren(renderAuth()); return; }

    // Rebuild the shell only when needed so the search box keeps focus while typing.
    let main = $('#main');
    const focusId = document.activeElement?.getAttribute?.('type') === 'search' ? 'search' : null;
    const selStart = document.activeElement?.selectionStart;
    if (!main || !$('.topbar')) { root.replaceChildren(renderApp()); main = $('#main'); }
    else { $('.layout .sidebar').replaceWith(renderApp().querySelector('.sidebar')); }

    // Keep the drawer's scroll position when it is rebuilt after an action (share, save, upload...).
    const drawerScroll = $('.drawer .body')?.scrollTop || 0;
    main.replaceChildren(...renderMain().filter(Boolean));
    $('#drawer-root').replaceChildren(...[renderDrawer()].filter(Boolean));
    const drawerBody = $('.drawer .body');
    if (drawerBody) drawerBody.scrollTop = drawerScroll;

    if (focusId) { const s = $('input[type=search]'); s?.focus(); if (selStart != null) s?.setSelectionRange(selStart, selStart); }
    window.scrollTo(0, scrollY);
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { state.config = await (await fetch(`${API}/config`)).json(); } catch { state.config = null; }
    if (state.token) {
      try { await refreshUsage(); await loadList(); return; } catch { state.token = null; safeSet(TOKEN_KEY, null); }
    }
    render();
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.doc && !document.querySelector('dialog[open]')) { state.doc = null; render(); } });
  boot();
})();
