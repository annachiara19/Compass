# Compass - installation for the current Windows user.
# Installs the Python components and creates the Compass icon on the desktop and in the Start menu.
# No administrator rights needed. Run it from "Install Compass.bat".

# 'Continue' rather than 'Stop': in Windows PowerShell 5.1 an external program writing to stderr (for example a
# pip warning) would stop the script. Real errors are checked with $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) {
    Say ""
    Say $text 'Red'
    Say ""
    exit 1
}

Say ""
Say "  Compass - Research and people management" 'Cyan'
Say "  Installing from folder: $dir"
Say ""

# Files extracted from a downloaded zip are "blocked" by Windows: unblock them
Get-ChildItem -LiteralPath $dir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

if ($dir -match '\\Downloads\\|\\Download\\|\\Temp\\|\.zip') {
    Say "Warning: this folder looks like Downloads or a temporary folder." 'Yellow'
    Say "The icon will point to this folder: if you later move or delete it, Compass will not start." 'Yellow'
    Say "Tip: move the Compass folder to Documents and run the installation again." 'Yellow'
    $answer = Read-Host "Continue anyway? (y/N)"
    if ($answer -notmatch '^[yYsS]') { exit 1 }
}

# 1. Python ------------------------------------------------------------------
Say "1/3  Looking for Python..."
$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    $out = & py -3 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { $python = "$out".Trim() }
}
if (-not $python -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $out = & python -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out -and ("$out" -notmatch 'WindowsApps')) { $python = "$out".Trim() }
}
if (-not $python) {
    Start-Process "https://www.python.org/downloads/windows/"
    Fail ("Python is not installed. I opened the download page: install Python 3.13, " +
          "ticking 'Add python.exe to PATH', then run 'Install Compass.bat' again.")
}
$ok = & $python -c "import sys; print(1 if sys.version_info >= (3, 10) else 0)"
if ("$ok".Trim() -ne '1') { Fail "Python 3.10 or later is required. Install Python 3.13 from python.org and run again." }
$tk = & $python -c "import tkinter; print(1)" 2>$null
Say "     found: $python" 'Green'
if ("$tk".Trim() -ne '1') {
    Say "     Python's tcl/tk component is missing: Compass will work, but without its small window." 'Yellow'
    Say "     To get it, run the Python installer again, choose 'Modify' and tick 'tcl/tk and IDLE'." 'Yellow'
}

# 2. Components --------------------------------------------------------------
Say "2/3  Installing components (Flask, waitress)..."
& $python -m pip install --user --disable-pip-version-check --no-warn-script-location --quiet -r (Join-Path $dir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Fail "Installing the components failed. Check your internet connection and run again." }
& $python -c "import flask, waitress" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "The components seem installed but Python cannot find them. Run the installation again." }
Say "     done" 'Green'

# 3. Icons -------------------------------------------------------------------
Say "3/3  Creating the Compass icon on the desktop and in the Start menu..."
$pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }   # without pythonw a black console window stays open too
$launcher = Join-Path $dir 'compass_launcher.pyw'
$icon = Join-Path $dir 'compass.ico'
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($place in $places) {
    if (-not $place) { continue }
    $lnk = $shell.CreateShortcut((Join-Path $place 'Compass.lnk'))
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = '"' + $launcher + '"'
    $lnk.WorkingDirectory = $dir
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'Compass - Research and people management'
    $lnk.Save()
}
Say "     done" 'Green'

Say ""
Say "Compass is installed. From now on, open it with the Compass icon on the desktop or in the Start menu." 'Cyan'
Say "Your data is saved in: $env:LOCALAPPDATA\Compass"
Say ""
$answer = Read-Host "Start Compass now? (Y/n)"
if ($answer -notmatch '^[nN]') { Start-Process -FilePath $pythonw -ArgumentList ('"' + $launcher + '"') -WorkingDirectory $dir }
