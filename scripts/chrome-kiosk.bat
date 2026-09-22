# Chrome Kiosk Launch Script — Windows
# v5: Optimizovano za 24/7/365 rad na aerodromskim Chrome browser-ima
#
# Ova skripta pokrece Chrome u kiosk mode-u sa flagovima koji sprjecavaju:
# - Memory leaks (dev-shm exhaustion)
# - Background timer throttling (heartbeat prestaje)
# - Tab freezing kad je prekrio drugi prozor
# - Cache discard pod pritiskom (airline logos nestaju)
#
# Koristi se na SVAKOM kiosk uređaju na aerodromu.

@echo off
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

REM ── Kiosk URL (promijeni za svaki kiosk) ──
REM Gate ekrani:  https://fids-tiv.vercel.app/ver2/ver2/gate/01
REM Check-in:     https://fids-tiv.vercel.app/ver2/ver2/checkin/04
REM Combined:     https://fids-tiv.vercel.app/combined
REM Departures:   https://fids-tiv.vercel.app/departures
REM Arrivals:     https://fids-tiv.vercel.app/arrivals
REM Border:       https://fids-tiv.vercel.app/border
REM Split-board:  https://fids-tiv.vercel.app/split-board

set KIOSK_URL=https://fids-tiv.vercel.app/combined

%CHROME% ^
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
