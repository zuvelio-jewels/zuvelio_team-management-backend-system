# ═══════════════════════════════════════════════════════════════════════════════
# INSTALL_ANY_PC.ps1 — Zuvelio Universal Employee Installer
# Run this ONCE on any PC. It shows the employee list, you pick your name,
# and tracking is fully configured automatically.
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot
$API_URL = "https://zuvelioteam-management-backend-system-production.up.railway.app/api"
$INSTALL_DIR = "C:\Program Files\Zuvelio\ActivityAgent"
$NODE_EXE = "C:\Program Files\nodejs\node.exe"

function Write-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║          ZUVELIO OFFICE ACTIVITY TRACKING - SETUP              ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($n, $total, $text) {
    Write-Host "  [$n/$total] $text" -ForegroundColor Yellow
}
function Write-OK($t) { Write-Host "        OK  $t" -ForegroundColor Green }
function Write-Fail($t) { Write-Host "      FAIL  $t" -ForegroundColor Red; pause; exit 1 }

# ── Step 1: Check / Auto-install Node.js ──────────────────────────────────────
Write-Banner
Write-Step 1 5 "Checking Node.js..."

if (-not (Test-Path $NODE_EXE)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $nodeFallback = if ($nodeCmd) { $nodeCmd.Source } else { $null }
    if ($nodeFallback) {
        $NODE_EXE = $nodeFallback
        Write-OK "Node.js found at $NODE_EXE"
    }
    else {
        Write-Host "  Node.js not found. Downloading and installing automatically..." -ForegroundColor Yellow

        # Get latest LTS version number from nodejs.org
        try {
            $releases = Invoke-RestMethod "https://nodejs.org/dist/index.json" -TimeoutSec 30
            $lts = $releases | Where-Object { $_.lts -ne $false } | Select-Object -First 1
            $version = $lts.version
        }
        catch {
            $version = "v22.15.0"  # known good LTS fallback
        }

        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $msiUrl = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
        $msiPath = "$env:TEMP\node-installer.msi"

        Write-Host "  Downloading Node.js $version..." -ForegroundColor Gray
        try {
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($msiUrl, $msiPath)
        }
        catch {
            Write-Fail "Could not download Node.js. Check internet connection and try again."
        }

        Write-Host "  Installing Node.js (this takes ~30 seconds)..." -ForegroundColor Gray
        $msiResult = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$msiPath`" /qn /norestart ADDLOCAL=ALL" -Wait -PassThru
        if ($msiResult.ExitCode -ne 0) {
            Write-Fail "Node.js installer failed (exit $($msiResult.ExitCode)). Try installing manually from https://nodejs.org"
        }

        # Refresh PATH so node.exe is found in this session
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $NODE_EXE = if ($nodeCmd) { $nodeCmd.Source } else { "C:\Program Files\nodejs\node.exe" }

        if (-not (Test-Path $NODE_EXE)) {
            Write-Fail "Node.js installed but not found. Please restart this PC and run INSTALL_ANY_PC.bat again."
        }
        $nodeVer = & $NODE_EXE --version 2>&1
        Write-OK "Node.js $nodeVer installed successfully"
    }
}
else {
    $nodeVer = & $NODE_EXE --version 2>&1
    Write-OK "Node.js $nodeVer"
}

# ── Steps 2-4: Check pre-configured .env (downloaded from dashboard) ──────────
$token = $null
$employeeName = "Employee"
$deviceName = "PC-$(hostname)-$(Get-Date -Format 'yyyy-MM-dd')"
$preConfigured = $false

$preEnvPath = Join-Path $SCRIPT_DIR ".env"
if (Test-Path $preEnvPath) {
    $preEnv = Get-Content $preEnvPath -Raw
    $tokenMatch = [regex]::Match($preEnv, 'DEVICE_TOKEN=(.+)')
    $nameMatch  = [regex]::Match($preEnv, 'EMPLOYEE_NAME=(.+)')
    if ($tokenMatch.Success -and $tokenMatch.Groups[1].Value.Trim().Length -gt 10) {
        $token = $tokenMatch.Groups[1].Value.Trim()
        $employeeName = if ($nameMatch.Success) { $nameMatch.Groups[1].Value.Trim() } else { "Employee" }
        $preConfigured = $true
        Write-Step 2 5 "Account detected from dashboard..."
        Write-OK "Account: $employeeName"
        Write-Step 3 5 "Name selection: skipped (auto-configured)"
        Write-OK "No manual selection needed"
        Write-Step 4 5 "Device registration: skipped (token ready)"
        Write-OK "Token pre-configured"
    }
}

if (-not $preConfigured) {
    # ── Step 2: Fetch employee list from backend ───────────────────────────────
    Write-Step 2 5 "Connecting to Zuvelio server..."
    $adminCreds = @{ email = "admin@zuvelio.com"; password = "Admin@123" } | ConvertTo-Json -Compress
    try {
        $authResp = Invoke-RestMethod -Uri "$API_URL/auth/login" -Method POST -ContentType "application/json" -Body $adminCreds -TimeoutSec 15
    }
    catch {
        Write-Fail "Cannot connect to Zuvelio server. Check your internet connection and try again.`n        Error: $_"
    }
    $jwt = $authResp.accessToken
    Write-OK "Connected to Zuvelio server"

    $hdrs = @{ Authorization = "Bearer $jwt" }
    try {
        $employees = Invoke-RestMethod -Uri "$API_URL/activity/admin/employees" -Headers $hdrs -TimeoutSec 15
    }
    catch {
        Write-Fail "Could not fetch employee list: $_"
    }

    # ── Step 3: Pick employee ──────────────────────────────────────────────────
    Write-Step 3 5 "Who is using this PC?"
    Write-Host ""
    Write-Host "  Select your name from the list below:" -ForegroundColor White
    Write-Host ""
    $i = 1; $selectable = @()
    foreach ($emp in $employees) {
        $roleTag = "[$($emp.role.Substring(0,3))]"
        Write-Host ("    {0,2}.  {1,-25} {2}" -f $i, $emp.name, $roleTag) -ForegroundColor White
        $selectable += $emp; $i++
    }
    Write-Host ""
    $choice = 0
    while ($choice -lt 1 -or $choice -gt $selectable.Count) {
        $raw = Read-Host "  Enter number (1-$($selectable.Count))"
        if ($raw -match '^\d+$') { $choice = [int]$raw }
    }
    $target = $selectable[$choice - 1]
    $employeeName = $target.name
    Write-Host ""
    Write-Host "  Selected: $employeeName ($($target.role))" -ForegroundColor Cyan
    Write-Host ""

    # ── Step 4: Create device token ────────────────────────────────────────────
    Write-Step 4 5 "Registering this PC..."
    $regBody = @{ userId = $target.id; deviceName = $deviceName } | ConvertTo-Json -Compress
    try {
        $device = Invoke-RestMethod -Uri "$API_URL/activity/agent/register-device" -Method POST -ContentType "application/json" -Headers $hdrs -Body $regBody -TimeoutSec 15
    }
    catch {
        Write-Fail "Could not register device: $_"
    }
    $token = $device.token
    Write-OK "Device registered: $deviceName"
}

# ── Step 5: Install agent files ───────────────────────────────────────────────
Write-Step 5 5 "Installing activity agent..."

# Create install directory
if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

# Copy src and node_modules from ZIP extract location
$srcDir = Join-Path $SCRIPT_DIR "src"
$pkgJson = Join-Path $SCRIPT_DIR "package.json"

if (-not (Test-Path $srcDir)) {
    Write-Fail "src folder missing. Make sure you extracted ALL files from the ZIP before running."
}

Write-Host "        Copying agent source files..." -ForegroundColor Gray
Copy-Item $srcDir  (Join-Path $INSTALL_DIR "src")         -Recurse -Force
Copy-Item $pkgJson (Join-Path $INSTALL_DIR "package.json") -Force

# Install node_modules on this PC using npm (comes with Node.js)
Write-Host "        Installing dependencies (npm install, ~30 seconds)..." -ForegroundColor Gray
$npmExe = Join-Path (Split-Path $NODE_EXE) "npm.cmd"
if (-not (Test-Path $npmExe)) { $npmExe = "npm" }
Push-Location $INSTALL_DIR
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $npmExe install --omit=dev 2>&1 | ForEach-Object { Write-Host "        $_" -ForegroundColor Gray }
$npmExit = $LASTEXITCODE
$ErrorActionPreference = $prevPref
Pop-Location
if ($npmExit -ne 0) {
    Write-Fail "npm install failed (exit $npmExit). See output above."
}
Write-OK "Agent files installed"

# Write .env
$envContent = @"
API_URL=$API_URL
DEVICE_TOKEN=$token
EMPLOYEE_NAME=$employeeName
FLUSH_INTERVAL_MS=5000
MOUSE_MOVE_SAMPLE_MS=1000
IDLE_THRESHOLD_MS=600000
HEARTBEAT_INTERVAL_MS=60000
SESSION_ID=desktop-agent
"@
$envContent | Set-Content (Join-Path $INSTALL_DIR ".env") -Encoding UTF8
Write-OK ".env configured"

# Write run-agent.bat (elevated launcher)
$runBat = "@echo off`r`nnet session >nul 2>&1`r`nif %errorLevel% neq 0 (`r`n    powershell -NoProfile -WindowStyle Hidden -Command `"Start-Process '%~f0' -Verb RunAs`"`r`n    exit /b`r`n)`r`ncd /d `"$INSTALL_DIR`"`r`n`"$NODE_EXE`" src\index.js`r`n"
$runBat | Set-Content (Join-Path $INSTALL_DIR "run-agent.bat") -Encoding ASCII
Write-OK "Launcher created"

# Windows Startup entry (auto-start on login)
$startupDir = [System.Environment]::GetFolderPath('Startup')
$startupBat = "@echo off`r`ncd /d `"$INSTALL_DIR`"`r`npowershell -NoProfile -WindowStyle Hidden -Command `"Start-Process '$INSTALL_DIR\run-agent.bat' -Verb RunAs -WindowStyle Hidden`"`r`n"
$startupBat | Set-Content (Join-Path $startupDir "ZuvelioActivityAgent.bat") -Encoding ASCII
Write-OK "Auto-start on Windows login enabled"

# Kill any existing agent
try { Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 1

# Start agent now (elevated, hidden)
$runBatPath = Join-Path $INSTALL_DIR "run-agent.bat"
Start-Process -FilePath $runBatPath -Verb RunAs -WindowStyle Hidden
Write-OK "Agent started"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║                    INSTALLATION COMPLETE!                       ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
  Write-Host "  Employee  : $employeeName" -ForegroundColor White
Write-Host "  Device    : $deviceName" -ForegroundColor White
Write-Host "  Status    : Tracking is now ACTIVE" -ForegroundColor Green
Write-Host ""
Write-Host "  Activity will appear on the Zuvelio dashboard within 30 seconds." -ForegroundColor Gray
Write-Host "  Agent auto-starts every time Windows boots." -ForegroundColor Gray
Write-Host ""
pause
