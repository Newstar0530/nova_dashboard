@echo off
rem 桌面捷徑用：工作台已經在執行就直接打開網頁；沒有的話在縮小的視窗啟動它（啟動後會自動開網頁）
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8765/ | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" http://127.0.0.1:8765/
) else (
  rem 用完整路徑：有些環境（NoDefaultCurrentDirectoryInExePath）不會從目前資料夾找 start.bat
  start "Nova Dashboard" /min cmd /c "%~dp0start.bat"
)
