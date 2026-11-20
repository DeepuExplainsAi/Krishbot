const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

process.env.KRISHBOT_DATA ||= path.join(app.getPath('userData'), 'data');

app.whenReady().then(async () => {
  const { start } = await import('./src/server.js');
  const { url } = await start(0);
  const win = new BrowserWindow({ width: 1200, height: 800, title: 'Krishbot', autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png') });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
