/* Notas — app estático, backend Supabase.
   Offline-first: tudo vive no localStorage e é empurrado pro servidor quando dá.
   Pastas e notas convivem no mesmo nível: nota com folder_id nulo mora na raiz. */
(() => {
'use strict';

const CFG = window.NOTAS_CONFIG || {};
const $ = id => document.getElementById(id);

const el = {
  boot: $('boot'), setup: $('setup'), auth: $('auth'), app: $('app'),
  authForm: $('auth-form'), email: $('email'), password: $('password'),
  authSubmit: $('auth-submit'), authMsg: $('auth-msg'),
  authForgot: $('auth-forgot'), authTitle: $('auth-title'), authSub: $('auth-sub'),
  avatar: $('avatar'), whoMail: $('who-mail'), btnTheme: $('btn-theme'),
  search: $('search'), btnNew: $('btn-new'), btnNew2: $('btn-new-2'),
  btnNewFolder: $('btn-new-folder'), list: $('list'),
  crumb: $('crumb'), crumbName: $('crumb-name'), btnBack: $('btn-back'),
  btnRenameFolder: $('btn-rename-folder'), btnDelFolder: $('btn-del-folder'),
  sync: $('sync'), btnLogout: $('btn-logout'),
  sidebar: $('sidebar'), scrim: $('scrim'), btnMenu: $('btn-menu'),
  edHead: document.querySelector('.ed-head'),
  edBody: $('ed-body'), edMeta: $('ed-meta'), empty: $('empty'),
  title: $('title'), content: $('content'), preview: $('preview'),
  move: $('move'), btnPin: $('btn-pin'),
  btnPreview: $('btn-preview'), btnDelete: $('btn-delete'),
};

const LS = { cache: 'notas:cache', theme: 'notas:theme', last: 'notas:last' };
const NCOLS = ['id', 'user_id', 'title', 'content', 'folder_id', 'pinned', 'created_at', 'updated_at'];
const FCOLS = ['id', 'user_id', 'name', 'created_at', 'updated_at'];

let sb = null;
let user = null;
let notes = [];
let folders = [];
let pendingN = new Map(), pendingF = new Map();
let deletingN = new Set(), deletingF = new Set();
let currentId = null;
let currentFolder = null;      // null = raiz
let previewOn = false;
let channel = null;
let saveTimer = null, listTimer = null, retryTimer = null;

/* ── utilidades ─────────────────────────────────────────── */

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const UNITS = ['second', 'minute', 'hour', 'day', 'month', 'year'];
const LIMS  = [60, 3600, 86400, 2592000, 31536000, Infinity];
const DIVS  = [1, 60, 3600, 86400, 2592000, 31536000];

function rel(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora mesmo';
  for (let i = 0; i < LIMS.length; i++) {
    if (abs < LIMS[i]) return rtf.format(Math.round(diff / DIVS[i]), UNITS[i]);
  }
  return '';
}

const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function snippet(n) {
  const line = (n.content || '')
    .split('\n')
    .map(l => l.replace(/^[\s>#*\-+\d.]+/, '').trim())
    .find(l => l.length > 0);
  return line ? line.slice(0, 90) : 'Nota vazia';
}

const noteById   = id => notes.find(n => n.id === id) || null;
const folderById = id => folders.find(f => f.id === id) || null;

function sortNotes() {
  notes.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
function sortFolders() {
  folders.sort((a, b) => fold(a.name).localeCompare(fold(b.name), 'pt-BR'));
}
function strip(o, cols) { const r = {}; for (const c of cols) r[c] = o[c]; return r; }

function setSync(text, warn) {
  el.sync.textContent = text;
  el.sync.classList.toggle('warn', !!warn);
}

function show(screen) {
  el.boot.hidden = true;
  el.setup.hidden = screen !== 'setup';
  el.auth.hidden  = screen !== 'auth';
  el.app.hidden   = screen !== 'app';
}

function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

const SVGNS = 'http://www.w3.org/2000/svg';
const FOLDER_ICON = 'M1.5 3.5A1.5 1.5 0 013 2h3.1a1.5 1.5 0 011.06.44L8.2 3.5H13a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12v-8.5z';

function icon(path) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'ic');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}

/* ── tema ───────────────────────────────────────────────── */

function applyTheme() {
  const t = localStorage.getItem(LS.theme) || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  el.btnTheme.textContent = t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐';
  el.btnTheme.title = 'Tema: ' + { system: 'sistema', light: 'claro', dark: 'escuro' }[t];
}
el.btnTheme.addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  const now = localStorage.getItem(LS.theme) || 'system';
  localStorage.setItem(LS.theme, order[(order.indexOf(now) + 1) % 3]);
  applyTheme();
});

/* ── markdown ───────────────────────────────────────────── */

if (window.marked) marked.setOptions({ gfm: true, breaks: true });

function renderMd(src) {
  const html = window.marked ? marked.parse(src || '') : '';
  return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }) : html;
}

function paintPreview(src) {
  el.preview.innerHTML = renderMd(src);
  el.preview.querySelectorAll('a[href]').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
}

/* ── cache local ────────────────────────────────────────── */

function saveCache() {
  try {
    localStorage.setItem(LS.cache, JSON.stringify({
      uid: user ? user.id : null,
      notes, folders,
      pendingN: [...pendingN.values()], pendingF: [...pendingF.values()],
      deletingN: [...deletingN], deletingF: [...deletingF],
    }));
  } catch (e) { /* cota estourada: segue sem cache */ }
}

function loadCache(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS.cache) || 'null');
    if (!raw || raw.uid !== uid) return false;
    notes = raw.notes || [];
    folders = raw.folders || [];
    pendingN = new Map((raw.pendingN || []).map(n => [n.id, n]));
    pendingF = new Map((raw.pendingF || []).map(f => [f.id, f]));
    deletingN = new Set(raw.deletingN || []);
    deletingF = new Set(raw.deletingF || []);
    // reaproveita os objetos pendentes para que edições sigam apontando pro mesmo item
    notes = notes.map(n => pendingN.get(n.id) || n);
    folders = folders.map(f => pendingF.get(f.id) || f);
    sortNotes(); sortFolders();
    return notes.length > 0 || folders.length > 0;
  } catch (e) { return false; }
}

/* ── sincronização ──────────────────────────────────────── */

function pendingCount() {
  return pendingN.size + pendingF.size + deletingN.size + deletingF.size;
}

function flushSoon(ms) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, ms == null ? 800 : ms);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!sb || !user) return;
  if (!pendingCount()) { setSync('Tudo salvo'); return; }
  if (!navigator.onLine) {
    const n = pendingCount();
    setSync(n === 1 ? '1 alteração guardada offline' : n + ' alterações guardadas offline', true);
    return;
  }

  setSync('Salvando…');
  const bF = [...pendingF.values()].map(f => strip(f, FCOLS));
  const bN = [...pendingN.values()].map(n => strip(n, NCOLS));
  const dN = [...deletingN];
  const dF = [...deletingF];

  try {
    // pastas primeiro: uma nota pode apontar pra uma pasta recém-criada
    if (bF.length) {
      const { error } = await sb.from('folders').upsert(bF);
      if (error) throw error;
      for (const f of bF) {
        const cur = pendingF.get(f.id);
        if (cur && cur.updated_at === f.updated_at) pendingF.delete(f.id);
      }
    }
    if (bN.length) {
      const { error } = await sb.from('notes').upsert(bN);
      if (error) throw error;
      for (const n of bN) {
        const cur = pendingN.get(n.id);
        if (cur && cur.updated_at === n.updated_at) pendingN.delete(n.id);
      }
    }
    if (dN.length) {
      const { error } = await sb.from('notes').delete().in('id', dN);
      if (error) throw error;
      for (const id of dN) deletingN.delete(id);
    }
    if (dF.length) {
      const { error } = await sb.from('folders').delete().in('id', dF);
      if (error) throw error;
      for (const id of dF) deletingF.delete(id);
    }
    saveCache();
    setSync(pendingCount() ? 'Salvando…' : 'Tudo salvo');
    if (pendingCount()) flushSoon(400);
  } catch (e) {
    console.error('[sync]', e);
    setSync('Erro ao salvar — tentando de novo', true);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, 6000);
  }
}

async function pull() {
  if (!sb || !user || !navigator.onLine) return;

  const [rn, rf] = await Promise.all([
    sb.from('notes').select(NCOLS.join(',')).order('updated_at', { ascending: false }),
    sb.from('folders').select(FCOLS.join(',')),
  ]);

  if (rn.error || rf.error) {
    console.error('[pull]', rn.error || rf.error);
    setSync('Sem conexão com o servidor', true);
    return;
  }

  const mn = new Map(rn.data.map(n => [n.id, n]));
  for (const [id, n] of pendingN) mn.set(id, n);
  for (const id of deletingN) mn.delete(id);
  notes = [...mn.values()];

  const mf = new Map(rf.data.map(f => [f.id, f]));
  for (const [id, f] of pendingF) mf.set(id, f);
  for (const id of deletingF) mf.delete(id);
  folders = [...mf.values()];

  sortNotes(); sortFolders(); saveCache();

  if (currentFolder && !folderById(currentFolder)) currentFolder = null;
  syncMoveOptions();
  renderList();

  if (currentId && !noteById(currentId)) openNote(null);
  else if (currentId && !pendingN.has(currentId)) fillEditor(noteById(currentId));
  setSync(pendingCount() ? 'Salvando…' : 'Tudo salvo');
}

function subscribe() {
  if (!sb || !user) return;
  if (channel) sb.removeChannel(channel);
  const f = 'user_id=eq.' + user.id;
  channel = sb.channel('notas-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes',   filter: f }, e => onRemote(e, true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'folders', filter: f }, e => onRemote(e, false))
    .subscribe();
}

function onRemote(payload, isNote) {
  const pend = isNote ? pendingN : pendingF;
  const del  = isNote ? deletingN : deletingF;

  if (payload.eventType === 'DELETE') {
    const id = payload.old && payload.old.id;
    if (!id) return;
    if (isNote) {
      notes = notes.filter(n => n.id !== id);
      if (currentId === id) openNote(null);
    } else {
      folders = folders.filter(f => f.id !== id);
      notes.forEach(n => { if (n.folder_id === id) n.folder_id = null; });
      if (currentFolder === id) currentFolder = null;
      syncMoveOptions();
    }
    pend.delete(id);
    renderList(); saveCache();
    return;
  }

  const row = payload.new;
  if (!row || pend.has(row.id) || del.has(row.id)) return;

  const arr = isNote ? notes : folders;
  const i = arr.findIndex(x => x.id === row.id);
  if (i < 0) arr.push(row); else arr[i] = row;

  if (isNote) { sortNotes(); if (currentId === row.id) fillEditor(row); }
  else { sortFolders(); syncMoveOptions(); }

  renderList(); saveCache();
}

/* ── lista lateral ──────────────────────────────────────── */

function renderListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderList, 500); }

function groupLabel(text) {
  const h = document.createElement('div');
  h.className = 'group-label';
  h.textContent = text;
  return h;
}

function listMessage(text) {
  const p = document.createElement('p');
  p.className = 'list-empty';
  p.textContent = text;
  return p;
}

function noteRow(n) {
  const b = document.createElement('button');
  b.className = 'item' + (n.id === currentId ? ' on' : '');
  b.dataset.id = n.id;

  const t = document.createElement('div');
  t.className = 'item-t';
  if (n.pinned) {
    const star = document.createElement('span');
    star.className = 'star';
    star.textContent = '★';
    t.append(star);
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = (n.title || '').trim() || 'Sem título';
  t.append(label);

  const s = document.createElement('div');
  s.className = 'item-s';
  s.textContent = snippet(n);

  b.append(t, s);
  return b;
}

function folderRow(f) {
  const count = notes.filter(n => n.folder_id === f.id).length;
  const b = document.createElement('button');
  b.className = 'item folder';
  b.dataset.folder = f.id;

  const t = document.createElement('div');
  t.className = 'item-t';
  t.append(icon(FOLDER_ICON));
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = (f.name || '').trim() || 'Sem nome';
  t.append(label);

  const s = document.createElement('div');
  s.className = 'item-s';
  s.textContent = count === 0 ? 'Vazia' : count === 1 ? '1 nota' : count + ' notas';

  b.append(t, s);
  return b;
}

function byRecency(a, b) { return Date.parse(b.updated_at) - Date.parse(a.updated_at); }

function renderList() {
  clearTimeout(listTimer);
  const q = fold(el.search.value.trim());

  el.list.replaceChildren();
  el.crumb.hidden = !currentFolder || !!q;

  // ── busca: resultado plano, atravessa pastas
  if (q) {
    const hits = notes
      .filter(n => fold(n.title).includes(q) || fold(n.content).includes(q))
      .sort(byRecency);
    if (!hits.length) { el.list.append(listMessage('Nada encontrado.')); return; }
    hits.forEach(n => el.list.append(noteRow(n)));
    return;
  }

  // ── dentro de uma pasta
  if (currentFolder) {
    const f = folderById(currentFolder);
    el.crumbName.textContent = f ? ((f.name || '').trim() || 'Sem nome') : '';
    const inside = notes
      .filter(n => n.folder_id === currentFolder)
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || byRecency(a, b));
    if (!inside.length) {
      el.list.append(listMessage('Pasta vazia. "Nova nota" cria uma aqui dentro.'));
      return;
    }
    inside.forEach(n => el.list.append(noteRow(n)));
    return;
  }

  // ── raiz: fixadas, depois pastas, depois notas soltas
  const pinned = notes.filter(n => n.pinned).sort(byRecency);
  if (pinned.length) {
    el.list.append(groupLabel('Fixadas'));
    pinned.forEach(n => el.list.append(noteRow(n)));
  }

  if (folders.length) {
    el.list.append(groupLabel('Pastas'));
    folders.forEach(f => el.list.append(folderRow(f)));
  }

  const loose = notes.filter(n => !n.folder_id && !n.pinned).sort(byRecency);
  if (!loose.length) {
    if (!pinned.length && !folders.length) el.list.append(listMessage('Nenhuma nota ainda.'));
    return;
  }

  const now = Date.now();
  let group = null;
  for (const n of loose) {
    const age = now - Date.parse(n.updated_at);
    const g = age < 86400e3 ? 'Hoje' : age < 604800e3 ? 'Últimos 7 dias' : 'Anteriores';
    if (g !== group) { group = g; el.list.append(groupLabel(g)); }
    el.list.append(noteRow(n));
  }
}

el.list.addEventListener('click', e => {
  const f = e.target.closest('.item.folder');
  if (f) { currentFolder = f.dataset.folder; el.search.value = ''; renderList(); return; }
  const b = e.target.closest('.item');
  if (!b) return;
  openNote(b.dataset.id);
  closeDrawer();
});

el.btnBack.addEventListener('click', () => { currentFolder = null; renderList(); });

/* ── pastas ─────────────────────────────────────────────── */

function syncMoveOptions() {
  const n = noteById(currentId);
  el.move.replaceChildren();

  const root = document.createElement('option');
  root.value = '';
  root.textContent = 'Sem pasta';
  el.move.append(root);

  for (const f of folders) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = (f.name || '').trim() || 'Sem nome';
    el.move.append(o);
  }
  el.move.value = n && n.folder_id ? n.folder_id : '';
}

el.btnNewFolder.addEventListener('click', () => {
  if (!user) return;
  const name = (prompt('Nome da pasta:') || '').trim();
  if (!name) return;
  const now = new Date().toISOString();
  const f = { id: crypto.randomUUID(), user_id: user.id, name, created_at: now, updated_at: now };
  folders.push(f);
  pendingF.set(f.id, f);
  sortFolders(); saveCache(); syncMoveOptions(); renderList();
  flushSoon(300);
});

el.btnRenameFolder.addEventListener('click', () => {
  const f = folderById(currentFolder);
  if (!f) return;
  const name = (prompt('Novo nome da pasta:', f.name) || '').trim();
  if (!name || name === f.name) return;
  f.name = name;
  f.updated_at = new Date().toISOString();
  pendingF.set(f.id, f);
  sortFolders(); saveCache(); syncMoveOptions(); renderList();
  flushSoon(300);
});

el.btnDelFolder.addEventListener('click', () => {
  const f = folderById(currentFolder);
  if (!f) return;
  const inside = notes.filter(n => n.folder_id === f.id);
  const aviso = inside.length
    ? '\n\nAs ' + inside.length + ' nota(s) de dentro não são apagadas — voltam pra raiz.'
    : '';
  if (!confirm('Excluir a pasta "' + f.name + '"?' + aviso)) return;

  const stamp = new Date().toISOString();
  for (const n of inside) {
    n.folder_id = null;
    n.updated_at = stamp;
    pendingN.set(n.id, n);
  }
  folders = folders.filter(x => x.id !== f.id);
  pendingF.delete(f.id);
  deletingF.add(f.id);
  currentFolder = null;
  saveCache(); syncMoveOptions(); renderList();
  flush();
});

el.move.addEventListener('change', () => {
  const n = noteById(currentId);
  if (!n) return;
  n.folder_id = el.move.value || null;
  n.updated_at = new Date().toISOString();
  pendingN.set(n.id, n);
  sortNotes(); saveCache(); renderList();
  setSync('Salvando…');
  flushSoon(200);
});

/* ── editor ─────────────────────────────────────────────── */

function paintPin(n) {
  const on = !!(n && n.pinned);
  el.btnPin.textContent = on ? '★' : '☆';
  el.btnPin.classList.toggle('on', on);
  el.btnPin.setAttribute('aria-pressed', String(on));
  el.btnPin.title = on ? 'Desafixar nota (Ctrl+D)' : 'Fixar nota (Ctrl+D)';
}

function fillEditor(n) {
  if (!n) return;
  const active = document.activeElement;
  if (el.title.value !== n.title) {
    const p = el.title.selectionStart;
    el.title.value = n.title;
    if (active === el.title) el.title.setSelectionRange(p, p);
  }
  if (el.content.value !== n.content) {
    const p = el.content.selectionStart;
    el.content.value = n.content;
    if (active === el.content) el.content.setSelectionRange(p, p);
  }
  autoGrow(el.title);
  autoGrow(el.content);
  paintPin(n);
  el.move.value = n.folder_id || '';
  el.edMeta.textContent = 'Editada ' + rel(n.updated_at);
  if (previewOn) paintPreview(n.content);
}

function openNote(id) {
  currentId = id;
  if (id) localStorage.setItem(LS.last, id); else localStorage.removeItem(LS.last);

  const n = id ? noteById(id) : null;
  el.edBody.hidden = !n;
  el.empty.hidden = !!n;
  el.btnPreview.hidden = !n;
  el.btnDelete.hidden = !n;
  el.btnPin.hidden = !n;
  el.move.hidden = !n;
  el.edMeta.textContent = '';

  if (n) { fillEditor(n); window.scrollTo(0, 0); }
  renderList();
}

function touch() {
  const n = noteById(currentId);
  if (!n) return;
  n.title = el.title.value;
  n.content = el.content.value;
  n.updated_at = new Date().toISOString();
  pendingN.set(n.id, n);
  sortNotes();
  saveCache();
  setSync('Editando…');
  el.edMeta.textContent = 'Editada agora mesmo';
  autoGrow(el.title);
  autoGrow(el.content);
  if (previewOn) paintPreview(n.content);
  renderListSoon();
  flushSoon();
}

el.title.addEventListener('input', touch);
el.content.addEventListener('input', touch);

el.title.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); el.content.focus(); el.content.setSelectionRange(0, 0); }
});

el.content.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = el.content.selectionStart, en = el.content.selectionEnd;
    el.content.setRangeText('  ', s, en, 'end');
    touch();
  }
});

function togglePin() {
  const n = noteById(currentId);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated_at = new Date().toISOString();
  pendingN.set(n.id, n);
  paintPin(n);
  sortNotes(); saveCache(); renderList();
  setSync('Salvando…');
  flushSoon(200);
}
el.btnPin.addEventListener('click', togglePin);

function newNote() {
  if (!user) return;
  const now = new Date().toISOString();
  const n = {
    id: crypto.randomUUID(), user_id: user.id, title: '', content: '',
    folder_id: currentFolder, pinned: false, created_at: now, updated_at: now,
  };
  notes.unshift(n);
  pendingN.set(n.id, n);
  saveCache();
  el.search.value = '';
  openNote(n.id);
  closeDrawer();
  el.title.focus();
  flushSoon(300);
}
el.btnNew.addEventListener('click', newNote);
el.btnNew2.addEventListener('click', newNote);

el.btnDelete.addEventListener('click', () => {
  const n = noteById(currentId);
  if (!n) return;
  if (!confirm('Excluir ' + ((n.title || '').trim() || 'esta nota') + '? Não dá pra desfazer.')) return;

  const wasIn = n.folder_id || null;
  notes = notes.filter(x => x.id !== n.id);
  pendingN.delete(n.id);
  deletingN.add(n.id);
  saveCache();

  const pool = notes.filter(x => (x.folder_id || null) === wasIn);
  openNote(pool.length ? pool[0].id : (notes[0] ? notes[0].id : null));
  flush();
});

function setPreview(on) {
  previewOn = on;
  el.content.hidden = on;
  el.preview.hidden = !on;
  el.btnPreview.textContent = on ? 'Editar' : 'Preview';
  if (on) {
    const n = noteById(currentId);
    paintPreview(n ? n.content : '');
  } else {
    el.content.focus();
    autoGrow(el.content);
  }
}
el.btnPreview.addEventListener('click', () => setPreview(!previewOn));

window.addEventListener('scroll', () => {
  el.edHead.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

window.addEventListener('resize', () => {
  if (!el.edBody.hidden) { autoGrow(el.title); autoGrow(el.content); }
});

/* ── busca e gaveta mobile ──────────────────────────────── */

el.search.addEventListener('input', renderList);
el.search.addEventListener('keydown', e => {
  if (e.key === 'Escape') { el.search.value = ''; renderList(); el.search.blur(); }
});

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

function openDrawer() {
  if (!isMobile()) return;
  el.sidebar.classList.add('open');
  el.scrim.hidden = false;
  requestAnimationFrame(() => el.scrim.classList.add('on'));
}
function closeDrawer() {
  el.sidebar.classList.remove('open');
  el.scrim.classList.remove('on');
  setTimeout(() => { el.scrim.hidden = true; }, 200);
}
el.btnMenu.addEventListener('click', openDrawer);
el.scrim.addEventListener('click', closeDrawer);

/* ── atalhos ────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); openDrawer(); el.search.focus(); el.search.select(); }
  else if (k === 's') { e.preventDefault(); flush(); }
  else if (k === 'e' && currentId) { e.preventDefault(); setPreview(!previewOn); }
  else if (k === 'd' && currentId) { e.preventDefault(); togglePin(); }
  else if (k === 'j' && e.shiftKey) { e.preventDefault(); newNote(); }
});

/* ── rede ───────────────────────────────────────────────── */

window.addEventListener('online', () => { setSync('Reconectado'); flush().then(pull); });
window.addEventListener('offline', () => setSync('Offline — edições ficam salvas aqui', true));
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) { flush(); pull(); } });
window.addEventListener('beforeunload', e => {
  if (pendingCount()) { flush(); e.preventDefault(); e.returnValue = ''; }
});

/* ── autenticação ───────────────────────────────────────── */

const ERRORS = {
  'invalid login credentials': 'Email ou senha incorretos.',
  'invalid_credentials': 'Email ou senha incorretos.',
  'email not confirmed': 'Confirme seu email pelo link que enviamos.',
  'password should be at least': 'A senha precisa ter pelo menos 8 caracteres.',
  'email rate limit exceeded': 'Muitas tentativas. Espere alguns minutos.',
  'over_request_rate_limit': 'Muitas tentativas. Espere alguns minutos.',
};

function humanize(msg) {
  const low = (msg || '').toLowerCase();
  for (const k in ERRORS) if (low.includes(k)) return ERRORS[k];
  return msg || 'Algo deu errado.';
}

function authMsg(text, ok) {
  el.authMsg.textContent = text;
  el.authMsg.classList.toggle('ok', !!ok);
}

function resetAuth() {
  el.password.value = '';
  authMsg('');
}

el.authForgot.addEventListener('click', async () => {
  const mail = el.email.value.trim();
  if (!mail) { authMsg('Escreva seu email primeiro.'); el.email.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.href.split('#')[0] });
  authMsg(error ? humanize(error.message) : 'Link de recuperação enviado pro seu email.', !error);
});

el.authForm.addEventListener('submit', async e => {
  e.preventDefault();
  el.authSubmit.disabled = true;
  authMsg('');
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: el.email.value.trim(),
      password: el.password.value,
    });
    if (error) authMsg(humanize(error.message));
  } finally {
    el.authSubmit.disabled = false;
  }
});

el.btnLogout.addEventListener('click', async () => {
  if (pendingCount() && !confirm('Existem alterações não enviadas. Sair mesmo assim?')) return;
  await flush();
  await sb.auth.signOut();
});

/* ── ciclo de vida da sessão ────────────────────────────── */

async function enter(session) {
  user = session.user;
  el.whoMail.textContent = user.email;
  el.avatar.textContent = (user.email || '?').charAt(0);
  el.password.value = '';

  const hadCache = loadCache(user.id);
  show('app');
  syncMoveOptions();
  renderList();

  const last = localStorage.getItem(LS.last);
  openNote(noteById(last) ? last : (notes[0] ? notes[0].id : null));

  setSync(hadCache ? 'Sincronizando…' : 'Carregando…');
  await pull();
  if (!notes.length) newNote();
  subscribe();
  flush();
}

function leave() {
  user = null;
  notes = []; folders = [];
  pendingN.clear(); pendingF.clear(); deletingN.clear(); deletingF.clear();
  currentId = null; currentFolder = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  localStorage.removeItem(LS.cache);
  localStorage.removeItem(LS.last);
  resetAuth();
  show('auth');
}

function configured() {
  const u = (CFG.SUPABASE_URL || '').trim();
  const k = (CFG.SUPABASE_ANON_KEY || '').trim();
  return u.startsWith('http') && !u.includes('SEU-PROJETO') && k.length > 20 && !k.includes('SUA-CHAVE');
}

async function boot() {
  applyTheme();

  if (!configured() || !window.supabase) { show('setup'); return; }

  sb = window.supabase.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      const pass = prompt('Digite a nova senha (mínimo 8 caracteres):');
      if (pass && pass.length >= 8) {
        const { error } = await sb.auth.updateUser({ password: pass });
        alert(error ? humanize(error.message) : 'Senha atualizada.');
      }
      return;
    }
    if (event === 'SIGNED_IN' && !user) enter(session);
    if (event === 'SIGNED_OUT') leave();
  });

  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session);
  else { resetAuth(); show('auth'); }
}

boot().catch(err => {
  console.error(err);
  show('auth');
  authMsg('Não consegui iniciar: ' + err.message);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

})();
