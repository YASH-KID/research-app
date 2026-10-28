# First-time setup wizard for a completely fresh machine. Unlike launch.ps1 (which
# silently bootstraps whatever's missing and is meant to run invisibly every day),
# this shows a visible checklist window and is meant to be run once, on purpose, by
# a person watching it — e.g. handing this app to someone on a brand new PC with
# nothing installed. Checks/installs only what this app actually needs: Node.js and
# a Chromium browser. Nothing else (no Python, Java, etc. — this app doesn't use them).
#
# Some logic here intentionally duplicates launch.ps1's Get-NodeTools rather than
# sharing it — this app has no shared-module setup between scripts (same tradeoff as
# storage.js/server.js duplicating DEPTH_TIERS). Keep both in sync by hand if the
# Node-bootstrap logic ever changes; see research-app.md's Known Problems for the
# real bug that logic already had once (npm postinstall scripts need `node` on PATH).

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$serverDir = $PSScriptRoot
$appRoot = Split-Path $serverDir -Parent
$runtimeDir = Join-Path $serverDir "node-runtime"
$nodeVersion = "22.14.0"
$port = 8794

# ---------- Checklist window ----------

$steps = @(
    "Internet connection",
    "Node.js runtime",
    "App server dependencies",
    "Chrome or Edge browser",
    "Desktop shortcut"
)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Research App Setup"
$form.Size = New-Object System.Drawing.Size(480, 400)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $appRoot "icon.ico")) } catch {}

$title = New-Object System.Windows.Forms.Label
$title.Text = "Setting up Research App"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 18)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Checking what this computer needs, and installing anything missing."
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$subtitle.ForeColor = [System.Drawing.Color]::DimGray
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(21, 48)
$form.Controls.Add($subtitle)

$statusLabels = @()
$y = 90
foreach ($step in $steps) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = "⬜   $step"
    $lbl.Font = New-Object System.Drawing.Font("Segoe UI", 10.5)
    $lbl.AutoSize = $false
    $lbl.Location = New-Object System.Drawing.Point(24, $y)
    $lbl.Size = New-Object System.Drawing.Size(430, 22)
    $form.Controls.Add($lbl)

    $detail = New-Object System.Windows.Forms.Label
    $detail.Text = ""
    $detail.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
    $detail.ForeColor = [System.Drawing.Color]::DimGray
    $detail.AutoSize = $false
    $detail.Location = New-Object System.Drawing.Point(44, ($y + 20))
    $detail.Size = New-Object System.Drawing.Size(410, 18)
    $form.Controls.Add($detail)

    $statusLabels += , @{ Main = $lbl; Detail = $detail }
    $y += 46
}

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Style = "Marquee"
$progressBar.MarqueeAnimationSpeed = 30
$progressBar.Location = New-Object System.Drawing.Point(20, ($y + 6))
$progressBar.Size = New-Object System.Drawing.Size(430, 12)
$form.Controls.Add($progressBar)

$actionBtn = New-Object System.Windows.Forms.Button
$actionBtn.Text = "Cancel"
$actionBtn.Size = New-Object System.Drawing.Size(110, 32)
$actionBtn.Location = New-Object System.Drawing.Point(340, ($y + 30))
$script:cancelled = $false
$script:setupComplete = $false
$script:launchNow = $false
# One handler for the whole script, behavior driven by $script:setupComplete —
# simpler and less error-prone than swapping click handlers mid-run.
$actionBtn.Add_Click({
    if ($script:setupComplete) { $script:launchNow = $true } else { $script:cancelled = $true }
    $form.Close()
})
$form.Controls.Add($actionBtn)

$form.Add_Shown({ $form.Activate() })
$form.Show()
[System.Windows.Forms.Application]::DoEvents()

function Set-Step($index, $status, $detail) {
    $row = $statusLabels[$index]
    $icon = switch ($status) {
        "working" { "🔄" }
        "done" { "✅" }
        "failed" { "❌" }
        default { "⬜" }
    }
    $row.Main.Text = "$icon   $($steps[$index])"
    $row.Detail.Text = $detail
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
}

# Runs a non-blocking Start-Process while pumping the WinForms message loop, so the
# window stays responsive (repaints, "Cancel" works) instead of freezing during a
# slow step. (An earlier version of this used Start-Job for this, matching a common
# PowerShell GUI pattern — testing found it could hang indefinitely with no error in
# some invocation contexts, never fully root-caused. Started/polled processes are
# the same mechanism launch.ps1 already uses successfully everywhere, just made
# non-blocking here by omitting -Wait and polling .HasExited instead — no job
# infrastructure involved.)
function Invoke-TrackedProcess($FilePath, $ArgumentList, $WorkingDirectory, $OutLog, $ErrLog) {
    $psi = @{
        FilePath = $FilePath
        WorkingDirectory = $WorkingDirectory
        WindowStyle = "Hidden"
        PassThru = $true
    }
    if ($ArgumentList) { $psi.ArgumentList = $ArgumentList }
    if ($OutLog) { $psi.RedirectStandardOutput = $OutLog }
    if ($ErrLog) { $psi.RedirectStandardError = $ErrLog }
    $proc = Start-Process @psi
    while (-not $proc.HasExited) {
        if ($script:cancelled) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; throw "Setup cancelled." }
        Start-Sleep -Milliseconds 150
        [System.Windows.Forms.Application]::DoEvents()
    }
    return $proc.ExitCode
}

# Downloading can't be split into a separate started process the same way — this
# blocks the UI for its duration (no repaint, "Cancel" inert), same as launch.ps1
# already does for this exact call. A brief unresponsive window during a real
# network transfer is an acceptable, well-understood tradeoff; a script that might
# hang forever with no way to diagnose it is not.
function Invoke-BlockingDownload($Url, $OutFile) {
    [System.Windows.Forms.Application]::DoEvents()
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Show-Result($message, [bool]$isError) {
    $icon = if ($isError) { "Error" } else { "Information" }
    [System.Windows.Forms.MessageBox]::Show($message, "Research App Setup", "OK", $icon) | Out-Null
}

try {
    # ---------- 1. Internet connection ----------
    Set-Step 0 "working" "checking…"
    $hasInternet = try { Invoke-WebRequest -Uri "https://nodejs.org" -Method Head -TimeoutSec 6 -UseBasicParsing | Out-Null; $true } catch { $false }
    if ($hasInternet) {
        Set-Step 0 "done" "connected"
    } else {
        Set-Step 0 "failed" "no connection detected"
        throw "No internet connection was detected. Research App needs one to set up (and to actually do research later) — connect to the internet and run this setup again."
    }

    # ---------- 2. Node.js runtime ----------
    Set-Step 1 "working" "checking…"
    $systemNode = Get-Command node -ErrorAction SilentlyContinue
    $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($systemNode -and $systemNpm) {
        Set-Step 1 "done" "already installed ($(& $systemNode.Source --version))"
        $nodePath = $systemNode.Source
        $npmPath = $systemNpm.Source
    } else {
        $existing = Get-ChildItem -Path $runtimeDir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existing) {
            Set-Step 1 "done" "already downloaded earlier"
            $nodePath = $existing.FullName
            $npmPath = Join-Path $existing.DirectoryName "npm.cmd"
        } else {
            Set-Step 1 "working" "downloading a private copy (~30-50 MB)…"
            $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
            $zipName = "node-v$nodeVersion-win-$arch.zip"
            $url = "https://nodejs.org/dist/v$nodeVersion/$zipName"
            $zipPath = Join-Path $env:TEMP $zipName
            New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

            Invoke-BlockingDownload -Url $url -OutFile $zipPath

            Set-Step 1 "working" "installing…"
            [System.Windows.Forms.Application]::DoEvents()
            Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

            $downloaded = Get-ChildItem -Path $runtimeDir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $downloaded) { throw "The Node.js download completed but node.exe wasn't found afterward." }
            Set-Step 1 "done" "installed to this app's own folder"
            $nodePath = $downloaded.FullName
            $npmPath = Join-Path $downloaded.DirectoryName "npm.cmd"
        }
    }
    # Must be on PATH for this process, not just resolvable via full path — npm's
    # own postinstall scripts spawn `node` by bare name. See top-of-file note.
    $env:PATH = "$(Split-Path $nodePath -Parent);$env:PATH"

    # ---------- 3. App server dependencies ----------
    Set-Step 2 "working" "checking…"
    $nodeModules = Join-Path $serverDir "node_modules"
    if (Test-Path $nodeModules) {
        Set-Step 2 "done" "already installed"
    } else {
        Set-Step 2 "working" "installing (this can take a minute)…"
        $exitCode = Invoke-TrackedProcess -FilePath $npmPath -ArgumentList "install" -WorkingDirectory $serverDir `
            -OutLog (Join-Path $serverDir "install-out.log") -ErrLog (Join-Path $serverDir "install-err.log")
        if ($exitCode -ne 0) {
            Set-Step 2 "failed" "install failed — see install-err.log"
            throw "Failed to install server dependencies. Check install-err.log in the server folder for details."
        }
        Set-Step 2 "done" "installed"
    }

    # ---------- 4. Browser ----------
    Set-Step 3 "working" "checking…"
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
    if ($browser) {
        $browserName = if ($browser -match "Chrome") { "Google Chrome" } else { "Microsoft Edge" }
        Set-Step 3 "done" "found ($browserName)"
    } else {
        Set-Step 3 "failed" "neither found"
        throw "Neither Google Chrome nor Microsoft Edge was found. Research App needs one of them — install either, then run this setup again. (This is unusual on Windows, which normally includes Edge.)"
    }

    # ---------- 5. Desktop shortcut ----------
    Set-Step 4 "working" "creating…"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnkPath = Join-Path $desktop "Research App.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = "powershell.exe"
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $serverDir 'launch.ps1')`""
    $lnk.IconLocation = "$(Join-Path $appRoot 'icon.ico'),0"
    $lnk.WorkingDirectory = $appRoot
    $lnk.Save()
    Set-Step 4 "done" "created on your Desktop"

    $progressBar.Style = "Blocks"
    $progressBar.Value = 100
    $title.Text = "Setup complete!"
    $subtitle.Text = "Everything's ready."
    $actionBtn.Text = "Open Research App"
    $script:setupComplete = $true
    [System.Windows.Forms.Application]::DoEvents()

    # The window is already open (non-modal, from $form.Show() above) — just pump
    # the message loop until the user clicks the button (setting $script:launchNow
    # or $script:cancelled, both of which also call $form.Close()).
    while ($form.Visible) {
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.Application]::DoEvents()
    }

    if ($script:launchNow) {
        Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $serverDir 'launch.ps1')`""
    }
} catch {
    $form.Close()
    if (-not $script:cancelled) {
        Show-Result "Setup didn't finish:`n`n$($_.Exception.Message)" $true
    }
    exit 1
}
