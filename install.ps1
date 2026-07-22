$ErrorActionPreference = "Stop"

$REPO = "Abdulmumin1/chump"
$INSTALL_DIR = "$env:USERPROFILE\.chump\bin"

# Colors
function Write-Green { param($text) Write-Host $text -ForegroundColor Green }
function Write-Red { param($text) Write-Host $text -ForegroundColor Red }
function Write-Muted { param($text) Write-Host $text -ForegroundColor Gray }

# Detect Architecture
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq "AMD64") {
    $arch = "x64"
} elseif ($arch -eq "ARM64") {
    $arch = "arm64"
} else {
    Write-Red "Unsupported architecture: $arch"
    exit 1
}

$filename = "chump-windows-${arch}.tar.gz"
Write-Muted "Detected: windows-${arch}"

# Get Latest Version
Write-Muted "Fetching latest version..."
try {
    $response = Invoke-WebRequest -Uri "https://github.com/$REPO/releases/latest" -Method Head -MaximumRedirection 0 -ErrorAction Stop
    if ($response.StatusCode -eq 302) {
        $latestUrl = $response.Headers["Location"]
        $candidateTag = $latestUrl | Split-Path -Leaf
        if ($candidateTag -match "^chump-agent@") {
            $latestTag = $candidateTag
        }
    } else {
        throw "Could not determine latest release"
    }
} catch {
    # Ignore; will fall through to API below
}

if (-not $latestTag) {
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases?per_page=30"
        foreach ($release in $releases) {
            if ($release.tag_name -match "^chump-agent@") {
                $latestTag = $release.tag_name
                break
            }
        }
    } catch {
       Write-Red "Failed to fetch latest version."
       exit 1
    }
    
    if (-not $latestTag) {
        Write-Red "Could not determine latest tag."
        exit 1
    }
}

Write-Muted "Installing version: $latestTag"

# Download
$url = "https://github.com/$REPO/releases/download/$latestTag/$filename"
$destDir = $INSTALL_DIR
$archive = "$env:TEMP\chump-install-$PID-$filename"
$extractDir = "$env:TEMP\chump-install-$PID"
$packageDir = "$extractDir\chump-windows-${arch}"
$dest = "$destDir\chump.exe"

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
}

Write-Muted "Downloading..."
try {
    Invoke-WebRequest -Uri $url -OutFile $archive
} catch {
    Write-Red "Download failed from $url"
    Write-Red "Please check if the release exists for your architecture."
    exit 1
}

if (Test-Path $extractDir) {
    Remove-Item -Recurse -Force $extractDir
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
tar -xzf $archive -C $extractDir

if (-not (Test-Path "$packageDir\chump.exe")) {
    Write-Red "Release archive is missing chump.exe"
    exit 1
}

$serverDir = "$packageDir\server"
$server = Get-ChildItem -Path $packageDir -Filter "chump-server-*.exe" | Select-Object -First 1
if ((-not (Test-Path $serverDir)) -and (-not $server)) {
    Write-Red "Release archive is missing chump-server runtime"
    exit 1
}

$stagedApp = "$destDir\.chump.install-$PID.exe"
$stagedServer = "$destDir\.server.install-$PID"
$stagedCompletions = "$destDir\.completions.install-$PID"

Copy-Item "$packageDir\chump.exe" $stagedApp -Force
if (Test-Path $serverDir) {
    Copy-Item $serverDir $stagedServer -Recurse -Force
} else {
    New-Item -ItemType Directory -Force -Path $stagedServer | Out-Null
    Copy-Item $server.FullName "$stagedServer\$($server.Name)" -Force
}
Move-Item $stagedApp $dest -Force
Get-ChildItem -Path $destDir -Filter "chump-server-*.exe" -ErrorAction SilentlyContinue | Remove-Item -Force
if (Test-Path "$destDir\server") {
    Remove-Item -Recurse -Force "$destDir\server"
}
Move-Item $stagedServer "$destDir\server" -Force

# Generate the completion script from the installed binary, then register a
# small managed profile block. This keeps completion available after a normal
# install without asking the user to run an extra setup command.
New-Item -ItemType Directory -Force -Path $stagedCompletions | Out-Null
& $dest completion powershell | Set-Content -Path "$stagedCompletions\chump.ps1" -Encoding utf8
if (Test-Path "$destDir\completions") {
    Remove-Item -Recurse -Force "$destDir\completions"
}
Move-Item $stagedCompletions "$destDir\completions" -Force

$profilePath = $PROFILE.CurrentUserAllHosts
$profileDirectory = Split-Path -Parent $profilePath
if (-not (Test-Path $profileDirectory)) {
    New-Item -ItemType Directory -Force -Path $profileDirectory | Out-Null
}
if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Force -Path $profilePath | Out-Null
}
$completionStart = "# chump completion"
$completionEnd = "# /chump completion"
$profileContent = Get-Content -Raw -Path $profilePath
if ($profileContent -notmatch [regex]::Escape($completionStart)) {
    Add-Content -Path $profilePath -Value "`n$completionStart`n. '$destDir\completions\chump.ps1'`n$completionEnd"
    Write-Muted "Enabled PowerShell completion."
}

Remove-Item -Recurse -Force $extractDir
Remove-Item -Force $archive

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$INSTALL_DIR*") {
    $newPath = "$userPath;$INSTALL_DIR"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Muted "Added to User PATH."
}

Write-Host ""
Write-Green "chump installed successfully!"
Write-Host ""
Write-Muted "To get started:"
Write-Muted "1. Restart your terminal."
Write-Muted "2. Run: chump"
Write-Host ""
