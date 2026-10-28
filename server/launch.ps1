# Launcher for the Research App desktop shortcut. Unlike every other app in this
# workspace, this one needs a running backend (it holds the Gemini API key and does
# the fetching/summarizing), so the shortcut can't just point straight at a browser +
# file:// like the others — it has to start the server first, then open the browser.
#
# Runs with -WindowStyle Hidden via the Desktop shortcut, so there's no console the
# user can see — any failure must show a real popup (System.Windows.Forms.MessageBox),
# not Write-Host or Read-Host, or it fails completely silently.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$serverDir = $PSScriptRoot
$port = 8794
$outLogPath = Join-Path $serverDir "server-out.log"
$errLogPath = Join-Path $serverDir "server-err.log"
$runtimeDir = Join-Path $serverDir "node-runtime"

# Pinned rather than dynamically resolved ("latest-v22.x") — a hardcoded, verified
# URL is more reliable than parsing nodejs.org's directory listing in a script that
# might run months or years after being written. Bump this if it's ever needed.
$nodeVersion = "22.14.0"

function Show-Error($message) {
    [System.Windows.Forms.MessageBox]::Show($message, "Research App", "OK", "Error") | Out-Null
}

function Show-Info($message) {
    [System.Windows.Forms.MessageBox]::Show($message, "Research App", "OK", "Information") | Out-Null
}

# Most users won't have Node.js installed — this app is the only reason they'd need
# it. Rather than requiring a manual install first (the original gap here — the app
# silently failed to start on a machine without Node), this downloads a private,
# portable copy into server/node-runtime/ the first time it's needed. No admin
# rights, no system-wide/registry install — it never writes anything outside this
# app's own folder. It does prepend that folder to this *process's* PATH (not the
# system/user PATH — that change dies with this script) so that node.exe is
# resolvable by name, which turns out to matter: npm's own postinstall scripts
# (protobufjs's, at least) spawn `node` via cmd.exe rather than using npm's own
# path to it, and fail if `node` isn't on PATH even when npm.cmd itself was
# invoked with a full path. Confirmed by testing — installing with only npm.cmd's
# full path given, and system Node absent from PATH, failed on exactly this.
function Add-NodeDirToPath($nodeDir) {
    $env:PATH = "$nodeDir;$env:PATH"
}

function Get-NodeTools {
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($systemNode -and $systemNpm) {
        return @{ Node = $systemNode.Source; Npm = $systemNpm.Source }
    }

    $existing = Get-ChildItem -Path $runtimeDir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        Add-NodeDirToPath $existing.DirectoryName
        $npmPath = Join-Path $existing.DirectoryName "npm.cmd"
        return @{ Node = $existing.FullName; Npm = $npmPath }
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    $zipName = "node-v$nodeVersion-win-$arch.zip"
    $url = "https://nodejs.org/dist/v$nodeVersion/$zipName"
    $zipPath = Join-Path $env:TEMP $zipName

    Show-Info "Node.js wasn't found on this computer. Research App will download a private copy (about 30-50 MB, one time only) to run its local server. This won't affect anything else on your computer.`n`nClick OK to continue — this may take a minute."

    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    } catch {
        throw "Could not download Node.js ($($_.Exception.Message)). Check your internet connection, or install Node.js yourself from https://nodejs.org and try again."
    }
    Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
    Remove-Item $zipPath -Force

    $downloaded = Get-ChildItem -Path $runtimeDir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $downloaded) {
        throw "The Node.js download completed but node.exe wasn't found afterward — the archive format may have changed."
    }
    Add-NodeDirToPath $downloaded.DirectoryName
    $npmPath = Join-Path $downloaded.DirectoryName "npm.cmd"
    return @{ Node = $downloaded.FullName; Npm = $npmPath }
}

function Test-ServerUp {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$port/api/settings" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

# Every open starts a genuinely fresh server — any process already on this port
# (a stale instance the heartbeat-shutdown missed, a leftover dev instance, etc.)
# is force-killed first rather than reused. The server itself also self-terminates
# once no open tab is heartbeating it (see server.js) — this is the backstop for
# whatever that missed, not the primary mechanism.
function Stop-ExistingServer {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    if ($conns) { Start-Sleep -Milliseconds 500 }
}

try {
    Stop-ExistingServer

    $tools = Get-NodeTools

    $nodeModules = Join-Path $serverDir "node_modules"
    if (-not (Test-Path $nodeModules)) {
        # Must use Start-Process, not "& npm install" — with $ErrorActionPreference
        # = "Stop", a direct call treats ANY stderr line from a native command
        # (even a harmless npm deprecation warning) as a terminating exception,
        # aborting the script even when npm itself succeeds. Start-Process doesn't
        # do that translation; its real exit code is what actually matters.
        $installProc = Start-Process -FilePath $tools.Npm -ArgumentList "install" -WorkingDirectory $serverDir `
            -WindowStyle Hidden -RedirectStandardOutput (Join-Path $serverDir "install-out.log") `
            -RedirectStandardError (Join-Path $serverDir "install-err.log") -PassThru -Wait
        if ($installProc.ExitCode -ne 0) {
            Show-Error "Failed to install server dependencies (npm install).`n`nCheck install-err.log in the server folder for details."
            exit 1
        }
    }

    Start-Process -FilePath $tools.Node -ArgumentList "server.js" -WorkingDirectory $serverDir `
        -WindowStyle Hidden -RedirectStandardOutput $outLogPath -RedirectStandardError $errLogPath

    $waited = 0
    while (-not (Test-ServerUp) -and $waited -lt 20) {
        Start-Sleep -Seconds 1
        $waited++
    }
    if (-not (Test-ServerUp)) {
        Show-Error "The Research App server did not start in time.`n`nCheck server-err.log in the server folder for details."
        exit 1
    }

    $chromeCandidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    $edgeCandidates = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
    )
    $browser = ($chromeCandidates + $edgeCandidates) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $browser) {
        Show-Error "Could not find Chrome or Edge installed on this computer.`n`nPlease install one of them, then open Research App again."
        exit 1
    }

    Start-Process -FilePath $browser -ArgumentList "--app=http://localhost:$port"
} catch {
    Show-Error "Research App failed to start:`n`n$($_.Exception.Message)"
    exit 1
}
