@echo off
rem ---------------------------------------------------------------------------
rem  The portable package's one entry point (#85). It is deliberately ASCII:
rem
rem  cmd.exe reads a .bat with the console's code page (936 on this machine), so
rem  a UTF-8 script shows mojibake in the window; a UTF-8 BOM breaks its first
rem  line; chcp 65001 only works when the file happens to be saved without a BOM
rem  and turns cmd's own messages into English. Every Chinese line is printed by
rem  the program instead, from Node, which writes Unicode to the console.
rem
rem  No logic lives here: change the directory, declare the two roots, exec.
rem ---------------------------------------------------------------------------
rem  The working directory is explicit because cmd does not follow the script
rem  (%CD% stays where the caller was), and the layered configuration is read
rem  from it. %~dp0 is the script's own folder, and it is reliable with Chinese
rem  characters and spaces.
cd /d "%~dp0app"
if errorlevel 1 goto failed

rem  The two explicit roots the program takes as inputs (#78).
set "RE1999_APP_ROOT=%~dp0app"
set "RE1999_DATA_ROOT=%~dp0data"

rem  The Node runtime and the Console entry that ship inside app\. A failed start
rem  keeps the window open so its message can be read: a window that flashes and
rem  vanishes is the worst possible support case.
"%~dp0app\node.exe" "%~dp0app\server.js"
if errorlevel 1 goto failed
exit /b 0

:failed
rem  A visible, still-open window with the explanation still on it.
pause
exit /b 1