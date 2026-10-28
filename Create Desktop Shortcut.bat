@echo off
setlocal
set "APPROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = $env:APPROOT.TrimEnd('\'); $launchScript = Join-Path $root 'server\launch.ps1'; $iconPath = Join-Path $root 'icon.ico'; $desktop = [Environment]::GetFolderPath('Desktop'); $lnkPath = Join-Path $desktop 'Research App.lnk'; $shell = New-Object -ComObject WScript.Shell; $lnk = $shell.CreateShortcut($lnkPath); $lnk.TargetPath = 'powershell.exe'; $lnk.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"' + $launchScript + '\"'; $lnk.IconLocation = $iconPath + ',0'; $lnk.WorkingDirectory = $root; $lnk.Save(); Write-Host ('Shortcut created on your Desktop as \"Research App\". First launch will take a minute to install server dependencies.')"
echo.
pause
