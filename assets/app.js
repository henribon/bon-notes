/* Notas — app estático, backend Supabase.
   Offline-first: tudo vive no localStorage e é empurrado pro servidor quando dá. */
(() => {
'use strict';

const CFG = window.NOTAS_CONFIG || {};
const $ = id => document.getElementById(id);

const el = {
  boot: $('boot'), setup: $('setup'), auth: $('auth'), app: $('app'),
  authForm: $('auth-form'), email: $('email'), password: $('password'),
  authSubmit: $('auth-submit'), authMsg: $('auth-msg'), authToggle: $('auth-toggle'),
  authForgot: $('auth-forgot'), authTitle: $('auth-title'), authSub: $('auth-sub'),
  avatar: $('avatar'), whoMail: $('who-mail'), btnTheme: $('btn-theme'),
  search: $('search'), btnNew: $('btn-new'), btnNew2: $('btn-new-2'), list: $('list'),
  sync: $('sync'), btnLogout: $('btn-logout'),
  sidebar: $('sidebar'), scrim: $('scrim'), btnMenu: $('btn-menu'),
  edHead: document.querySelector('.ed-head'), edScroll: document.querySelector('.ed-scroll'),
  edBody: $('ed-body'), edMeta: $('ed-meta'), empty: $('empty'),
  title: $('title'), content: $('content'), preview: $('preview'),
  btnPreview: $('btn-preview'), btnDelete: $('btn-delete'),
};

const LS = { cache: 'notas:cache', theme: 'notas:theme', last: 'notas:last' };
const COLS = ['id', 'user_id', 'title', 'content', 'created_at', 'updated_at'];

let sb = null;
let user = null;
let notes = [];               // ordenadas por updated_at desc
let pending = new Map();      // id -> nota aguardando upload
let deleting = new Set();     // ids aguardando delete remoto
let currentId = null;
let previewOn = false;
let channel = null;
let saveTimer = null, listTimer = null, retryTimer = null;
let signupMode = false;

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

const fold = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function snippet(n) {
  const line = (n.content || '')
    .split('\n')
    .map(l => l.replace(/^[\s>#*\-+\d.]+/, '').trim())
    .find(l => l.length > 0);
  return line ? line.slice(0, 90) : 'Nota vazia';
}

function byId(id) { return notes.find(n => n.id === id) || null; }
function sortNotes() { notes.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)); }
function strip(n) { const o = {}; for (const c of COLS) o[c] = n[c]; return o; }

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
      notes,
      pending: [...pending.values()],
      deleting: [...deleting],
    }));
  } catch (e) { /* cota estourada: segue sem cache */ }
}

function loadCache(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS.cache) || 'null');
    if (!raw || raw.uid !== uid) return false;
    notes = raw.notes || [];
    pending = new Map((raw.pending || []).map(n => [n.id, n]));
    deleting = new Set(raw.deleting || []);
    // reaproveita os objetos pendentes para que edições continuem apontando pro mesmo item
    notes = notes.map(n => pending.get(n.id) || n);
    sortNotes();
    return notes.length > 0;
  } catch (e) { return false; }
}

/* ── sincronização ──────────────────────────────────────── */

function flushSoon(ms) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, ms == null ? 800 : ms);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!sb || !user) return;
  if (!pending.size && !deleting.size) { setSync('Tudo salvo'); return; }
  if (!navigator.onLine) {
    const n = pending.size + deleting.size;
    setSync(n === 1 ? '1 alteração guardada offline' : n + ' alterações guardadas offline', true);
    return;
  }

  setSync('Salvando…');
  const batch = [...pending.values()].map(strip);
  const dels  = [...deleting];

  try {
    if (batch.length) {
      const { error } = await sb.from('notes').upsert(batch);
      if (error) throw error;
      for (const n of batch) {
        const cur = pending.get(n.id);
        if (cur && cur.updated_at === n.updated_at) pending.delete(n.id);
      }
    }
    if (dels.length) {
      const { error } = await sb.from('notes').delete().in('id', dels);
      if (error) throw error;
      for (const id of dels) deleting.delete(id);
    }
    saveCache();
    setSync(pending.size ? 'Salvando…' : 'Tudo salvo');
    if (pending.size) flushSoon(400);
  } catch (e) {
    console.error('[sync]', e);
    setSync('Erro ao salvar — tentando de novo', true);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, 6000);
  }
}

async function pull() {
  if (!sb || !user || !navigator.onLine) return;
  const { data, error } = await sb.from('notes').select(COLS.join(',')).order('updated_at', { ascending: false });
  if (error) { console.error('[pull]', error); setSync('Sem conexão com o servidor', true); return; }

  const map = new Map(data.map(n => [n.id, n]));
  for (const [id, n] of pending) map.set(id, n);   // edição local ainda não enviada vence
  for (const id of deleting) map.delete(id);

  notes = [...map.values()];
  sortNotes();
  saveCache();
  renderList();

  if (currentId && !byId(currentId)) openNote(null);
  else if (currentId && !pending.has(currentId)) fillEditor(byId(currentId));
  setSync(pending.size ? 'Salvando…' : 'Tudo salvo');
}

function subscribe() {
  if (!sb || !user) return;
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('notes-' + user.id)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: 'user_id=eq.' + user.id },
        onRemote)
    .subscribe();
}

function onRemote(payload) {
  const type = payload.eventType;
  if (type === 'DELETE') {
    const id = payload.old && payload.old.id;
    if (!id) return;
    notes = notes.filter(n => n.id !== id);
    pending.delete(id);
    if (currentId === id) openNote(null);
    renderList(); saveCache();
    return;
  }
  const n = payload.new;
  if (!n || pending.has(n.id) || deleting.has(n.id)) return;
  const i = notes.findIndex(x => x.id === n.id);
  if (i < 0) notes.push(n); else notes[i] = n;
  sortNotes(); renderList(); saveCache();
  if (currentId === n.id) fillEditor(n);
}

/* ── lista ──────────────────────────────────────────────── */

function renderListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderList, 500); }

function renderList() {
  clearTimeout(listTimer);
  const q = fold(el.search.value.trim());
  const visible = q
    ? notes.filter(n => fold(n.title).includes(q) || fold(n.content).includes(q))
    : notes;

  el.list.replaceChildren();

  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'list-empty';
    p.textContent = q ? 'Nada encontrado.' : 'Nenhuma nota ainda.';
    el.list.append(p);
    return;
  }

  const now = Date.now();
  let group = null;

  for (const n of visible) {
    const age = now - new Date(n.updated_at).getTime();
    const g = age < 86400e3 ? 'Hoje' : age < 604800e3 ? 'Últimos 7 dias' : 'Anteriores';
    if (g !== group && !q) {
      group = g;
      const h = document.createElement('div');
      h.className = 'group-label';
      h.textContent = g;
      el.list.append(h);
    }

    const b = document.createElement('button');
    b.className = 'item' + (n.id === currentId ? ' on' : '');
    b.dataset.id = n.id;

    const t = document.createElement('div');
    t.className = 'item-t';
    t.textContent = n.title.trim() || 'Sem título';

    const s = document.createElement('div');
    s.className = 'item-s';
    s.textContent = snippet(n);

    b.append(t, s);
    el.list.append(b);
  }
}

el.list.addEventListener('click', e => {
  const b = e.target.closest('.item');
  if (!b) return;
  openNote(b.dataset.id);
  closeDrawer();
});

/* ── editor ─────────────────────────────────────────────── */

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
  el.edMeta.textContent = 'Editada ' + rel(n.updated_at);
  if (previewOn) paintPreview(n.content);
}

function openNote(id) {
  currentId = id;
  if (id) localStorage.setItem(LS.last, id); else localStorage.removeItem(LS.last);

  const n = id ? byId(id) : null;
  el.edBody.hidden = !n;
  el.empty.hidden = !!n;
  el.btnPreview.hidden = !n;
  el.btnDelete.hidden = !n;
  el.edMeta.textContent = '';

  if (n) {
    fillEditor(n);
    el.edScroll.scrollTop = 0;
  }
  renderList();
}

function touch() {
  const n = byId(currentId);
  if (!n) return;
  n.title = el.title.value;
  n.content = el.content.value;
  n.updated_at = new Date().toISOString();
  pending.set(n.id, n);
  sortNotes();
  saveCache();
  setSync('Editando…');
  el.edMeta.textContent = 'Editada agora mesmo';
  autoGrow(el.title);
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

function newNote() {
  if (!user) return;
  const now = new Date().toISOString();
  const n = { id: crypto.randomUUID(), user_id: user.id, title: '', content: '', created_at: now, updated_at: now };
  notes.unshift(n);
  pending.set(n.id, n);
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
  const n = byId(currentId);
  if (!n) return;
  const name = n.title.trim() || 'esta nota';
  if (!confirm('Excluir ' + name + '? Não dá pra desfazer.')) return;
  notes = notes.filter(x => x.id !== n.id);
  pending.delete(n.id);
  deleting.add(n.id);
  saveCache();
  const next = notes.length ? notes[0].id : null;
  openNote(next);
  flush();
});

function setPreview(on) {
  previewOn = on;
  el.content.hidden = on;
  el.preview.hidden = !on;
  el.btnPreview.textContent = on ? 'Editar' : 'Preview';
  if (on) {
    const n = byId(currentId);
    paintPreview(n ? n.content : '');
  } else {
    el.content.focus();
  }
}
el.btnPreview.addEventListener('click', () => setPreview(!previewOn));

el.edScroll.addEventListener('scroll', () => {
  el.edHead.classList.toggle('scrolled', el.edScroll.scrollTop > 4);
}, { passive: true });

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
  else if (k === 'j' && e.shiftKey) { e.preventDefault(); newNote(); }
});

/* ── rede ───────────────────────────────────────────────── */

window.addEventListener('online', () => { setSync('Reconectado'); flush().then(pull); });
window.addEventListener('offline', () => setSync('Offline — edições ficam salvas aqui', true));
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) { flush(); pull(); } });
window.addEventListener('beforeunload', e => {
  if (pending.size || deleting.size) { flush(); e.preventDefault(); e.returnValue = ''; }
});

/* ── autenticação ───────────────────────────────────────── */

const ERRORS = {
  'invalid login credentials': 'Email ou senha incorretos.',
  'email not confirmed': 'Confirme seu email pelo link que enviamos.',
  'user already registered': 'Esse email já tem conta. Use "Entrar".',
  'password should be at least': 'A senha precisa ter pelo menos 8 caracteres.',
  'email rate limit exceeded': 'Muitas tentativas. Espere alguns minutos.',
  'signups not allowed': 'Cadastro desativado neste projeto.',
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

function setAuthMode(signup) {
  signupMode = signup;
  el.authTitle.textContent = signup ? 'Criar conta' : 'Notas';
  el.authSub.textContent = signup ? 'Só você vai enxergar o que escrever aqui.' : 'Entre para acessar seu espaço.';
  el.authSubmit.textContent = signup ? 'Criar conta' : 'Entrar';
  el.authToggle.textContent = signup ? 'Já tenho conta' : 'Criar conta';
  el.password.autocomplete = signup ? 'new-password' : 'current-password';
  authMsg('');
}
el.authToggle.addEventListener('click', () => setAuthMode(!signupMode));

el.authForgot.addEventListener('click', async () => {
  const mail = el.email.value.trim();
  if (!mail) { authMsg('Escreva seu email primeiro.'); el.email.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.href.split('#')[0] });
  authMsg(error ? humanize(error.message) : 'Link de recuperação enviado pro seu email.', !error);
});

el.authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const mail = el.email.value.trim();
  const pass = el.password.value;
  el.authSubmit.disabled = true;
  authMsg('');

  try {
    if (signupMode) {
      if (CFG.ALLOWED_EMAIL && mail.toLowerCase() !== CFG.ALLOWED_EMAIL.toLowerCase()) {
        authMsg('Este espaço é privado.');
        return;
      }
      const { data, error } = await sb.auth.signUp({ email: mail, password: pass });
      if (error) { authMsg(humanize(error.message)); return; }
      if (data.session) return;                       // confirmação de email desligada: já entrou
      authMsg('Confira seu email para confirmar a conta.', true);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: mail, password: pass });
      if (error) authMsg(humanize(error.message));
    }
  } finally {
    el.authSubmit.disabled = false;
  }
});

el.btnLogout.addEventListener('click', async () => {
  if ((pending.size || deleting.size) && !confirm('Existem alterações não enviadas. Sair mesmo assim?')) return;
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
  renderList();

  const last = localStorage.getItem(LS.last);
  openNote(byId(last) ? last : (notes[0] ? notes[0].id : null));

  setSync(hadCache ? 'Sincronizando…' : 'Carregando…');
  await pull();
  if (!notes.length) newNote();
  subscribe();
  flush();
}

function leave() {
  user = null;
  notes = []; pending.clear(); deleting.clear(); currentId = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  localStorage.removeItem(LS.cache);
  localStorage.removeItem(LS.last);
  setAuthMode(false);
  show('auth');
}

function configured() {
  const u = (CFG.SUPABASE_URL || '').trim();
  const k = (CFG.SUPABASE_ANON_KEY || '').trim();
  return u.startsWith('http') && !u.includes('SEU-PROJETO') && k.length > 20 && !k.includes('SUA-CHAVE');
}

async function boot() {
  applyTheme();

  if (!configured()) { show('setup'); return; }
  if (!window.supabase) { show('setup'); return; }

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
  else { setAuthMode(false); show('auth'); }
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
