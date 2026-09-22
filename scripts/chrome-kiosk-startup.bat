@echo off
REM ============================================================
REM Chrome Kiosk Auto-Start — Windows Startup Script
REM v5.3: Pokrece Chrome u kiosk mode-u pri boot-u
REM ============================================================
REM
REM Instalacija: kopiraj ovaj fajl u:
REM   C:\Users\[korisnik]\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\
REM
REM Ili dodaj u Registry:
REM   reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FidsKiosk" /t REG_SZ /d "C:\FIDS\chrome-kiosk.bat" /f
REM ============================================================

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

REM ── Kiosk URL (PROMIJENI ZA SVAKI KIOSK) ──
REM Gate ekrani:  https://fids-tiv.vercel.app/ver2/ver2/gate/01
REM Check-in:     https://fids-tiv.vercel.app/ver2/ver2/checkin/04
REM Combined:     https://fids-tiv.vercel.app/combined
REM Departures:   https://fids-tiv.vercel.app/departures
REM Arrivals:     https://fids-tiv.vercel.app/arrivals
REM Border:       https://fids-tiv.vercel.app/border
REM Split-board:  https://fids-tiv.vercel.app/split-board

set KIOSK_URL=https://fids-tiv.vercel.app/combined

REM ── Sacekaj 15s da se mreza uspostavi nakon boot-a ──
timeout /t 15 /nobreak >NUL

REM ── Pokreni Chrome u kiosk mode-u ──
start "" %CHROME% ^
  --kiosk ^
  --disable-dev-shm-usage ^
  --disable-background-timer-throttling ^
  --disable-renderer-backgrounding ^
  --disable-backgrounding-occluded-windows ^
  --disable-features=CalculateNativeWinOcclusion ^
  --aggressive-cache-discard ^
  --disable-back-forward-cache ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-popup-blocking ^
  --disable-translate ^
  --disable-extensions ^
  --disable-sync ^
  --no-pings ^
  --autoplay-policy=no-user-gesture-required ^
  %KIOSK_URL%

REM ── Instaliraj watchdog Task Scheduler (ako nije vec) ──
schtasks /query /tn "ChromeWatchdog" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [%date% %time%] Installing ChromeWatchdog task...
  schtasks /create /tn "ChromeWatchdog" /tr "C:\FIDS\chrome-watchdog.bat" /sc minute /mo 1 /ru SYSTEM /rl HIGHEST /f
  echo [%date% %time%] ChromeWatchdog installed.
)
