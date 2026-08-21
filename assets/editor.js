/* Editor vivo — a formatação aparece enquanto se escreve.

   O texto continua sendo markdown puro: o que muda é que os marcadores
   (`#`, `**`, `- `) ficam com largura zero e a linha já nasce formatada,
   estilo Notion. Nada de "### OLA LOLI" na cara de quem escreve.

   Pro resto do app isso é invisível: `instalar()` devolve o mesmo contrato
   de um <textarea> (value, selectionStart, setSelectionRange, setRangeText),
   então a barra de formatação, os atalhos e o autosave continuam iguais. */
(() => {
'use strict';

/* ── análise: markdown -> pedaços de linha ──────────────── */

const CERCA   = /^\s*(?:```|~~~)/;
const TITULO  = /^(#{1,6} )(.*)$/;
const REGUA   = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const CITACAO = /^(\s*)(> ?)(.*)$/;
const TAREFA  = /^(\s*)([-*+] \[([ xX])\] )(.*)$/;
const ITEM    = /^(\s*)([-*+] )(.*)$/;
const NUMERO  = /^(\s*)(\d+[.)] )(.*)$/;
const TABELA  = /^\s*\|.*\|\s*$/;
const ABRE_CHAMADA = /^(\s*)(> ?)\[!([\wÀ-ÿ]+)\]\s*$/;

const CHAMADAS = {
  nota: ['nota', 'ℹ️', 'Nota'],            note: ['nota', 'ℹ️', 'Nota'],
  dica: ['dica', '💡', 'Dica'],            tip: ['dica', '💡', 'Dica'],
  importante: ['importante', '📌', 'Importante'],
  important: ['importante', '📌', 'Importante'],
  atencao: ['atencao', '⚠️', 'Atenção'],   warning: ['atencao', '⚠️', 'Atenção'],
  cuidado: ['cuidado', '🛑', 'Cuidado'],   caution: ['cuidado', '🛑', 'Cuidado'],
};
const dobrar = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// núcleo de um trecho enfatizado: não começa nem termina em espaço
const NUC = c => '[^\\s' + c + '](?:[^' + c + '\\n]*[^\\s' + c + '])?';
const INLINE = new RegExp([
  '(`[^`\\n]+`)',                                  // 1 código
  '(!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\))',            // 2 link ou imagem
  '(\\*\\*\\*' + NUC('*') + '\\*\\*\\*)',          // 3 negrito + itálico
  '(\\*\\*'    + NUC('*') + '\\*\\*)',             // 4 negrito
  '(\\*'       + NUC('*') + '\\*)',                // 5 itálico
  '(__'        + NUC('_') + '__)',                 // 6 negrito
  '(_'         + NUC('_') + '_)',                  // 7 itálico
  '(~~'        + NUC('~') + '~~)',                 // 8 riscado
].join('|'), 'g');

const marca  = (segs, t) => segs.push({ t, c: 'mk', f: true });
const marcaU = (segs, t) => segs.push({ t, c: 'mk url', f: true });

function cercado(segs, bruto, n, cls) {
  marca(segs, bruto.slice(0, n));
  segs.push({ t: bruto.slice(n, bruto.length - n), c: cls });
  marca(segs, bruto.slice(bruto.length - n));
}

function link(segs, bruto) {
  const corte = bruto.indexOf('](');
  const abre = bruto.slice(0, bruto.indexOf('[') + 1);   // "[" ou "!["
  const texto = bruto.slice(abre.length, corte);
  const url = bruto.slice(corte + 2, bruto.length - 1);
  const imagem = abre.charAt(0) === '!';

  marcaU(segs, abre);
  segs.push({
    t: texto,
    c: imagem ? 'legenda' : (url.startsWith('anexo:') ? 'lnk anexo' : 'lnk'),
    url,
  });
  marcaU(segs, bruto.slice(corte));                      // "](url)"
  if (imagem) segs.push({ c: 'figura', f: true, falso: true, img: url });
}

function inline(txt, segs) {
  INLINE.lastIndex = 0;
  let m, i = 0;
  while ((m = INLINE.exec(txt))) {
    if (m.index > i) segs.push({ t: txt.slice(i, m.index) });
    const bruto = m[0];
    if      (m[1]) cercado(segs, bruto, 1, 'cod');
    else if (m[2]) link(segs, bruto);
    else if (m[3]) cercado(segs, bruto, 3, 'ni');
    else if (m[4]) cercado(segs, bruto, 2, 'ng');
    else if (m[5]) cercado(segs, bruto, 1, 'it');
    else if (m[6]) cercado(segs, bruto, 2, 'ng');
    else if (m[7]) cercado(segs, bruto, 1, 'it');
    else           cercado(segs, bruto, 2, 'ris');
    i = m.index + bruto.length;
  }
  if (i < txt.length) segs.push({ t: txt.slice(i) });
}

// `sig` resume a *forma* da linha: classe, recuo e o texto dos marcadores.
// O texto comum fica de fora de propósito — enquanto só ele muda, o DOM que
// o navegador acabou de editar já está certo e não precisa ser refeito.
function info(cls, segs, recuo) {
  let sig = cls + '|' + (recuo || 0), n = 0;
  for (const s of segs) {
    if (!s.t && !s.img) continue;
    n++;
    sig += '|' + (s.c || '.') + (s.f ? ':' + (s.t || '') : '') + (s.img ? '@' + s.img : '');
  }
  return { cls, segs, recuo: recuo || 0, sig, n: n || 1 };
}

const nivel = espacos => Math.min(6, Math.floor(espacos.replace(/\t/g, '  ').length / 2));

function analisarLinha(linha, estado, fim) {
  if (estado === 'cerca') return info('ln cerca', [{ t: linha, c: 'mk', f: true }]);
  if (estado === 'codigo') return info('ln codigo', [{ t: linha }]);

  // ── callout: "> [!NOTA]" abre a caixa, as citações seguintes são o corpo
  if (estado.startsWith('chamada:')) {
    const tipo = estado.slice(8);
    const abre = ABRE_CHAMADA.exec(linha);
    const cls = 'ln cham ' + tipo + (abre ? ' ini' : '') + (fim ? ' fim' : '');
    const segs = [];
    if (abre) {
      const def = CHAMADAS[dobrar(abre[3])];
      marca(segs, linha);
      segs.push({ t: def[1], c: 'cham-ic', f: true, falso: true });
      segs.push({ t: def[2], c: 'cham-tit', f: true, falso: true });
      return info(cls, segs);
    }
    const m = CITACAO.exec(linha);
    marca(segs, m[1] + m[2]);
    inline(m[3], segs);
    return info(cls, segs);
  }

  if (!linha)             return info('ln vazia', []);
  if (REGUA.test(linha))  return info('ln regua', [{ t: linha, c: 'mk', f: true }]);
  if (TABELA.test(linha)) return info('ln tab', [{ t: linha }]);

  const segs = [];
  let cls = 'ln', recuo = 0, resto = linha, m;

  if ((m = TITULO.exec(linha))) {
    cls = 'ln h' + (m[1].length - 1);
    marca(segs, m[1]);
    resto = m[2];
  } else if ((m = CITACAO.exec(linha))) {
    cls = 'ln cit';
    recuo = nivel(m[1]);
    marca(segs, m[1] + m[2]);
    resto = m[3];
  } else if ((m = TAREFA.exec(linha))) {
    cls = 'ln tarefa' + (m[3] === ' ' ? '' : ' feita');
    recuo = nivel(m[1]);
    marca(segs, m[1] + m[2]);
    segs.push({ t: m[3] === ' ' ? '☐' : '☑', c: 'caixa', f: true, falso: true });
    resto = m[4];
  } else if ((m = ITEM.exec(linha))) {
    cls = 'ln item';
    recuo = nivel(m[1]);
    marca(segs, m[1] + m[2]);
    segs.push({ t: '•', c: 'bala', f: true, falso: true });
    resto = m[3];
  } else if ((m = NUMERO.exec(linha))) {
    cls = 'ln num';
    recuo = nivel(m[1]);
    marca(segs, m[1]);
    segs.push({ t: m[2], c: 'nb' });
    resto = m[3];
  }

  inline(resto, segs);
  return info(cls, segs, recuo);
}

const cacheLinhas = new Map();

// primeiro descobre em que bloco cada linha está (cerca de código, callout),
// depois monta cada uma. O estado entra na chave do cache junto com o texto.
function analisar(linhas) {
  const estados = [];
  let emCerca = false, cham = null;

  for (const linha of linhas) {
    if (CERCA.test(linha)) {
      estados.push('cerca');
      emCerca = !emCerca;
      cham = null;
      continue;
    }
    if (emCerca) { estados.push('codigo'); continue; }

    const abre = ABRE_CHAMADA.exec(linha);
    const def = abre && CHAMADAS[dobrar(abre[3])];
    if (def) { cham = def[0]; estados.push('chamada:' + cham); continue; }
    if (cham && CITACAO.test(linha)) { estados.push('chamada:' + cham); continue; }
    cham = null;
    estados.push('');
  }

  const saida = [];
  for (let i = 0; i < linhas.length; i++) {
    const estado = estados[i];
    const fim = estado.startsWith('chamada:') && estados[i + 1] !== estado;
    const chave = estado + (fim ? '\nF\n' : '\n\n') + linhas[i];
    let inf = cacheLinhas.get(chave);
    if (!inf) {
      inf = analisarLinha(linhas[i], estado, fim);
      if (cacheLinhas.size > 4000) cacheLinhas.clear();
      cacheLinhas.set(chave, inf);
    }
    saida.push(inf);
  }
  return saida;
}

/* ── desenho: pedaços -> DOM ────────────────────────────── */

let buscarAnexo = null;      // devolve a URL assinada de um "anexo:caminho"

// relativa ou http(s) pode; javascript:, file: e data: que não seja imagem, não
function urlSegura(u) {
  const s = (u || '').trim().toLowerCase();
  if (s.startsWith('data:')) return s.startsWith('data:image/');
  return !/^[a-z][a-z0-9+.\-]*:/.test(s) || /^(https?|blob):/.test(s);
}

function figura(url) {
  const img = document.createElement('img');
  img.className = 'figura';
  img.alt = '';
  img.draggable = false;
  img.dataset.falso = '1';
  img.contentEditable = 'false';
  if (url.startsWith('anexo:')) {
    if (buscarAnexo) {
      img.dataset.pendente = '1';
      buscarAnexo(url.slice(6)).then(u => {
        if (u) img.src = u;
        img.removeAttribute('data-pendente');
      }).catch(() => img.removeAttribute('data-pendente'));
    }
  } else if (urlSegura(url)) {
    img.src = url;
  }
  return img;
}

function montarLinha(inf) {
  const div = document.createElement('div');
  div.className = inf.cls;
  if (inf.recuo) div.style.marginLeft = inf.recuo * 1.4 + 'em';
  for (const s of inf.segs) {
    if (s.img) { div.appendChild(figura(s.img)); continue; }
    if (!s.t) continue;
    if (!s.c) { div.appendChild(document.createTextNode(s.t)); continue; }
    const sp = document.createElement('span');
    sp.className = s.c;
    sp.textContent = s.t;
    if (s.url) sp.dataset.url = s.url;
    if (s.falso) {                       // enfeite: não faz parte do markdown
      sp.dataset.falso = '1';
      sp.contentEditable = 'false';
    }
    div.appendChild(sp);
  }
  if (!div.childNodes.length) div.appendChild(document.createElement('br'));
  div.dataset.sig = inf.sig;
  return div;
}

function desenhar(raiz, fonte, tudo) {
  const infos = analisar(fonte.split('\n'));
  // texto solto que o navegador tenha largado na raiz: mais seguro refazer tudo
  for (const n of raiz.childNodes) if (n.nodeType !== 1) { tudo = true; break; }

  let mudou = false;
  for (let i = 0; i < infos.length; i++) {
    const atual = raiz.children[i];
    if (!tudo && atual && atual.dataset.sig === infos[i].sig && atual.childNodes.length === infos[i].n) continue;
    const novo = montarLinha(infos[i]);
    if (atual) raiz.replaceChild(novo, atual);
    else raiz.appendChild(novo);
    mudou = true;
  }
  while (raiz.children.length > infos.length) { raiz.lastElementChild.remove(); mudou = true; }
  for (const n of [...raiz.childNodes]) if (n.nodeType !== 1) { n.remove(); mudou = true; }
  return mudou;
}

/* ── leitura: DOM -> markdown (e onde está o cursor) ────── */

const BLOCOS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                        'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'FIGURE', 'TABLE', 'TR']);
const ehBloco = no => no.nodeType === 1 && BLOCOS.has(no.nodeName);
const ehFalso = no => no.nodeType === 1 && no.dataset && no.dataset.falso === '1';

function varrer(raiz, alvos) {
  const pos = alvos.map(() => null);
  let texto = '';
  let pendente = false;                  // um bloco acabou: o próximo começa noutra linha

  function quebra() { if (pendente) { texto += '\n'; pendente = false; } }

  function achou(no, limite, exato) {
    for (let k = 0; k < alvos.length; k++) {
      const a = alvos[k];
      if (pos[k] !== null || !a || a.no !== no) continue;
      if (exato) { if (a.off === limite) pos[k] = texto.length; }
      else pos[k] = texto.length + Math.min(a.off, limite);
    }
  }

  (function nos(pai) {
    const fs = pai.childNodes;
    for (let i = 0; i <= fs.length; i++) {
      if (alvos.some((a, k) => pos[k] === null && a && a.no === pai && a.off === i)) {
        quebra();
        achou(pai, i, true);
      }
      if (i === fs.length) break;
      const f = fs[i];
      if (ehFalso(f)) continue;
      if (ehBloco(f)) { quebra(); nos(f); pendente = true; continue; }
      quebra();
      if (f.nodeType === 3) {
        achou(f, f.data.length, false);
        texto += f.data;
      } else if (f.nodeName === 'BR') {
        if (f.nextSibling) texto += '\n';
      } else {
        nos(f);
      }
    }
  })(raiz);

  return { texto, pos };
}

/* ── do markdown de volta pro DOM: onde cravar o cursor ─── */

function dentro(ln, k) {
  const passa = n => (n.parentElement && n.parentElement.closest('[data-falso]')
    ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT);
  const w = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT, { acceptNode: passa });
  let n, acc = 0, ultimo = null;
  while ((n = w.nextNode())) {
    if (k <= acc + n.data.length) return { no: n, off: k - acc };
    acc += n.data.length;
    ultimo = n;
  }
  return ultimo ? { no: ultimo, off: ultimo.data.length } : { no: ln, off: 0 };
}

function localizar(raiz, fonte, off) {
  const linhas = fonte.split('\n');
  let acc = 0, i = 0;
  for (; i < linhas.length - 1; i++) {
    if (off <= acc + linhas[i].length) break;
    acc += linhas[i].length + 1;
  }
  const ln = raiz.children[i] || raiz.lastElementChild;
  if (!ln) return { no: raiz, off: 0 };
  return dentro(ln, Math.max(0, off - acc));
}

/* ── instalação ─────────────────────────────────────────── */

function instalar(raiz, opcoes) {
  const op = opcoes || {};
  buscarAnexo = op.anexo || null;
  raiz.setAttribute('contenteditable', 'plaintext-only');
  if (raiz.contentEditable !== 'plaintext-only') raiz.setAttribute('contenteditable', 'true');

  let fonte = '';
  let caretA = 0, caretB = 0;
  let compondo = false, aplicando = false, sujo = false;
  let ativa = null;

  const focado = () => document.activeElement === raiz;

  function selecao() {
    const s = document.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!raiz.contains(r.startContainer) || !raiz.contains(r.endContainer)) return null;
    return r;
  }

  function ler() {
    const r = selecao();
    const alvos = r
      ? [{ no: r.startContainer, off: r.startOffset }, { no: r.endContainer, off: r.endOffset }]
      : [];
    const res = varrer(raiz, alvos);
    fonte = res.texto;
    sujo = false;
    if (res.pos[0] != null) caretA = res.pos[0];
    if (res.pos[1] != null) caretB = res.pos[1];
    return res;
  }

  function colocar(a, b) {
    const s = document.getSelection();
    if (!s) return;
    try {
      const p1 = localizar(raiz, fonte, a);
      const p2 = a === b ? p1 : localizar(raiz, fonte, b);
      const r = document.createRange();
      r.setStart(p1.no, p1.off);
      r.setEnd(p2.no, p2.off);
      s.removeAllRanges();
      s.addRange(r);
    } catch (_) { /* a linha sumiu no caminho: deixa o navegador decidir */ }
  }

  function aparecer() {
    if (!ativa || !focado()) return;
    const r = ativa.getBoundingClientRect();
    const alto = window.innerHeight || document.documentElement.clientHeight;
    if (r.bottom > alto - 16 || r.top < 80) ativa.scrollIntoView({ block: 'nearest' });
  }

  function marcarAtiva() {
    const r = selecao();
    let alvo = null;
    if (r) {
      const no = r.startContainer;
      const elm = no.nodeType === 1 ? no : no.parentElement;
      alvo = elm ? elm.closest('.ln') : null;
    }
    if (alvo === ativa) return;
    if (ativa) ativa.classList.remove('ativa');
    ativa = alvo;
    if (alvo) alvo.classList.add('ativa');
  }

  function definirValor(txt, a, b) {
    fonte = txt;
    sujo = false;
    desenhar(raiz, fonte, true);
    raiz.classList.toggle('sem-texto', fonte === '');
    caretA = Math.max(0, Math.min(a, txt.length));
    caretB = Math.max(caretA, Math.min(b, txt.length));
    if (focado()) colocar(caretA, caretB);
    marcarAtiva();
  }

  function sincronizar() {
    ler();
    if (desenhar(raiz, fonte, false) && focado()) colocar(caretA, caretB);
    raiz.classList.toggle('sem-texto', fonte === '');
    marcarAtiva();
    aparecer();
  }

  function disparar() {
    aplicando = true;
    raiz.dispatchEvent(new InputEvent('input', { bubbles: true }));
    aplicando = false;
  }

  /* Histórico próprio: como o DOM é remontado na mão, o desfazer nativo não
     serve — ele tentaria voltar pra um DOM que não existe mais. */
  const hist = {
    pilha: [{ texto: '', a: 0, b: 0 }], idx: 0, quando: 0,
    zerar(t) { this.pilha = [{ texto: t, a: t.length, b: t.length }]; this.idx = 0; this.quando = 0; },
    registrar(texto, a, b, forcar) {
      const topo = this.pilha[this.idx];
      if (topo && topo.texto === texto) { topo.a = a; topo.b = b; return; }
      const agora = Date.now();
      const juntar = !forcar && topo && agora - this.quando < 600 &&
                     Math.abs(texto.length - topo.texto.length) <= 2 && !texto.endsWith('\n');
      if (juntar) { topo.texto = texto; topo.a = a; topo.b = b; this.quando = agora; return; }
      this.pilha.length = this.idx + 1;
      this.pilha.push({ texto, a, b });
      if (this.pilha.length > 300) this.pilha.shift();
      this.idx = this.pilha.length - 1;
      this.quando = agora;
    },
    andar(passo) {
      const i = this.idx + passo;
      if (i < 0 || i >= this.pilha.length) return;
      this.idx = i;
      const e = this.pilha[i];
      definirValor(e.texto, e.a, e.b);
      this.quando = 0;
      disparar();
    },
  };

  /* ── contrato de <textarea> ───────────────────────────── */

  Object.defineProperties(raiz, {
    value: {
      configurable: true,
      get() { if (sujo) ler(); return fonte; },
      set(v) {
        const t = v == null ? '' : String(v);
        if (t === fonte) return;
        definirValor(t, t.length, t.length);
        hist.zerar(t);
      },
    },
    selectionStart: { configurable: true, get() { if (sujo) ler(); return caretA; } },
    selectionEnd:   { configurable: true, get() { if (sujo) ler(); return caretB; } },
    setSelectionRange: {
      configurable: true,
      value(a, b) {
        if (sujo) ler();
        caretA = Math.max(0, Math.min(a, fonte.length));
        caretB = Math.max(caretA, Math.min(b == null ? a : b, fonte.length));
        if (focado()) colocar(caretA, caretB);
        marcarAtiva();
      },
    },
    setRangeText: {
      configurable: true,
      value(txt, a, b, modo) {
        const atual = raiz.value;
        if (a == null) { a = caretA; b = caretB; }
        a = Math.max(0, Math.min(a, atual.length));
        b = Math.max(a, Math.min(b == null ? a : b, atual.length));
        const novo = atual.slice(0, a) + txt + atual.slice(b);
        let ca = a + txt.length, cb = ca;
        if (modo === 'select') { ca = a; cb = a + txt.length; }
        else if (modo === 'start') { ca = cb = a; }
        definirValor(novo, ca, cb);
        hist.registrar(novo, ca, cb, true);
        aparecer();
      },
    },
    focus: {
      configurable: true,
      value(op) {
        HTMLElement.prototype.focus.call(this, op);
        colocar(caretA, caretB);
      },
    },
  });

  /* ── eventos ──────────────────────────────────────────── */

  /* O Chromium, no modo texto puro, escreve "\n\n" quando a quebra cai no fim
     do conteudo — o segundo so existe pra deixar o cursor visivel. Em vez de
     adivinhar qual deles e o de mentira, a quebra passa a ser feita aqui. */
  raiz.addEventListener('beforeinput', e => {
    sujo = true;
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') quebrarLinha(e);
    else if (e.inputType === 'deleteContentBackward') apagarMarcador(e);
  });

  raiz.addEventListener('input', () => {
    if (aplicando || compondo) return;
    sincronizar();
    hist.registrar(fonte, caretA, caretB);
  });

  raiz.addEventListener('compositionstart', () => { compondo = true; });
  raiz.addEventListener('compositionend', () => {
    compondo = false;
    sincronizar();
    hist.registrar(fonte, caretA, caretB, true);
  });

  document.addEventListener('selectionchange', () => {
    if (compondo || !selecao()) return;
    ler();
    marcarAtiva();
  });

  // cola sempre como texto puro: nada de HTML entrando, nada de quebra sobrando
  raiz.addEventListener('paste', e => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) return;
    e.preventDefault();
    const txt = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!txt) return;
    raiz.setRangeText(txt.replace(/\r\n?/g, '\n'), raiz.selectionStart, raiz.selectionEnd, 'end');
    disparar();
  });

  const PREFIXO = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
  const SOZINHO = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |> )$/;

  function linhaDoCursor() {
    const txt = raiz.value;
    const a = raiz.selectionStart;
    const ini = txt.lastIndexOf('\n', a - 1) + 1;
    return { a, ini, antes: txt.slice(ini, a) };
  }

  function quebrarLinha(e) {
    e.preventDefault();
    const { a, ini, antes } = linhaDoCursor();
    const b = raiz.selectionEnd;
    const m = a === b ? PREFIXO.exec(antes) : null;
    if (m && antes.length === m[0].length) {     // marcador vazio: sai da lista
      raiz.setRangeText('', ini, a, 'end');
      disparar();
      return;
    }
    let pref = '';                               // a lista continua na linha nova
    if (m) {
      pref = m[0].replace(/\[[xX]\]/, '[ ]');
      const num = /^(\s*)(\d+)([.)] )$/.exec(pref);
      if (num) pref = num[1] + (parseInt(num[2], 10) + 1) + num[3];
    }
    raiz.setRangeText('\n' + pref, a, b, 'end');
    disparar();
  }

  // apagar logo depois de um marcador tira a formatação inteira, não um "#"
  function apagarMarcador(e) {
    const { a, ini, antes } = linhaDoCursor();
    if (a !== raiz.selectionEnd || !SOZINHO.test(antes)) return;
    e.preventDefault();
    raiz.setRangeText('', ini, a, 'end');
    disparar();
  }

  raiz.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        hist.andar(k === 'y' || e.shiftKey ? 1 : -1);
      }
      return;
    }
    // teclado físico chega por aqui; o `beforeinput` cobre os virtuais
    if (e.key === 'Enter' && !e.shiftKey) quebrarLinha(e);
    else if (e.key === 'Backspace') apagarMarcador(e);
  });

  // Ctrl+clique abre o link (o clique simples serve pra pôr o cursor)
  raiz.addEventListener('click', e => {
    if (!(e.ctrlKey || e.metaKey) || !op.abrir) return;
    const alvo = e.target.closest && e.target.closest('[data-url]');
    if (!alvo) return;
    e.preventDefault();
    op.abrir(alvo.dataset.url);
  });

  // onde a linha `ln` começa dentro do markdown
  function ondeComeca(ln) {
    const i = ln ? [...raiz.children].indexOf(ln) : -1;
    if (i < 0) return null;
    const linhas = raiz.value.split('\n');
    let base = 0;
    for (let k = 0; k < i; k++) base += linhas[k].length + 1;
    return { i, base, linha: linhas[i] || '' };
  }

  /* Os enfeites (bolinha, ícone e título do callout, imagem) são
     contenteditable=false. Clicar num deles faz o Chromium jogar a seleção pra
     fora do editor: o cursor some, `varrer` não acha mais onde ele estava e o
     teclado para de responder. Então o clique é tratado aqui — vira um cursor
     no texto da própria linha, que é o que quem clicou queria. */
  const SO_MARCADOR = /^(\s*(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?)/;

  raiz.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const enfeite = e.target.closest && e.target.closest('[data-falso]');
    if (!enfeite || enfeite.classList.contains('caixa')) return;   // a caixinha tem uso próprio
    const onde = ondeComeca(enfeite.closest('.ln'));
    if (!onde) return;
    e.preventDefault();                       // sem isso o navegador mata a seleção
    // na imagem o cursor vai pro fim da linha; nos marcadores, pro início do texto
    const salto = enfeite.nodeName === 'IMG'
      ? onde.linha.length
      : SO_MARCADOR.exec(onde.linha)[1].length;
    raiz.focus();
    raiz.setSelectionRange(onde.base + salto, onde.base + salto);
  });

  // clicar na caixinha marca e desmarca a tarefa
  raiz.addEventListener('click', e => {
    const caixa = e.target.closest && e.target.closest('.caixa');
    if (!caixa) return;
    const onde = ondeComeca(caixa.closest('.ln'));
    if (!onde) return;
    const m = /^\s*[-*+] \[([ xX])\]/.exec(onde.linha);
    if (!m) return;
    const p = onde.base + onde.linha.indexOf('[') + 1;
    raiz.setRangeText(m[1] === ' ' ? 'x' : ' ', p, p + 1, 'end');
    disparar();
  });

  definirValor('', 0, 0);
  hist.zerar('');
  return raiz;
}

window.EditorVivo = { instalar };
})();
