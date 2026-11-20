const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8787;
const URL_ = `http://localhost:${PORT}`;
const KEYS = ['XAI_API_KEY', 'COMPOSIO_API_KEY', 'ORGO_API_KEY', 'ORGO_COMPUTER_ID'];
let win;
let server;

const dataDir = () => app.getPath('userData');
const cfgFile = () => path.join(dataDir(), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2), { mode: 0o600 }); };
const ready = (c) => KEYS.every((k) => c[k]);

function startServer(cfg) {
  if (!cfg.SESSION_SECRET) { cfg.SESSION_SECRET = crypto.randomBytes(32).toString('hex'); writeCfg(cfg); }
  fs.mkdirSync(path.join(dataDir(), 'engines'), { recursive: true });
  server = spawn(process.execPath, [path.join(__dirname, 'server', 'dist', 'index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ...cfg,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      APP_URL: URL_,
      SERVER_URL: URL_,
      DEV_LOGIN: '1',
      DB_PATH: path.join(dataDir(), 'krishbot.db'),
      ENGINES_DIR: path.join(dataDir(), 'engines'),
    },
    stdio: 'inherit',
  });
  server.on('exit', (code) => { server = null; if (code && win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'setup.html'), { query: { error: `Server stopped (code ${code}). Check your keys.` } }); });
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${URL_}/api/health`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function launch() {
  const cfg = readCfg();
  if (!ready(cfg)) return win.loadFile(path.join(__dirname, 'setup.html'));
  startServer(cfg);
  if (await waitHealthy()) win.loadURL(URL_);
}

ipcMain.handle('cfg:get', () => { const c = readCfg(); return Object.fromEntries(KEYS.map((k) => [k, c[k] ?? ''])); });
ipcMain.handle('cfg:save', async (_e, values) => {
  const cfg = readCfg();
  for (const k of KEYS) cfg[k] = String(values[k] ?? '').trim();
  writeCfg(cfg);
  if (server) { server.kill(); await new Promise((r) => setTimeout(r, 500)); }
  await launch();
});

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 840, title: 'Krishbot', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL_)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  launch();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.kill());
