#Requires -Version 5.1
# hostess installer (Windows / PowerShell)
# Usage:  iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host "== hostess installer (Windows) =="

# --- re-launch elevated (winget machine-scope installs + WSL need it) ---
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Re-launching as Administrator..."
    $scriptPath = $MyInvocation.MyCommand.Path
    if ($scriptPath) {
        Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    } else {
        # running via `iex` (no file on disk), re-download and run elevated
        $tmp = Join-Path $env:TEMP "hostess-install.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1" -OutFile $tmp
        Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$tmp`""
    }
    Write-Host "Continuing in the new elevated window, check your taskbar for the UAC prompt / PowerShell icon."
    exit
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget not found. Install 'App Installer' from the Microsoft Store, then re-run this script."
    exit 1
}

# --- prerequisites ---
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing git..."
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Node.js LTS..."
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Docker Desktop..."
    winget install --id Docker.DockerDesktop -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

$wslStatus = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Enabling WSL2 (required by Docker Desktop)..."
    wsl --install --no-distribution
    Write-Warning "WSL2 was just installed, reboot Windows, then re-run this script to finish setup."
    exit 0
}

$dockerRunning = $false
try { docker info *>$null; $dockerRunning = $true } catch {}
if (-not $dockerRunning) {
    Write-Host "Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    Write-Host -NoNewline "Waiting for Docker to be ready (first run needs you to click through its setup)..."
    $attempts = 0
    do {
        Start-Sleep -Seconds 3
        Write-Host -NoNewline "."
        try { docker info *>$null; $dockerRunning = $true } catch {}
        $attempts++
    } until ($dockerRunning -or $attempts -ge 100)
    if (-not $dockerRunning) {
        Write-Host ""
        Write-Error "Docker still isn't responding after 5 minutes. Open Docker Desktop, finish its first-run setup (accept the license, skip sign-in if asked), wait for the whale icon in the tray to say 'running', then re-run this script."
        exit 1
    }
    Write-Host " ready."
}

# --- fetch the app ---
$RepoUrl = "https://github.com/jessekward-prog/hostess.git"
$InstallDir = if ($env:HOSTESS_DIR) { $env:HOSTESS_DIR } else { Join-Path $env:USERPROFILE "hostess" }

$scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $null }
$pkgJson = if ($scriptDir) { Join-Path $scriptDir "package.json" } else { $null }

if ($pkgJson -and (Test-Path $pkgJson) -and (Select-String -Path $pkgJson -Pattern '"name":\s*"hostess"' -Quiet)) {
    $InstallDir = $scriptDir
    Write-Host "Running from existing checkout at $InstallDir"
} elseif (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "Updating existing install at $InstallDir"
    git -C $InstallDir pull --ff-only
} else {
    Write-Host "Cloning into $InstallDir"
    git clone --depth 1 $RepoUrl $InstallDir
}

Set-Location $InstallDir
npm install --omit=dev

# --- scheduled task (survives logoff/reboot, runs hidden) ---
$TaskName = "hostess"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$InstallDir'; node server.js`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "hostess is running at http://localhost:5300"
Write-Host "Manage it with: Start-ScheduledTask/Stop-ScheduledTask -TaskName $TaskName"
Start-Sleep -Seconds 1
Start-Process "http://localhost:5300"
