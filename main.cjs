const { app, BrowserWindow, shell } = require('electron');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

app.whenReady().then(async () => {
  // The app server runs inside this process, listening on this computer only.
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.KRISHBOT_DATA ||= path.join(app.getPath('userData'), 'data');
  await import(pathToFileURL(path.join(__dirname, 'server', 'dist', 'index.js')).href);

  const win = new BrowserWindow({ width: 1280, height: 820, title: 'Krishbot', autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png') });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${port}`);
});
app.on('window-all-closed', () => app.quit());
