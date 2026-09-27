@echo off
REM ============================================================
REM Chrome Kiosk Watchdog — Windows Task Scheduler Script
REM v5.3: Provjerava Chrome svakih 60s, restartuje ako pukne
REM ============================================================
REM
REM Instalacija (pokreni kao Administrator):
REM   schtasks /create /tn "ChromeWatchdog" /tr "C:\FIDS\chrome-watchdog.bat" /sc minute /mo 1 /ru SYSTEM /rl HIGHEST
REM
REM Deinstalacija:
REM   schtasks /delete /tn "ChromeWatchdog" /f
REM
REM Ovo treba biti na SVAKOM kiosk uređaju na aerodromu.
REM ============================================================

set CHROME_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_EXE% set CHROME_EXE="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

REM ── Provjeri da li Chrome proces uopšte radi ──
tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
if %ERRORLEVEL% NEQ 0 (
  echo [%date% %time%] Chrome nije pokrenut — startujem kiosk...
  start "" %CHROME_EXE% --kiosk --disable-dev-shm-usage --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion --aggressive-cache-discard --disable-back-forward-cache --no-first-run --no-default-browser-check --disable-popup-blocking --disable-translate --disable-extensions --disable-sync --no-pings --autoplay-policy=no-user-gesture-required https://fids-tiv.vercel.app/combined
  REM Čekaj 10s da se Chrome pokrene
  timeout /t 10 /nobreak >NUL
  goto :eof
)

REM ── Provjeri da li je Chrome tab crash-ovao ──
REM Chrome kiosk nema naslov prozora kad je tab crash-ovao.
REM Normalno, kiosk tab ima prazan title (chrome://kiosk). Kad crash-uje,
REM prikazuje "Aw, Snap!" ili je potpuno bijel ekran.
REM
REM Najpouzdanija metoda: provjeri da li Chrome prozor odgovara na
REM input. Ako je "Not Responding" u tasklist, ubij i restartuj.
tasklist /FI "IMAGENAME eq chrome.exe" /FI "STATUS eq NOT RESPONDING" 2>NUL | find /I "chrome.exe" >NUL
if %ERRORLEVEL% EQU 0 (
  echo [%date% %time%] Chrome NOT RESPONDING — killing and restarting...
  taskkill /F /IM chrome.exe >NUL 2>&1
  timeout /t 3 /nobreak >NUL
  start "" %CHROME_EXE% --kiosk --disable-dev-shm-usage --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion --aggressive-cache-discard --disable-back-forward-cache --no-first-run --no-default-browser-check --disable-popup-blocking --disable-translate --disable-extensions --disable-sync --no-pings --autoplay-policy=no-user-gesture-required https://fids-tiv.vercel.app/combined
  timeout /t 10 /nobreak >NUL
)

REM ── Provjeri da li je kiosk na pravom URL-u ──
REM Ako je korisnik nekako navigirao dalje (rare ali moguće), vratiti
REM Ovo je teško iz batch-a, ali --kiosk flag spriječava navigaciju.
REM
REM Alternativa: strana sama ima window.location.replace() u
REM visibilitychange handler (v5.3) koji vraća na pravi URL.
