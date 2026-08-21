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
  btnDelete: $('btn-delete'),
  menu: $('menu'), fmt: $('fmt'), arquivo: $('arquivo'),
  modal: $('modal'), modalForm: $('modal-form'), modalTitle: $('modal-title'),
  modalInput: $('modal-input'), modalOk: $('modal-ok'), modalCancel: $('modal-cancel'),
};

// o corpo da nota é um contenteditable que já mostra a formatação pronta;
// depois disto ele responde igualzinho a uma <textarea>
if (window.EditorVivo) {
  window.EditorVivo.instalar(el.content, {
    anexo: caminho => urlAssinada(caminho),
    abrir: url => abrirLink(url),
  });
}

const LS = { cache: 'notas:cache', theme: 'notas:theme', last: 'notas:last' };
const NCOLS = ['id', 'user_id', 'title', 'content', 'folder_id', 'pinned', 'color', 'ordem', 'created_at', 'updated_at'];
const FCOLS = ['id', 'user_id', 'name', 'color', 'ordem', 'created_at', 'updated_at'];

// Banco de antes da ordenação manual não tem a coluna `ordem`. Em vez de
// quebrar o sync inteiro, o app percebe e segue sem ela até rodarem o schema.
let temColunaOrdem = true;
const colunas = base => temColunaOrdem ? base : base.filter(c => c !== 'ordem');
const faltaOrdem = e => !!e && /ordem/i.test((e.message || '') + (e.details || '') + (e.hint || ''));

function semColunaOrdem() {
  if (!temColunaOrdem) return false;
  temColunaOrdem = false;
  console.warn('[sync] banco sem a coluna "ordem" — rode o schema.sql pra guardar a ordem manual');
  return true;
}

const CORES = [
  { id: null, nome: 'Padrão' }, { id: 'vermelho', nome: 'Vermelho' },
  { id: 'laranja', nome: 'Laranja' }, { id: 'amarelo', nome: 'Amarelo' },
  { id: 'verde', nome: 'Verde' }, { id: 'azul', nome: 'Azul' },
  { id: 'roxo', nome: 'Roxo' }, { id: 'rosa', nome: 'Rosa' },
  { id: 'cinza', nome: 'Cinza' },
];
const corValida = c => CORES.some(x => x.id === c);

let sb = null;
let user = null;
let notes = [];
let folders = [];
let pendingN = new Map(), pendingF = new Map();
let deletingN = new Set(), deletingF = new Set();
let currentId = null;
let currentFolder = null;      // null = raiz
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

/* ── caixa de texto ─────────────────────────────────────── */
/* O Electron não implementa window.prompt() — chamar trava a ação inteira.
   Esta caixa faz o mesmo papel e ainda combina com o resto do app. */

let fecharModal = null;

function pedirTexto(titulo, valor, opcoes) {
  const op = opcoes || {};
  if (fecharModal) fecharModal(null);

  el.modalTitle.textContent = titulo;
  el.modalInput.type = op.senha ? 'password' : 'text';
  el.modalInput.value = valor || '';
  el.modalInput.placeholder = op.dica || '';
  el.modalOk.textContent = op.ok || 'Salvar';
  el.modal.hidden = false;
  el.modalInput.focus();
  el.modalInput.select();

  return new Promise(resolve => {
    fecharModal = resposta => {
      el.modal.hidden = true;
      el.modalInput.value = '';
      fecharModal = null;
      document.removeEventListener('keydown', naTecla, true);
      resolve(resposta);
    };
    function naTecla(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharModal(null); }
    }
    document.addEventListener('keydown', naTecla, true);
  });
}

el.modalForm.addEventListener('submit', e => {
  e.preventDefault();
  if (fecharModal) fecharModal(el.modalInput.value);
});
el.modalCancel.addEventListener('click', () => { if (fecharModal) fecharModal(null); });
el.modal.addEventListener('mousedown', e => {
  if (e.target === el.modal && fecharModal) fecharModal(null);
});

function show(screen) {
  el.boot.hidden = true;
  el.setup.hidden = screen !== 'setup';
  el.auth.hidden  = screen !== 'auth';
  el.app.hidden   = screen !== 'app';
}

function autoGrow(t) {
  if (t.tagName !== 'TEXTAREA') return;       // o editor vivo cresce sozinho
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

const SVGNS = 'http://www.w3.org/2000/svg';
const FOLDER_ICON = 'M1.5 3.5A1.5 1.5 0 013 2h3.1a1.5 1.5 0 011.06.44L8.2 3.5H13a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12v-8.5z';

function pintar(elm, cor) {
  // só cores da paleta viram CSS — nunca o valor cru vindo do banco
  if (corValida(cor) && cor) {
    elm.dataset.color = cor;
    elm.style.setProperty('--cor', 'var(--c-' + cor + ')');
  } else {
    delete elm.dataset.color;
    elm.style.removeProperty('--cor');
  }
}

function amostra(cor) {
  const s = document.createElement('span');
  s.className = 'swatch' + (cor ? '' : ' none');
  if (corValida(cor) && cor) s.style.setProperty('--cor', 'var(--c-' + cor + ')');
  return s;
}

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

/* ── anexos: "anexo:CAMINHO" vira URL assinada ───────────── */

const urlsAssinadas = new Map();   // caminho -> { url, expira }

async function urlAssinada(caminho) {
  const agora = Date.now();
  const guardada = urlsAssinadas.get(caminho);
  if (guardada && guardada.expira > agora + 60000) return guardada.url;
  if (!sb || !user) return null;
  const { data, error } = await sb.storage.from('anexos').createSignedUrl(caminho, 3600);
  if (error || !data) { console.error('[anexo]', error); return null; }
  urlsAssinadas.set(caminho, { url: data.signedUrl, expira: agora + 3600000 });
  return data.signedUrl;
}

// Ctrl+clique num link da nota: anexo abre com URL assinada, resto vai direto
async function abrirLink(url) {
  const destino = url.startsWith('anexo:') ? await urlAssinada(url.slice(6)) : url;
  if (!destino) return;
  if (/^(mailto|tel):/i.test(destino)) { window.open(destino); return; }
  let alvo;
  try { alvo = new URL(destino, location.href); } catch (e) { return; }
  if (/^https?:$/.test(alvo.protocol)) window.open(alvo.href, '_blank', 'noopener');
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
  const bF = [...pendingF.values()].map(f => strip(f, colunas(FCOLS)));
  const bN = [...pendingN.values()].map(n => strip(n, colunas(NCOLS)));
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
    if (faltaOrdem(e) && semColunaOrdem()) { flush(); return; }
    console.error('[sync]', e);
    setSync('Erro ao salvar — tentando de novo', true);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, 6000);
  }
}

async function pull() {
  if (!sb || !user || !navigator.onLine) return;

  const [rn, rf] = await Promise.all([
    sb.from('notes').select(colunas(NCOLS).join(',')).order('updated_at', { ascending: false }),
    sb.from('folders').select(colunas(FCOLS).join(',')),
  ]);

  if (rn.error || rf.error) {
    const erro = rn.error || rf.error;
    if (faltaOrdem(erro) && semColunaOrdem()) return pull();
    console.error('[pull]', erro);
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

function listMessage(text) {
  const p = document.createElement('p');
  p.className = 'list-empty';
  p.textContent = text;
  return p;
}

function noteRow(n, grupo, i) {
  const b = document.createElement('button');
  b.className = 'item' + (n.id === currentId ? ' on' : '');
  b.dataset.id = n.id;
  if (grupo) { b.dataset.grupo = grupo; b.dataset.i = i; }
  b.draggable = true;

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
  pintar(b, n.color);
  return b;
}

function folderRow(f, grupo, i) {
  const count = notes.filter(n => n.folder_id === f.id).length;
  const b = document.createElement('button');
  b.className = 'item folder';
  b.dataset.folder = f.id;
  if (grupo) { b.dataset.grupo = grupo; b.dataset.i = i; }
  b.draggable = true;

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
  pintar(b, f.color);
  return b;
}

function byRecency(a, b) { return Date.parse(b.updated_at) - Date.parse(a.updated_at); }
function byName(a, b) { return fold(a.name).localeCompare(fold(b.name), 'pt-BR'); }

/* ── a ordem que você escolher ──────────────────────────── */
/* `ordem` manda; quem nunca foi arrastado vem depois, por recência. Assim a
   lista continua se organizando sozinha até o dia em que você mexer nela. */

const temOrdem = x => Number.isFinite(x.ordem);

function ordenar(lista, empate) {
  return lista.slice().sort((a, b) => {
    if (temOrdem(a) && temOrdem(b)) return a.ordem - b.ordem || empate(a, b);
    if (temOrdem(a) !== temOrdem(b)) return temOrdem(a) ? -1 : 1;
    return empate(a, b);
  });
}

// grupo = "tipo:pasta" — cada um é uma faixa contígua da lista lateral
function itensDoGrupo(grupo) {
  const corte = grupo.indexOf(':');
  const tipo = grupo.slice(0, corte);
  const pasta = grupo.slice(corte + 1);
  if (tipo === 'pastas') return ordenar(folders, byName);
  if (tipo === 'fix') return ordenar(notes.filter(n => n.pinned && (!pasta || n.folder_id === pasta)), byRecency);
  if (tipo === 'soltas') return ordenar(notes.filter(n => !n.pinned && !n.folder_id), byRecency);
  return ordenar(notes.filter(n => !n.pinned && n.folder_id === pasta), byRecency);
}

function renderList() {
  clearTimeout(listTimer);
  const q = fold(el.search.value.trim());

  el.list.replaceChildren();
  el.crumb.hidden = !currentFolder || !!q;

  // ── busca: resultado plano, atravessa pastas (aqui não se reordena)
  if (q) {
    const hits = notes
      .filter(n => fold(n.title).includes(q) || fold(n.content).includes(q))
      .sort(byRecency);
    if (!hits.length) { el.list.append(listMessage('Nada encontrado.')); return; }
    hits.forEach(n => el.list.append(noteRow(n, '', 0)));
    return;
  }

  const despejar = (grupo, linha) => {
    const itens = itensDoGrupo(grupo);
    itens.forEach((x, i) => el.list.append(linha(x, grupo, i)));
    return itens.length;
  };

  // ── dentro de uma pasta
  if (currentFolder) {
    const f = folderById(currentFolder);
    el.crumbName.textContent = f ? ((f.name || '').trim() || 'Sem nome') : '';
    const fixadas = despejar('fix:' + currentFolder, noteRow);
    const resto = despejar('notas:' + currentFolder, noteRow);
    if (!fixadas && !resto) el.list.append(listMessage('Pasta vazia. Arraste uma nota pra cá, ou use "Nova nota".'));
    return;
  }

  // ── raiz: fixadas no topo, pastas, depois o resto
  const fixadas = despejar('fix:', noteRow);
  const pastas = despejar('pastas:', folderRow);
  const soltas = despejar('soltas:', noteRow);
  if (!fixadas && !pastas && !soltas) el.list.append(listMessage('Nenhuma nota ainda.'));
}

el.list.addEventListener('click', e => {
  if (swallowClick) { swallowClick = false; return; }
  const f = e.target.closest('.item.folder');
  if (f) { currentFolder = f.dataset.folder; el.search.value = ''; renderList(); return; }
  const b = e.target.closest('.item');
  if (!b) return;
  openNote(b.dataset.id);
  closeDrawer();
});

el.btnBack.addEventListener('click', () => { currentFolder = null; renderList(); });

/* ── arrastar: joga na pasta ou ordena do jeito que quiser ─ */

let arrasto = null;      // { tipo, id }
let destino = null;      // { dentro } ou { grupo, indice }

function moveNote(id, folderId) {
  const n = noteById(id);
  if (!n) return false;
  const dest = folderId || null;
  if ((n.folder_id || null) === dest) return false;
  n.folder_id = dest;
  n.updated_at = new Date().toISOString();
  pendingN.set(n.id, n);
  sortNotes(); saveCache(); renderList();
  if (currentId === n.id) el.move.value = dest || '';
  setSync('Salvando…');
  flushSoon(200);
  return true;
}

function clearDropHints() {
  document.querySelectorAll('.drop-on,.drop-antes,.drop-depois')
    .forEach(e => e.classList.remove('drop-on', 'drop-antes', 'drop-depois'));
}

// nota não entra na faixa das pastas, e pasta não sai dela
function podeSoltar(grupo) {
  if (!grupo || !arrasto) return false;
  const ehFaixaDePastas = grupo.startsWith('pastas:');
  return arrasto.tipo === 'pasta' ? ehFaixaDePastas : !ehFaixaDePastas;
}

// cair noutra faixa também fixa, desafixa ou muda a nota de pasta
function aplicarGrupo(n, grupo) {
  const corte = grupo.indexOf(':');
  const fixar = grupo.slice(0, corte) === 'fix';
  const pasta = grupo.slice(corte + 1);
  const destinoPasta = pasta || (fixar ? (n.folder_id || null) : null);
  if (!!n.pinned === fixar && (n.folder_id || null) === destinoPasta) return false;
  n.pinned = fixar;
  n.folder_id = destinoPasta;
  n.updated_at = new Date().toISOString();
  return true;
}

// renumera a faixa inteira; só quem saiu do lugar vai pro servidor
function numerar(lista, pend) {
  lista.forEach((x, i) => {
    const alvo = (i + 1) * 10;
    if (x.ordem === alvo) return;
    x.ordem = alvo;
    pend.set(x.id, x);
  });
}

function soltarEm(grupo, indice) {
  const ehPasta = arrasto.tipo === 'pasta';
  const item = ehPasta ? folderById(arrasto.id) : noteById(arrasto.id);
  if (!item) return;

  const mudouDeFaixa = !ehPasta && aplicarGrupo(item, grupo);
  const lista = itensDoGrupo(grupo).filter(x => x.id !== item.id);
  lista.splice(Math.max(0, Math.min(indice, lista.length)), 0, item);

  const pend = ehPasta ? pendingF : pendingN;
  if (mudouDeFaixa) pend.set(item.id, item);
  numerar(lista, pend);

  sortNotes(); sortFolders(); saveCache(); syncMoveOptions(); renderList();
  if (mudouDeFaixa && currentId === item.id) { paintPin(item); el.move.value = item.folder_id || ''; }
  setSync('Salvando…');
  flushSoon(200);
}

el.list.addEventListener('dragstart', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  arrasto = row.dataset.folder
    ? { tipo: 'pasta', id: row.dataset.folder }
    : { tipo: 'nota', id: row.dataset.id };
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', arrasto.id);
});

el.list.addEventListener('dragend', () => {
  arrasto = null;
  destino = null;
  document.querySelectorAll('.dragging').forEach(e => e.classList.remove('dragging'));
  clearDropHints();
});

el.list.addEventListener('dragover', e => {
  if (!arrasto) return;
  const row = e.target.closest('.item');
  clearDropHints();
  destino = null;

  if (row) {
    const r = row.getBoundingClientRect();
    const onde = (e.clientY - r.top) / (r.height || 1);
    const naPasta = row.classList.contains('folder') && arrasto.tipo === 'nota';

    if (naPasta && onde > 0.28 && onde < 0.72) {
      destino = { dentro: row.dataset.folder };
      row.classList.add('drop-on');
    } else if (podeSoltar(row.dataset.grupo)) {
      const depois = onde > 0.5;
      destino = { grupo: row.dataset.grupo, indice: Number(row.dataset.i) + (depois ? 1 : 0) };
      row.classList.add(depois ? 'drop-depois' : 'drop-antes');
    }
  } else {
    // espaço vazio embaixo: cai no fim da última faixa que aceitar
    const ultima = [...el.list.querySelectorAll('.item[data-grupo]')]
      .reverse().find(x => podeSoltar(x.dataset.grupo));
    if (ultima) {
      destino = { grupo: ultima.dataset.grupo, indice: Number(ultima.dataset.i) + 1 };
      ultima.classList.add('drop-depois');
    }
  }

  if (!destino) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

el.list.addEventListener('dragleave', e => {
  if (!el.list.contains(e.relatedTarget)) { clearDropHints(); destino = null; }
});

el.list.addEventListener('drop', e => {
  if (!arrasto || !destino) return;
  e.preventDefault();
  if (destino.dentro) moveNote(arrasto.id, destino.dentro);
  else soltarEm(destino.grupo, destino.indice);
  arrasto = null;
  destino = null;
  clearDropHints();
});

// dentro de uma pasta, soltar no "voltar" tira a nota da pasta
el.btnBack.addEventListener('dragover', e => {
  if (!arrasto || arrasto.tipo !== 'nota') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  el.btnBack.classList.add('drop-on');
});
el.btnBack.addEventListener('dragleave', () => el.btnBack.classList.remove('drop-on'));
el.btnBack.addEventListener('drop', e => {
  if (!arrasto || arrasto.tipo !== 'nota') return;
  e.preventDefault();
  moveNote(arrasto.id, null);
  arrasto = null;
  destino = null;
  clearDropHints();
});

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

el.btnNewFolder.addEventListener('click', async () => {
  if (!user) return;
  const name = ((await pedirTexto('Nova pasta', '', { dica: 'Nome da pasta', ok: 'Criar' })) || '').trim();
  if (!name) return;
  const now = new Date().toISOString();
  const f = { id: crypto.randomUUID(), user_id: user.id, name, color: null, created_at: now, updated_at: now };
  folders.push(f);
  pendingF.set(f.id, f);
  sortFolders(); saveCache(); syncMoveOptions(); renderList();
  flushSoon(300);
});

async function renameFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const name = ((await pedirTexto('Renomear pasta', f.name, { ok: 'Renomear' })) || '').trim();
  if (!name || name === f.name) return;
  f.name = name;
  f.updated_at = new Date().toISOString();
  pendingF.set(f.id, f);
  sortFolders(); saveCache(); syncMoveOptions(); renderList();
  flushSoon(300);
}
el.btnRenameFolder.addEventListener('click', () => renameFolder(currentFolder));

function deleteFolder(id) {
  const f = folderById(id);
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
  if (currentFolder === f.id) currentFolder = null;
  saveCache(); syncMoveOptions(); renderList();
  flush();
}
el.btnDelFolder.addEventListener('click', () => deleteFolder(currentFolder));

el.move.addEventListener('change', () => {
  if (currentId) moveNote(currentId, el.move.value || null);
});

/* ── menu de contexto (botão direito / toque longo) ─────── */

function closeMenu() {
  if (el.menu.hidden) return;
  el.menu.hidden = true;
  el.menu.replaceChildren();
}

function openMenu(x, y, items) {
  el.menu.replaceChildren();

  for (const it of items) {
    if (it.sep) {
      const d = document.createElement('div');
      d.className = 'menu-sep';
      el.menu.append(d);
      continue;
    }
    if (it.head) {
      const h = document.createElement('div');
      h.className = 'menu-head';
      h.textContent = it.head;
      el.menu.append(h);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item' + (it.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    if (it.icon) b.append(icon(it.icon));
    if ('swatch' in it) b.append(amostra(it.swatch));
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = it.label;
    b.append(l);
    if (it.checked) {
      const t = document.createElement('span');
      t.className = 'tick';
      t.textContent = '✓';
      b.append(t);
    }
    if (it.disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeMenu(); it.run(); });
    el.menu.append(b);
  }

  // mede escondido no canto, depois encaixa dentro da janela
  el.menu.style.left = '0px';
  el.menu.style.top = '0px';
  el.menu.hidden = false;
  const r = el.menu.getBoundingClientRect();
  el.menu.style.left = Math.max(8, Math.min(x, window.innerWidth  - r.width  - 8)) + 'px';
  el.menu.style.top  = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}

function setColor(id, cor, ehNota) {
  const alvo = ehNota ? noteById(id) : folderById(id);
  if (!alvo || !corValida(cor)) return;
  alvo.color = cor;
  alvo.updated_at = new Date().toISOString();
  (ehNota ? pendingN : pendingF).set(alvo.id, alvo);
  saveCache(); renderList();
  setSync('Salvando…');
  flushSoon(200);
}

function itensDeCor(alvo, ehNota) {
  return [
    { sep: true },
    { head: 'Cor' },
    ...CORES.map(c => ({
      label: c.nome,
      swatch: c.id,
      checked: (alvo.color || null) === c.id,
      run: () => setColor(alvo.id, c.id, ehNota),
    })),
  ];
}

function menuForRow(row, x, y) {
  if (row.classList.contains('folder')) {
    const f = folderById(row.dataset.folder);
    if (!f) return;
    openMenu(x, y, [
      { label: 'Abrir pasta', icon: FOLDER_ICON,
        run: () => { currentFolder = f.id; el.search.value = ''; renderList(); closeDrawer(); } },
      { sep: true },
      { label: 'Renomear', run: () => renameFolder(f.id) },
      ...itensDeCor(f, false),
      { sep: true },
      { label: 'Excluir pasta', danger: true, run: () => deleteFolder(f.id) },
    ]);
    return;
  }

  const n = noteById(row.dataset.id);
  if (!n) return;

  const items = [
    { label: n.pinned ? 'Desafixar' : 'Fixar no topo', run: () => togglePin(n.id) },
    { label: 'Duplicar', run: () => duplicateNote(n.id) },
    { sep: true },
    { head: 'Mover para' },
    { label: 'Sem pasta', checked: !n.folder_id, run: () => moveNote(n.id, null) },
  ];
  if (!folders.length) {
    items.push({ label: 'Nenhuma pasta criada ainda', disabled: true });
  } else {
    for (const f of folders) {
      items.push({
        label: (f.name || '').trim() || 'Sem nome',
        icon: FOLDER_ICON,
        checked: n.folder_id === f.id,
        run: () => moveNote(n.id, f.id),
      });
    }
  }
  items.push(...itensDeCor(n, true));
  items.push({ sep: true }, { label: 'Excluir nota', danger: true, run: () => deleteNote(n.id) });

  openMenu(x, y, items);
}

el.list.addEventListener('contextmenu', e => {
  const row = e.target.closest('.item');
  if (!row) return;
  e.preventDefault();
  menuForRow(row, e.clientX, e.clientY);
});

// toque longo no celular, onde não existe botão direito
let pressTimer = null;
let swallowClick = false;

el.list.addEventListener('touchstart', e => {
  const row = e.target.closest('.item');
  if (!row || e.touches.length !== 1) return;
  const t = e.touches[0];
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 800);   // não come um clique legítimo depois
    if (navigator.vibrate) navigator.vibrate(12);
    menuForRow(row, t.clientX, t.clientY);
  }, 480);
}, { passive: true });

const cancelPress = () => clearTimeout(pressTimer);
el.list.addEventListener('touchmove', cancelPress, { passive: true });
el.list.addEventListener('touchend', cancelPress);
el.list.addEventListener('touchcancel', cancelPress);
el.list.addEventListener('scroll', closeMenu, { passive: true });

document.addEventListener('pointerdown', e => {
  if (!el.menu.hidden && !el.menu.contains(e.target)) closeMenu();
}, true);
window.addEventListener('resize', closeMenu);
window.addEventListener('blur', closeMenu);

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
}

function openNote(id) {
  currentId = id;
  if (id) localStorage.setItem(LS.last, id); else localStorage.removeItem(LS.last);

  const n = id ? noteById(id) : null;
  el.edBody.hidden = !n;
  el.empty.hidden = !!n;
  el.btnDelete.hidden = !n;
  el.btnPin.hidden = !n;
  el.move.hidden = !n;
  el.fmt.hidden = !n;
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
  renderListSoon();
  flushSoon();
}

el.title.addEventListener('input', touch);
el.content.addEventListener('input', touch);

el.title.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); el.content.focus(); el.content.setSelectionRange(0, 0); }
});

/* A folha tem margem larga dos dois lados do texto. Clicar nela não acertava
   nada e o cursor simplesmente não aparecia — como numa folha de papel de
   verdade, o clique agora cai na linha mais próxima. */
const pontoDoCursor = (x, y) => {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (!document.caretPositionFromPoint) return null;
  const p = document.caretPositionFromPoint(x, y);
  if (!p) return null;
  const r = document.createRange();
  r.setStart(p.offsetNode, p.offset);
  r.collapse(true);
  return r;
};

el.edBody.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target !== el.edBody) return;   // só a margem, não os filhos
  const r = el.content.getBoundingClientRect();
  if (e.clientY < r.top) { el.title.focus(); return; }    // acima do corpo é o título
  e.preventDefault();
  const alcance = pontoDoCursor(
    Math.min(Math.max(e.clientX, r.left + 1), r.right - 1),
    Math.min(Math.max(e.clientY, r.top + 1), r.bottom - 1),
  );
  el.content.focus();
  if (!alcance || !el.content.contains(alcance.startContainer)) return;
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(alcance);
});

el.content.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = el.content.selectionStart, en = el.content.selectionEnd;
    el.content.setRangeText('  ', s, en, 'end');
    touch();
  }
});

function togglePin(id) {
  const n = noteById(id || currentId);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated_at = new Date().toISOString();
  pendingN.set(n.id, n);
  if (n.id === currentId) paintPin(n);
  sortNotes(); saveCache(); renderList();
  setSync('Salvando…');
  flushSoon(200);
}
el.btnPin.addEventListener('click', () => togglePin(currentId));

function duplicateNote(id) {
  const src = noteById(id);
  if (!src || !user) return;
  const now = new Date().toISOString();
  const copy = {
    id: crypto.randomUUID(), user_id: user.id,
    title: (src.title || '').trim() ? src.title + ' (cópia)' : '',
    content: src.content, folder_id: src.folder_id || null, pinned: false,
    color: src.color || null, created_at: now, updated_at: now,
  };
  notes.unshift(copy);
  pendingN.set(copy.id, copy);
  saveCache();
  openNote(copy.id);
  flushSoon(300);
}

function deleteNote(id) {
  const n = noteById(id);
  if (!n) return;
  if (!confirm('Excluir ' + ((n.title || '').trim() || 'esta nota') + '? Não dá pra desfazer.')) return;

  const wasIn = n.folder_id || null;
  const eraAberta = n.id === currentId;
  notes = notes.filter(x => x.id !== n.id);
  pendingN.delete(n.id);
  deletingN.add(n.id);
  saveCache();

  if (eraAberta) {
    const pool = notes.filter(x => (x.folder_id || null) === wasIn);
    openNote(pool.length ? pool[0].id : (notes[0] ? notes[0].id : null));
  } else {
    renderList();
  }
  flush();
}

function newNote() {
  if (!user) return;
  const now = new Date().toISOString();
  const n = {
    id: crypto.randomUUID(), user_id: user.id, title: '', content: '',
    folder_id: currentFolder, pinned: false, color: null,
    created_at: now, updated_at: now,
  };
  const acima = notes.filter(x => !x.pinned && (x.folder_id || null) === (currentFolder || null) && temOrdem(x));
  if (acima.length) n.ordem = Math.min(...acima.map(x => x.ordem)) - 10;
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

el.btnDelete.addEventListener('click', () => deleteNote(currentId));

/* ── barra de formatação ────────────────────────────────── */

const PREFIXOS = /^(\s*)(#{1,6} |[-*+] |\d+\. |> |- \[[ x]\] )?/;

// Negrito e itálico compartilham o asterisco, então não dá pra tratar
// os marcadores como texto opaco: conta-se quantos existem em volta e
// decide-se cada estilo por conta própria. `**x**` + itálico vira
// `***x***`; o mesmo clique de novo volta para `**x**`.
function envolverAsterisco(querItalico) {
  const t = el.content;
  let a = t.selectionStart, b = t.selectionEnd;
  while (a > 0 && t.value[a - 1] === '*') a--;
  while (b < t.value.length && t.value[b] === '*') b++;

  const trecho = t.value.slice(a, b);
  const esq = (trecho.match(/^\*+/) || [''])[0].length;
  const dir = (trecho.match(/\*+$/) || [''])[0].length;
  const par = Math.min(esq, dir);
  const nucleo = trecho.slice(esq, trecho.length - dir);

  const temItalico = par % 2 === 1;
  const temNegrito = par >= 2;
  const italico = querItalico ? !temItalico : temItalico;
  const negrito = querItalico ? temNegrito : !temNegrito;

  const marca = '*'.repeat((negrito ? 2 : 0) + (italico ? 1 : 0));
  t.setRangeText(marca + nucleo + marca, a, b, 'select');
  if (!nucleo) {
    const meio = a + marca.length;
    t.setSelectionRange(meio, meio);
  }
  t.focus(); touch();
}

function envolver(antes, depois) {
  if (antes === '*') return envolverAsterisco(true);
  if (antes === '**') return envolverAsterisco(false);

  const t = el.content;
  const a = t.selectionStart, b = t.selectionEnd;
  const sel = t.value.slice(a, b);

  // a seleção já carrega os marcadores (foi o que acabamos de aplicar)
  if (sel.length >= antes.length + depois.length &&
      sel.startsWith(antes) && sel.endsWith(depois)) {
    t.setRangeText(sel.slice(antes.length, sel.length - depois.length), a, b, 'select');
    t.focus(); touch();
    return;
  }

  // os marcadores estão em volta da seleção
  if (t.value.slice(a - antes.length, a) === antes &&
      t.value.slice(b, b + depois.length) === depois) {
    t.setRangeText(sel, a - antes.length, b + depois.length, 'select');
    t.focus(); touch();
    return;
  }

  t.setRangeText(antes + sel + depois, a, b, 'select');
  if (!sel) {
    const meio = a + antes.length;
    t.setSelectionRange(meio, meio);
  }
  t.focus(); touch();
}

function prefixar(pref) {
  const t = el.content;
  const a = t.selectionStart, b = t.selectionEnd;
  const ini = t.value.lastIndexOf('\n', a - 1) + 1;
  let fim = t.value.indexOf('\n', b);
  if (fim < 0) fim = t.value.length;

  const linhas = t.value.slice(ini, fim).split('\n');
  const todas = linhas.every(l => l.trimStart().startsWith(pref.trim()));
  const novas = linhas.map(l => {
    const limpa = l.replace(PREFIXOS, '$1');
    return todas ? limpa : limpa.replace(/^(\s*)/, '$1' + pref);
  }).join('\n');

  t.setRangeText(novas, ini, fim, 'end');
  t.focus(); touch();
}

function inserir(texto, recuo) {
  const t = el.content;
  const a = t.selectionStart;
  t.setRangeText(texto, a, t.selectionEnd, 'end');
  if (recuo != null) t.setSelectionRange(a + recuo, a + recuo);
  t.focus(); touch();
}

const PLACEHOLDER_CODIGO = 'seu codigo aqui';

function blocoDeCodigo() {
  const t = el.content;
  const sel = t.value.slice(t.selectionStart, t.selectionEnd);
  const corpo = sel || PLACEHOLDER_CODIGO;
  const inicio = t.selectionStart;
  inserir('\n```\n' + corpo + '\n```\n');
  if (!sel) {
    const p = t.value.indexOf(PLACEHOLDER_CODIGO, inicio);
    if (p >= 0) t.setSelectionRange(p, p + PLACEHOLDER_CODIGO.length);
  }
}

function callout() {
  const t = el.content;
  const sel = t.value.slice(t.selectionStart, t.selectionEnd);
  const corpo = (sel || 'Escreva o destaque aqui').split('\n').map(l => '> ' + l).join('\n');
  inserir('\n> [!NOTA]\n' + corpo + '\n\n');
}

function inserirLink() {
  const t = el.content;
  const a = t.selectionStart, b = t.selectionEnd;
  const sel = t.value.slice(a, b);
  const texto = sel || 'texto do link';
  t.setRangeText('[' + texto + '](https://)', a, b, 'end');
  const fim = t.selectionEnd - 1;                // cursor dentro dos parênteses
  t.setSelectionRange(fim, fim);
  t.focus(); touch();
}

/* ── anexos: envio ──────────────────────────────────────── */

const LIMITE = 25 * 1024 * 1024;

async function enviarArquivos(lista) {
  const arquivos = [...lista];
  if (!arquivos.length || !sb || !user || !currentId) return;
  el.fmt.classList.add('fmt-busy');

  for (const f of arquivos) {
    if (f.size > LIMITE) {
      alert('"' + f.name + '" tem ' + (f.size / 1048576).toFixed(1) + ' MB. O limite e 25 MB.');
      continue;
    }
    const seguro = f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const caminho = user.id + '/' + crypto.randomUUID() + '-' + seguro;
    setSync('Enviando ' + f.name + '…');

    const { error } = await sb.storage.from('anexos')
      .upload(caminho, f, { contentType: f.type || 'application/octet-stream' });

    if (error) {
      console.error('[anexo]', error);
      setSync('Falhou o envio de ' + f.name, true);
      alert('Nao consegui enviar "' + f.name + '".\n\n' + error.message);
      continue;
    }
    const ehImagem = /^image\//.test(f.type);
    inserir('\n' + (ehImagem ? '!' : '') + '[' + f.name + '](anexo:' + caminho + ')\n');
  }

  el.fmt.classList.remove('fmt-busy');
  flush();
}

const ACOES = {
  bold:    () => envolver('**', '**'),
  italic:  () => envolver('*', '*'),
  strike:  () => envolver('~~', '~~'),
  code:    () => envolver('`', '`'),
  h1:      () => prefixar('# '),
  h2:      () => prefixar('## '),
  h3:      () => prefixar('### '),
  ul:      () => prefixar('- '),
  ol:      () => prefixar('1. '),
  task:    () => prefixar('- [ ] '),
  quote:   () => prefixar('> '),
  block:   blocoDeCodigo,
  callout: callout,
  link:    inserirLink,
  hr:      () => inserir('\n---\n'),
  anexo:   () => el.arquivo.click(),
};

el.fmt.addEventListener('mousedown', e => {
  // impede o textarea de perder o cursor antes da acao rodar
  if (e.target.closest('button[data-fmt]')) e.preventDefault();
});
el.fmt.addEventListener('click', e => {
  const b = e.target.closest('button[data-fmt]');
  if (!b || !currentId) return;
  const acao = ACOES[b.dataset.fmt];
  if (acao) acao();
});

el.arquivo.addEventListener('change', () => {
  enviarArquivos(el.arquivo.files);
  el.arquivo.value = '';
});

// colar arquivo direto no corpo da nota
el.content.addEventListener('paste', e => {
  const fs = e.clipboardData && e.clipboardData.files;
  if (!fs || !fs.length) return;
  e.preventDefault();
  enviarArquivos(fs);
});

// arrastar arquivo pra dentro da nota
const temArquivos = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
['dragenter', 'dragover'].forEach(ev => el.edBody.addEventListener(ev, e => {
  if (!temArquivos(e) || !currentId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  el.edBody.classList.add('zona-solta');
}));
el.edBody.addEventListener('dragleave', e => {
  if (!el.edBody.contains(e.relatedTarget)) el.edBody.classList.remove('zona-solta');
});
el.edBody.addEventListener('drop', e => {
  if (!temArquivos(e) || !currentId) return;
  e.preventDefault();
  el.edBody.classList.remove('zona-solta');
  enviarArquivos(e.dataTransfer.files);
});

window.addEventListener('scroll', () => {
  el.edHead.classList.toggle('scrolled', window.scrollY > 4);
  closeMenu();
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
  if (e.key === 'Escape' && !el.menu.hidden) { closeMenu(); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'k' && e.shiftKey && currentId) { e.preventDefault(); ACOES.link(); }
  else if (k === 'k') { e.preventDefault(); openDrawer(); el.search.focus(); el.search.select(); }
  else if (k === 's') { e.preventDefault(); flush(); }
  else if (k === 'd' && currentId) { e.preventDefault(); togglePin(currentId); }
  else if (currentId && document.activeElement === el.content) {
    if (k === 'b') { e.preventDefault(); ACOES.bold(); }
    else if (k === 'i') { e.preventDefault(); ACOES.italic(); }
    else if (k === '1') { e.preventDefault(); ACOES.h1(); }
    else if (k === '2') { e.preventDefault(); ACOES.h2(); }
    else if (k === '3') { e.preventDefault(); ACOES.h3(); }
  }
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
      const pass = await pedirTexto('Nova senha', '', { senha: true, dica: 'mínimo 8 caracteres', ok: 'Atualizar' });
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
  const jaControlada = !!navigator.serviceWorker.controller;
  let recarregando = false;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const procurar = () => { reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) procurar(); });
      window.addEventListener('focus', procurar);
      setInterval(procurar, 15 * 60 * 1000);
    } catch (e) { /* sem service worker: o app funciona igual, só não cacheia */ }
  });

  // Um service worker novo assumindo significa versão nova publicada.
  // Recarrega para o usuário não ficar preso numa janela aberta há dias
  // — mas só com tudo salvo, para não atropelar edição em andamento.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaControlada || recarregando) return;
    if (pendingCount()) { flush().then(() => { recarregando = true; location.reload(); }); return; }
    recarregando = true;
    location.reload();
  });
}

})();
