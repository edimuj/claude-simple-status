# claude-simple-status installer for Windows
# Run: irm https://raw.githubusercontent.com/edimuj/claude-simple-status/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$ScriptUrl = "https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.mjs"
$InstallDir = Join-Path $env:USERPROFILE ".claude\statusline"
$SettingsFile = Join-Path $env:USERPROFILE ".claude\settings.json"

Write-Host "Installing claude-simple-status..."

# Check for Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is required but not installed." -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/"
    exit 1
}

# Create directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Download script
Write-Host "> Downloading statusline.mjs..."
Invoke-WebRequest -Uri $ScriptUrl -OutFile (Join-Path $InstallDir "statusline.mjs")

# Configure settings.json
if (Test-Path $SettingsFile) {
    $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
    if ($settings.statusLine) {
        Write-Host "> statusLine already configured in settings.json"
        Write-Host "  If you want to use claude-simple-status, update your settings.json:"
        Write-Host ""
        Write-Host '  "statusLine": {'
        Write-Host '    "type": "command",'
        Write-Host '    "command": "node ~/.claude/statusline/statusline.mjs"'
        Write-Host '  }'
    } else {
        Write-Host "> Adding statusLine to settings.json..."
        $settings | Add-Member -NotePropertyName "statusLine" -NotePropertyValue @{
            type = "command"
            command = "node ~/.claude/statusline/statusline.mjs"
        }
        $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile
        Write-Host "  Configuration added"
    }
} else {
    Write-Host "> Creating settings.json..."
    $claudeDir = Split-Path $SettingsFile
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }
    @{
        statusLine = @{
            type = "command"
            command = "node ~/.claude/statusline/statusline.mjs"
        }
    } | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile
    Write-Host "  Configuration created"
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Your statusline will appear at the bottom of Claude Code:"
Write-Host "  Opus 4.5 | 31% | 23:00 | 5h:18% | 7d:10%"
