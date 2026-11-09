@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Packaging copies this template beside Music Tools.exe, never runs it.
if /I "%~1"=="--help" goto help
if /I "%~1"=="-h" goto help
if not "%~1"=="" if /I not "%~1"=="--undo" goto help
if not "%~2"=="" goto help
echo Close Music Tools before continuing. Optional compression needs Windows 10+ and NTFS.
echo Only generated program files are selected; normal use does not require this step.
if not exist "%~dp0resources\app\source\vendor\python\python.exe" (
  echo Embedded Python is missing. Keep this launcher beside Music Tools.exe.
  exit /b 2
)
if /I "%~1"=="--undo" (
  "%~dp0resources\app\source\vendor\python\python.exe" -I -B "%~dp0resources\app\source\core\compact_program.py" --root "%~dp0." --undo
) else (
  "%~dp0resources\app\source\vendor\python\python.exe" -I -B "%~dp0resources\app\source\core\compact_program.py" --root "%~dp0."
)
exit /b %errorlevel%
:help
echo Usage: compact-program.cmd [--undo]
echo Close Music Tools first. Run without options to compress with XPRESS8K.
echo Run with --undo to restore ordinary uncompressed program files.
echo No administrator request, automatic application hook, or CompactOS change.
exit /b 0
