@echo off
chcp 65001 >nul
if exist "%~dp0release\Music Tools\Music Tools.exe" (
  start "" "%~dp0release\Music Tools\Music Tools.exe"
  exit /b
)
if exist "%~dp0..\免安装版\Music Tools.exe" (
  start "" "%~dp0..\免安装版\Music Tools.exe"
  exit /b
)
echo 请先运行 npm run package，或使用免安装版中的 Music Tools.exe。
pause
