#Requires -Version 5.1
# hostess installer (Windows / PowerShell)
# Usage:  iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex

# Set by the script itself when it re-launches elevated. On a standard account the UAC prompt is
# answered with a different admin account, and the elevated window then runs as that admin:
# without these, Hostess would install into the admin's profile and never start for the person
# who ran it.
param([string]$InstallUser, [string]$InstallProfile)

$ErrorActionPreference = "Stop"

Write-Host "== hostess installer (Windows) =="

# --- re-launch elevated (winget machine-scope installs + WSL need it) ---
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Re-launching as Administrator..."
    $who = "-InstallUser `"$env:USERDOMAIN\$env:USERNAME`" -InstallProfile `"$env:USERPROFILE`""
    $scriptPath = $MyInvocation.MyCommand.Path
    if ($scriptPath) {
        Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $who"
    } else {
        # running via `iex` (no file on disk), re-download and run elevated
        $tmp = Join-Path $env:TEMP "hostess-install.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri ("https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1?t=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $tmp
        Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$tmp`" $who"
    }
    Write-Host "Continuing in the new elevated window, check your taskbar for the UAC prompt / PowerShell icon."
    exit
}

# Who Hostess is being installed for: the person who started the script, not whoever elevated it.
$TargetUser = if ($InstallUser) { $InstallUser } else { "$env:USERDOMAIN\$env:USERNAME" }
$TargetProfile = if ($InstallProfile) { $InstallProfile } else { $env:USERPROFILE }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
    $winApps = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
    if ((Test-Path $winApps) -and ($env:Path -notlike "*$winApps*")) {
        $env:Path += ";$winApps"
    }
}

function Test-DockerRunning {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        docker info *>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prev
    }
}

Refresh-Path

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host -ForegroundColor Red "winget not found. Install 'App Installer' from the Microsoft Store, then re-run this script."
    exit 1
}

# --- prerequisites ---
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing git..."
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) {
    try { $nodeMajor = [int]((node -v) -replace '^v(\d+)\..*','$1') } catch { $nodeMajor = 0 }
}
if ($nodeMajor -lt 18) {
    Write-Host "Installing Node.js LTS..."
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Docker Desktop..."
    winget install --id Docker.DockerDesktop -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

# Go Online opens its links with cloudflared. Optional: everything else works without it.
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Installing cloudflared (used by Go Online)..."
    winget install --id Cloudflare.cloudflared -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

# Docker Desktop's named pipe only accepts docker-users members (or admins).
# Its own GUI first-run wizard normally adds you to that group, but a silent
# winget install skips that wizard entirely -- so the scheduled task below,
# which runs at standard (Limited) rights rather than this elevated session,
# can come up unable to reach Docker at all even though the check right below
# this (run as Administrator) succeeds. Add the membership ourselves so it
# doesn't depend on the user ever clicking through that wizard.
$addedToDockerUsers = $false
try {
    if (Get-LocalGroup -Name "docker-users" -ErrorAction SilentlyContinue) {
        if (-not (Get-LocalGroupMember -Group "docker-users" -Member $TargetUser -ErrorAction SilentlyContinue)) {
            Write-Host "Adding $TargetUser to the docker-users group..."
            Add-LocalGroupMember -Group "docker-users" -Member $TargetUser -ErrorAction SilentlyContinue
            $addedToDockerUsers = $true
        }
    }
} catch {}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
wsl --status *>$null
$wslExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($wslExit -ne 0) {
    Write-Host "Enabling WSL2 (required by Docker Desktop)..."
    wsl --install --no-distribution
    Write-Warning "WSL2 was just installed, reboot Windows, then re-run this script to finish setup."
    exit 0
}

# Docker Desktop runs inside one person's Windows session. If the UAC prompt was answered with a
# different admin account, starting it here would start it for that admin, not for $TargetUser.
$sameUser = ($TargetUser -eq "$env:USERDOMAIN\$env:USERNAME")
$dockerRunning = Test-DockerRunning
if (-not $dockerRunning -and -not $sameUser) {
    Write-Warning "Docker Desktop isn't running. Start it from the Start menu as $TargetUser and finish its first-run setup; Hostess will pick it up."
} elseif (-not $dockerRunning) {
    Write-Host "Starting Docker Desktop..."
    Start-Process (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    Write-Host -NoNewline "Waiting for Docker to be ready (first run needs you to click through its setup)..."
    $attempts = 0
    do {
        Start-Sleep -Seconds 3
        Write-Host -NoNewline "."
        $dockerRunning = Test-DockerRunning
        $attempts++
    } until ($dockerRunning -or $attempts -ge 100)
    if (-not $dockerRunning) {
        Write-Host ""
        Write-Host -ForegroundColor Red "Docker still isn't responding after 5 minutes. Open Docker Desktop, finish its first-run setup (accept the license, skip sign-in if asked), wait for the whale icon in the tray to say 'running', then re-run this script."
        exit 1
    }
    Write-Host " ready."
}

# --- fetch the app ---
$RepoUrl = "https://github.com/jessekward-prog/hostess.git"
$InstallDir = if ($env:HOSTESS_DIR) { $env:HOSTESS_DIR } else { Join-Path $TargetProfile "hostess" }

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
# npm.cmd, not npm: under PowerShell plain `npm` resolves to npm.ps1, which the default
# execution policy refuses to run.
npm.cmd install --omit=dev

# Everything above ran elevated, so the files belong to the admin account. Git refuses to work in
# a repository owned by someone else ("dubious ownership"), which would break every self-update.
icacls $InstallDir /setowner $TargetUser /T /C /Q | Out-Null

# --- scheduled task (starts at logon, runs hidden, auto-restarts on non-zero exit) ---
$TaskName = "hostess"
$dirQ = $InstallDir -replace "'", "''"   # a profile such as C:\Users\O'Brien must not end the quoted path
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"Set-Location '$dirQ'; while (`$true) { node server.js; if (`$LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 2 }`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $TargetUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

# --- hourly self-update scheduled task ---
# Restarts by stopping whatever owns port 5300, never every node.exe running a server.js:
# that would also kill the user's own unrelated Node servers.
$UpdateTaskName = "hostess-update"
$updateAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"`$old = git -C '$dirQ' rev-parse HEAD; git -C '$dirQ' pull --ff-only; if (`$LASTEXITCODE -eq 0 -and (git -C '$dirQ' rev-parse HEAD) -ne `$old) { npm.cmd --prefix '$dirQ' install --omit=dev; Get-NetTCPConnection -LocalPort 5300 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id `$_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-ScheduledTask -TaskName hostess }`""
$updateTrigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)
$updateSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $UpdateTaskName -Action $updateAction -Trigger $updateTrigger `
    -Settings $updateSettings -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "hostess is running at http://localhost:5300"
Write-Host "Manage it with: Start-ScheduledTask/Stop-ScheduledTask -TaskName $TaskName"
if ($addedToDockerUsers) {
    Write-Warning "You were just added to the docker-users group. Sign out of Windows and back in once, or deploys will fail with a Docker permission error."
}
Start-Sleep -Seconds 1
if ($sameUser) { Start-Process "http://localhost:5300" }
