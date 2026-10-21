@echo off
rem ---------------------------------------------------------------------------
rem  The portable package's updater entry point (#87). It is deliberately ASCII,
rem  for the reasons packaging\launcher.bat records: cmd.exe reads a .bat through the
rem  console's code page, so every Chinese line the user reads is printed by the
rem  program instead (Node writes Unicode to the console).
rem
rem  No logic lives here either: change the directory, then exec the updater with
rem  two arguments and nothing else.
rem
rem    "%~dp0."   the package root. The trailing dot is load-bearing: a quoted
rem               argument ending in `\` escapes its own closing quote, and %~dp0
rem               always ends in `\`.
rem    %*         the path the user dragged onto this file, when they did. Its
rem               quotes are the caller's and survive the expansion.
rem
rem  A failed update keeps the window open so its message can be read; a window
rem  that flashes and vanishes is the worst possible support case.
rem ---------------------------------------------------------------------------
cd /d "%~dp0app"
if errorlevel 1 goto failed

"%~dp0app\node.exe" "%~dp0app\update.js" "%~dp0." %*
if errorlevel 1 goto failed
exit /b 0

:failed
pause
exit /b 1
