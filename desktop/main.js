/* Casca desktop do Notas.
   Não hospeda cópia do app: carrega o mesmo site do GitHub Pages, então
   qualquer push atualiza o executável sozinho, sem reinstalar. O service
   worker do site é quem garante o funcionamento offline. */

const { app, BrowserWindow, Tray, Menu, shell, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE = process.env.NOTAS_URL || 'https://henribon.github.io/bon-notes/';
const ORIGEM = new URL(SITE).origin;
const HOTKEY = 'Control+Alt+N';

let win = null;
let tray = null;
let saindo = false;
let carregadoEm = 0;

// Janela escondida na bandeja não recarrega sozinha. Se ficou guardada
// por mais que isso, busca versão nova ao reaparecer.
const VALIDADE_MS = 5 * 60 * 1000;

/* ── tamanho e posição da janela entre sessões ───────────── */

const estadoPath = () => path.join(app.getPath('userData'), 'janela.json');

function lerEstado() {
  try {
    const s = JSON.parse(fs.readFileSync(estadoPath(), 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch (e) { /* primeira execução */ }
  return { width: 1180, height: 780 };
}

function gravarEstado() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const b = win.getBounds();
  try {
    fs.writeFileSync(estadoPath(), JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized(),
    }));
  } catch (e) { /* disco cheio ou sem permissão: não é fatal */ }
}

/* ── tela de erro quando não há rede na primeira execução ── */

const OFFLINE = `data:text/html;charset=utf-8,${encodeURIComponent(`
<html><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  body{margin:0;height:100vh;display:grid;place-items:center;background:#191919;color:#d4d4d4;
       font-family:"Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
  h1{font-size:20px;font-weight:650;margin:0 0 8px}
  p{color:#8a8a87;font-size:14px;margin:0 0 20px;max-width:380px;line-height:1.6}
  button{padding:9px 18px;border:0;border-radius:7px;background:#fafaf9;color:#191919;
         font:inherit;font-weight:550;cursor:pointer}
</style></head><body>
  <div>
    <div style="font-size:30px;margin-bottom:14px">◍</div>
    <h1>Sem conexão</h1>
    <p>O Notas precisa de internet só na primeira abertura, para baixar o app.
       Depois disso ele funciona offline.</p>
    <button onclick="location.reload()">Tentar de novo</button>
  </div>
</body></html>`)}`;

/* ── janela ─────────────────────────────────────────────── */

function criarJanela() {
  const st = lerEstado();

  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height,
    minWidth: 380, minHeight: 420,
    title: 'Notas',
    backgroundColor: '#191919',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (st.maximized) win.maximize();
  win.loadURL(SITE);

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { carregadoEm = Date.now(); });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {          // -3 = abortado pelo próprio app
      console.error('[carga]', code, desc, url);
      win.loadURL(OFFLINE);
    }
  });

  // link externo abre no navegador padrão, não numa janela do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // nunca navegar para fora do site — nem por acidente, nem por link injetado
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGEM) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  ['resize', 'move'].forEach(ev => win.on(ev, gravarEstado));

  // fechar no X esconde na bandeja; sair de verdade é pelo menu da bandeja
  win.on('close', e => {
    gravarEstado();
    if (!saindo) { e.preventDefault(); win.hide(); }
  });
}

function alternarJanela() {
  if (!win) return criarJanela();
  if (win.isVisible() && win.isFocused()) return win.hide();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (carregadoEm && Date.now() - carregadoEm > VALIDADE_MS) atualizar();
}

function atualizar() {
  if (!win || win.isDestroyed()) return;
  carregadoEm = Date.now();                    // evita recarregar em rajada
  win.webContents.reloadIgnoringCache();
}

/* ── bandeja ────────────────────────────────────────────── */

function criarBandeja() {
  const ico = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
  tray = new Tray(ico.isEmpty() ? nativeImage.createEmpty() : ico);
  tray.setToolTip('Notas');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Notas', click: alternarJanela },
    { type: 'separator' },
    {
      label: 'Abrir junto com o Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: m => app.setLoginItemSettings({ openAtLogin: m.checked, openAsHidden: true }),
    },
    { label: 'Abrir no navegador', click: () => shell.openExternal(SITE) },
    { type: 'separator' },
    { label: 'Buscar atualização', click: atualizar },
    { label: `Mostrar/ocultar  (${HOTKEY.replace(/Control/, 'Ctrl')})`, enabled: false },
    { type: 'separator' },
    { label: 'Sair', click: () => { saindo = true; app.quit(); } },
  ]));
  tray.on('click', alternarJanela);
}

/* ── ciclo de vida ──────────────────────────────────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', alternarJanela);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.henribon.notas');
    criarJanela();
    criarBandeja();
    if (!globalShortcut.register(HOTKEY, alternarJanela)) {
      console.warn('[atalho] ' + HOTKEY + ' já está em uso por outro programa');
    }
  });

  app.on('before-quit', () => { saindo = true; gravarEstado(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { /* fica na bandeja */ });
  app.on('activate', () => { if (!win || win.isDestroyed()) criarJanela(); else alternarJanela(); });
}
