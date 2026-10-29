@echo off
rem Compass - removes the icons. Data stays in %LOCALAPPDATA%\Compass
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $p=[Environment]::GetFolderPath('Programs'); Remove-Item -ErrorAction SilentlyContinue -LiteralPath (Join-Path $d 'Compass.lnk'),(Join-Path $p 'Compass.lnk'); Write-Host ''; Write-Host 'Compass icons removed.'; Write-Host ('Your data stays in ' + $env:LOCALAPPDATA + '\Compass : delete that folder only if you no longer need it.')"
echo.
pause
