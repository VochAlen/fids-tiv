// main.js
const { app, BrowserWindow } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const http = require('http');

// ─── GLOBALNI FLAGS ────────────────────────────────────────────────────────────
let mainWindow = null;
let nextProcess = null;
let serverReady = false;
let isQuitting = false;
let appStarted = false;
let creationInProgress = false;

// ─── SINGLE INSTANCE LOCK ──────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('⚠️ Druga instanca detektovana, gasim se...');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    console.log('🔄 Pokušaj pokretanja druge instance — fokusiram glavni prozor...');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── PRONAĐI NODE.JS EXECUTABLE ───────────────────────────────────────────────
function findNodeExecutable() {
  // U Electron buildu, node.exe se nalazi pored electron exe-a
  const possiblePaths = [
    // Pored FIDS TIV.exe
    path.join(path.dirname(process.execPath), 'node.exe'),
    path.join(path.dirname(process.execPath), 'node'),
    // U resources folderu
    path.join(process.resourcesPath, 'node.exe'),
    path.join(process.resourcesPath, 'node'),
    // Sistemski node
    'node.exe',
    'node',
  ];

  for (const nodePath of possiblePaths) {
    try {
      if (nodePath === 'node.exe' || nodePath === 'node') {
        // Provjeri sistemski node
        const result = require('child_process').spawnSync(nodePath, ['--version'], { 
          timeout: 3000, 
          shell: false 
        });
        if (result.status === 0) {
          console.log(`✅ Sistemski node pronađen: ${nodePath} (${result.stdout.toString().trim()})`);
          return nodePath;
        }
      } else if (fs.existsSync(nodePath)) {
        console.log(`✅ Node executable pronađen: ${nodePath}`);
        return nodePath;
      }
    } catch (e) {
      // Nastavi tražiti
    }
  }

  console.warn('⚠️ Node.js nije pronađen, koristim process.execPath kao fallback');
  return null;
}

// ─── HELPER: SERVER READY CHECK ───────────────────────────────────────────────
function isServerReady() {
  return new Promise((resolve) => {
    http.get('http://localhost:3000', (res) => {
      resolve(res.statusCode < 500);
    }).on('error', () => resolve(false));
  });
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`⏳ Čekam server... pokušaj ${i + 1}/${maxAttempts}`);
    if (await isServerReady()) {
      console.log('✅ Server je spreman!');
      return true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const defaultSettings = {
    app:     { path: '', fullscreen: true, kiosk: true, width: 1200, height: 800 },
    network: { nextjs_url: 'http://localhost:3000', port: 3000 },
    debug:   { show_menu: false, dev_tools: false },
    checkin: { default: 120 }
  };

  try {
    const possiblePaths = [
      path.join(process.resourcesPath || '', 'settings.ini'),
      path.join(process.cwd(), 'settings.ini'),
      path.join(__dirname, 'settings.ini')
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        console.log(`📁 Učitavam settings iz: ${configPath}`);
        const parsed = ini.parse(fs.readFileSync(configPath, 'utf-8'));

        if (parsed.checkin) {
          Object.keys(parsed.checkin).forEach(key => {
            parsed.checkin[key] = parseInt(parsed.checkin[key]) || 120;
          });
        }

        return {
          app:     { ...defaultSettings.app,     ...parsed.app },
          network: { ...defaultSettings.network, ...parsed.network },
          debug:   { ...defaultSettings.debug,   ...parsed.debug },
          checkin: { ...defaultSettings.checkin, ...parsed.checkin }
        };
      }
    }

    console.log('⚠️ Nema settings.ini, koristim default');
    return defaultSettings;

  } catch (error) {
    console.error('❌ Greška pri učitavanju settings:', error);
    return defaultSettings;
  }
}

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────
function loadLoadingScreen() {
  const candidates = [
    path.join(process.resourcesPath || '', 'loading.html'),
    path.join(__dirname, 'loading.html'),
    path.join(process.cwd(), 'loading.html')
  ];

  const found = candidates.find(p => fs.existsSync(p));
  if (found) {
    console.log(`📄 Učitavam loading screen iz: ${found}`);
    mainWindow.loadFile(found);
  } else {
    console.log('⚠️ loading.html nije pronađen, koristim fallback');
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!DOCTYPE html><html><head><title>FIDS TIV</title>
      <style>
        body { margin:0; background:#0f172a; font-family:Arial,sans-serif;
               display:flex; justify-content:center; align-items:center;
               height:100vh; color:white; }
        .loader { border:6px solid rgba(255,255,255,0.1); border-top:6px solid #fbbf24;
                  border-radius:50%; width:80px; height:80px;
                  animation:spin 1.5s linear infinite; margin:0 auto 2rem; }
        @keyframes spin { to { transform:rotate(360deg); } }
        h1 { font-size:2.5rem; margin-bottom:1rem; color:#fbbf24; }
        p  { color:#94a3b8; }
      </style></head>
      <body><div style="text-align:center">
        <div class="loader"></div>
        <h1>FIDS TIV</h1>
        <p>Pokrećem aplikaciju, molimo sačekajte...</p>
      </div></body></html>
    `));
  }
}

// ─── KILL NEXT SERVER ─────────────────────────────────────────────────────────
async function killNextServer() {
  console.log('🛑 Gasim Next.js server...');

  if (nextProcess && !nextProcess.killed) {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (nextProcess && !nextProcess.killed) {
          console.log('⚠️ Force kill Next.js...');
          if (process.platform === 'win32') {
            exec(`taskkill /pid ${nextProcess.pid} /f /t`, () => resolve());
          } else {
            nextProcess.kill('SIGKILL');
            resolve();
          }
        } else {
          resolve();
        }
      }, 3000);

      nextProcess.once('exit', () => {
        clearTimeout(timeout);
        console.log('✅ Next.js zaustavljen');
        resolve();
      });

      nextProcess.kill(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM');
    });
  }

  await forceKillPort3000();
}

function forceKillPort3000() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('netstat -ano | findstr :3000', (error, stdout) => {
        if (!stdout) return resolve();
        const pids = new Set();
        for (const line of stdout.split('\n')) {
          const match = line.match(/\s+(\d+)\s*$/);
          if (match) pids.add(match[1]);
        }
        if (pids.size === 0) return resolve();
        let done = 0;
        for (const pid of pids) {
          exec(`taskkill /pid ${pid} /f /t`, () => {
            if (++done === pids.size) resolve();
          });
        }
      });
    } else {
      exec('fuser -k 3000/tcp 2>/dev/null || lsof -ti:3000 | xargs kill -9 2>/dev/null', () => resolve());
    }
  });
}

// ─── START NEXT SERVER ────────────────────────────────────────────────────────
// ─── START NEXT SERVER ────────────────────────────────────────────────────────
function startNextServer(settings) {
  return new Promise((resolve, reject) => {
    console.log('🚀 Pokrećem Next.js server...');

    // ⚠️ VAŽNO: U produkciji uvijek koristi standalone server, NE npm run dev
// U PRODUKCIJI UVIJEK KORISTI STANDALONE SERVER
const isDev = false; // Forsiraj production mode
    
    let serverScript, args, cwd;

    if (isDev) {
      // Development: npm run dev
      console.log('📌 DEVELOPMENT MODE - npm run dev');
      serverScript = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      args = ['run', 'dev'];
      cwd = process.cwd();
    } else {
      // PRODUCTION MODE - koristi standalone server
      console.log('📌 PRODUCTION MODE - standalone server');
      
      // Prvo pokušaj u current working directory
      let serverPath = path.join(process.cwd(), '.next', 'standalone', 'server.js');
      
      // Ako ne postoji, pokušaj u resources
      if (!fs.existsSync(serverPath)) {
        serverPath = path.join(process.resourcesPath, 'app', '.next', 'standalone', 'server.js');
      }
      
      // Ako opet ne postoji, pokušaj stariji path
      if (!fs.existsSync(serverPath)) {
        serverPath = path.join(process.resourcesPath, 'app', 'server.js');
      }

      console.log(`🔍 Tražim server.js: ${serverPath}`);
      console.log(`   Postoji: ${fs.existsSync(serverPath) ? '✅' : '❌'}`);

      if (!fs.existsSync(serverPath)) {
        reject(new Error('server.js nije pronađen. Prvo pokrenite "npm run build"'));
        return;
      }

      const nodeExe = findNodeExecutable();
      if (!nodeExe) {
        reject(new Error('Node.js nije pronađen. Instaliraj Node.js na ovom računaru.'));
        return;
      }

      console.log(`📌 Koristim node: ${nodeExe}`);
      console.log(`📌 Koristim server: ${serverPath}`);

      serverScript = nodeExe;
      args = [serverPath];
      cwd = path.dirname(serverPath);
    }

    console.log(`📌 Komanda: ${serverScript} ${args.join(' ')}`);
    console.log(`📌 Radni direktorijum: ${cwd}`);

    nextProcess = spawn(serverScript, args, {
      cwd,
      stdio: 'pipe',
      shell: false,
      env: {
        ...process.env,
        PORT: settings.network.port.toString(),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1'
      }
    });

    let resolved = false;

    nextProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`📡 Next.js: ${output.trim()}`);
      if (!resolved && (output.includes('ready') || output.includes('started') || output.includes(`:${settings.network.port}`))) {
        resolved = true;
        serverReady = true;
        resolve();
      }
    });

    nextProcess.stderr.on('data', (data) => {
      const err = data.toString().trim();
      if (err && !err.includes('Warning')) {
        console.error(`⚠️ Next.js stderr: ${err}`);
      }
      if (err.includes('EADDRINUSE')) {
        console.log('⚠️ Port zauzet, probam sljedeći...');
        settings.network.port += 1;
        nextProcess.kill();
        startNextServer(settings).then(resolve).catch(reject);
      }
    });

    nextProcess.on('error', (err) => {
      console.error('❌ Greška pri pokretanju Next.js:', err);
      reject(err);
    });

    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        console.log('⚠️ Timeout — provjeravam da li server radi...');
        waitForServer().then(() => {
          if (!resolved) {
            resolved = true;
            serverReady = true;
            resolve();
          }
        });
      }
    }, 15000); // Smanjeno na 15 sekundi
  });
}

// ─── GRACEFUL QUIT ────────────────────────────────────────────────────────────
async function gracefulQuit() {
  if (isQuitting) return;
  isQuitting = true;
  console.log('🔌 Graceful quit...');
  await killNextServer();
  app.exit(0);
}

// ─── CREATE WINDOW ────────────────────────────────────────────────────────────
async function createWindow() {
  if (creationInProgress || appStarted || mainWindow) {
    console.log('⚠️ Prozor već postoji ili se kreira, ignorišem...');
    if (mainWindow) mainWindow.focus();
    return;
  }

  creationInProgress = true;
  console.log('🔨 Kreiranje glavnog prozora...');

  const settings = loadSettings();
  console.log('⚙️ Settings:', JSON.stringify(settings, null, 2));

  try {
    mainWindow = new BrowserWindow({
      width:      parseInt(settings.app.width)  || 1200,
      height:     parseInt(settings.app.height) || 800,
      fullscreen: settings.app.fullscreen === 'true' || settings.app.fullscreen === true,
      kiosk:      settings.app.kiosk === 'true'      || settings.app.kiosk === true,
      backgroundColor: '#0f172a',
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: settings.debug.dev_tools === 'true' || settings.debug.dev_tools === true
      }
    });

    loadLoadingScreen();
    mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());

    if (!settings.debug.show_menu) mainWindow.setMenuBarVisibility(false);
    if (settings.debug.dev_tools === 'true' || settings.debug.dev_tools === true) {
      mainWindow.webContents.openDevTools();
    }

    mainWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        gracefulQuit();
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
      appStarted = false;
    });

    // Pokreni server
    try {
      await startNextServer(settings);
    } catch (error) {
      console.error('❌ Greška pri pokretanju servera:', error);
      if (mainWindow) {
        mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
          <html><body style="background:#1e293b;color:white;font-family:Arial;
            display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="text-align:center">
              <h1 style="color:#ef4444">❌ Greška pri pokretanju</h1>
              <p>${error.message}</p>
            </div>
          </body></html>
        `));
      }
      return;
    }

    await new Promise(r => setTimeout(r, 2000));

    const baseUrl    = `http://localhost:${settings.network.port}`;
    const targetPath = settings.app.path;
    const fullUrl    = targetPath ? `${baseUrl}/${targetPath}` : baseUrl;
    console.log(`🌐 Učitavam: ${fullUrl}`);

    const loadUrlWithRetry = async (url, maxRetries = 5) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`📡 Pokušaj ${attempt}/${maxRetries}: ${url}`);
          await mainWindow.loadURL(url);
          console.log(`✅ Učitano (pokušaj ${attempt})`);
          return true;
        } catch (err) {
          console.log(`❌ Pokušaj ${attempt} nije uspio: ${err.message}`);
          if (attempt < maxRetries) await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
      return false;
    };

    const loaded = await loadUrlWithRetry(fullUrl);
    if (!loaded) {
      const baseLoaded = await loadUrlWithRetry('http://localhost:3000', 3);
      if (!baseLoaded && mainWindow) {
        mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
          <html><body style="background:#1e293b;color:white;font-family:Arial;
            display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="text-align:center">
              <h1 style="color:#ef4444">❌ Greška pri učitavanju</h1>
              <p>Nije moguće učitati server na portu ${settings.network.port}</p>
            </div>
          </body></html>
        `));
      }
    }

    appStarted = true;
    console.log('✅ Aplikacija uspješno pokrenuta!');

  } catch (error) {
    console.error('❌ Greška pri kreiranju prozora:', error);
  } finally {
    creationInProgress = false;
  }
}

// ─── APP EVENTS ───────────────────────────────────────────────────────────────
if (gotTheLock) {
  app.whenReady().then(() => {
    console.log('⚡ Electron ready');
    setTimeout(() => {
      if (!appStarted && !creationInProgress) createWindow();
    }, 100);
  });

  app.on('window-all-closed', () => {
    console.log('🪟 Svi prozori zatvoreni');
    gracefulQuit();
  });
}

// ─── PROCESS HANDLERS ────────────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  try {
    const logPath = path.join(app.getPath('userData'), 'error.log');
    fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${error.stack || error}\n`);
  } catch (e) {}
  gracefulQuit();
});

process.on('SIGINT',  () => { console.log('📟 SIGINT');  gracefulQuit(); });
process.on('SIGTERM', () => { console.log('📟 SIGTERM'); gracefulQuit(); });