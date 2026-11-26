@echo off
setlocal
title EclipseIsland - Spotify setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Spotify-Bridge.ps1"
set "SetupExit=%ERRORLEVEL%"
echo.
pause
exit /b %SetupExit%
