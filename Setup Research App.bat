@echo off
setlocal
set "APPROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APPROOT%server\setup.ps1"
