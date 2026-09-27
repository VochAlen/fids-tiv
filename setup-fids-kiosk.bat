@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM FIDS Kiosk — Setup skripta (POKRENI KAO ADMINISTRATOR)
REM
REM Sta radi:
REM   1. Kreira C:\FIDS\restart-kiosk.bat (gasi Chrome, pali ga
REM      ponovo cist, u kiosk modu, na zadatom URL-u)
REM   2. Kreira Windows Task Scheduler zadatak koji tu skriptu
REM      pokrece svako vece u 03:30 — SAMO ako zadatak vec ne
REM      postoji (bezbjedno za ponovno pokretanje ove setup
REM      skripte, npr. ako mijenjas URL)
REM   3. Odmah pokrece zadatak jednom, radi provjere
REM
REM Kako se koristi na svakom kiosk uredjaju:
REM   setup-fids-kiosk.bat "https://fids-tiv.vercel.app/combined"
REM   setup-fids-kiosk.bat "https://fids-tiv.vercel.app/ver2/gate/5"
REM   setup-fids-kiosk.bat "https://fids-tiv.vercel.app/ver2/checkin/12"
REM
REM Ako se URL ne prosledi kao argument, koristi se DEFAULT_URL
REM ispod — izmijeni ga prije pokretanja ako ti je lakse.
REM ============================================================

set "DEFAULT_URL=https://fids-tiv.vercel.app/combined"
set "TASK_NAME=FIDS Kiosk Restart"

REM ── 0. Odredi koji URL se koristi ──
set "KIOSK_URL=%DEFAULT_URL%"
if not "%~1"=="" set "KIOSK_URL=%~1"

REM ── 1. Provjeri administratorska prava (Task Scheduler + SYSTEM zahtijeva) ──
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [GRESKA] Ova skripta mora biti pokrenuta KAO ADMINISTRATOR.
  echo Desni klik na fajl -^> "Run as administrator", pa ponovo pokreni.
  pause
  exit /b 1
)

echo ============================================================
echo  FIDS Kiosk Restart — setup
echo  URL za ovaj ekran: %KIOSK_URL%
echo ============================================================
echo.

REM ── 2. Kreiraj C:\FIDS folder ──
if not exist "C:\FIDS" mkdir "C:\FIDS"

REM ── 3. Napisi restart-kiosk.bat (nadje Chrome i na 32-bit i na 64-bit instalaciji) ──
(
  echo @echo off
  echo REM ── FIDS kiosk — nocni restart Chrome procesa ──────────────
  echo REM Generisano automatski od strane setup-fids-kiosk.bat
  echo.
  echo REM 1. Ugasi SVE Chrome procese ^(force, /T = i child procese^)
  echo taskkill /F /IM chrome.exe /T ^>nul 2^>^&1
  echo timeout /t 3 /nobreak ^>nul
  echo.
  echo REM 2. Nadji instalirani Chrome ^(64-bit ili 32-bit putanja^)
  echo set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
  echo if not exist "%%CHROME_EXE%%" set "CHROME_EXE=C:\Program Files ^(x86^)\Google\Chrome\Application\chrome.exe"
  echo.
  echo REM 3. Ponovo upali u kiosk modu, cist ^(bez restore session-a^)
  echo start "" "%%CHROME_EXE%%" --kiosk "%KIOSK_URL%" --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --overscroll-history-navigation=0 --disable-pinch
) > "C:\FIDS\restart-kiosk.bat"

echo [OK] Kreiran C:\FIDS\restart-kiosk.bat
echo.

REM ── 4. Kreiraj Task Scheduler zadatak, SAMO ako vec ne postoji ──
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if !errorlevel! equ 0 (
  echo [INFO] Zadatak "%TASK_NAME%" vec postoji — preskacem kreiranje.
  echo        ^(restart-kiosk.bat je ipak osvjezen sa trenutnim URL-om^)
) else (
  schtasks /create /tn "%TASK_NAME%" /tr "C:\FIDS\restart-kiosk.bat" /sc daily /st 03:30 /ru SYSTEM /rl HIGHEST /f
  if !errorlevel! equ 0 (
    echo [OK] Zadatak "%TASK_NAME%" kreiran — pokrece se svako vece u 03:30.
  ) else (
    echo [GRESKA] Kreiranje Task Scheduler zadatka nije uspjelo.
    pause
    exit /b 1
  )
)

echo.
echo ── Pokrecem zadatak sada, radi provjere ──
echo Chrome ce se za par sekundi ugasiti i ponovo upaliti na: %KIOSK_URL%
schtasks /run /tn "%TASK_NAME%"

echo.
echo Gotovo. Provjeri da li se Chrome ponovo otvorio ispravno.
pause
