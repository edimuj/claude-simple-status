# claude-simple-status

A simple, no-frills statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that shows what matters: **model, context usage, and quota**.

```
Opus 4.5 | 31% | 23:00 | 5h:18% | 7d:10%
```

If the quota API is unreachable, a red `ERR` indicator appears at the end and disappears once the connection recovers.

## Why?

Other statusline solutions are overcomplicated. This one is a single cross-platform script that shows:

- **Model name** (cyan) - Which model you're using
- **Context %** - How full your context window is (green/orange/red)
- **Reset time** - When your 5-hour quota resets (local timezone)
- **5h %** - 5-hour rolling quota usage
- **7d %** - 7-day rolling quota usage

All percentages are color-coded:
- **Green**: ≤50%
- **Orange**: 51-69%
- **Red**: ≥70%

## Installation

### One-liner

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/edimuj/claude-simple-status/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/edimuj/claude-simple-status/main/install.ps1 | iex
```

This downloads the script, installs it to `~/.claude/statusline/`, and configures your `settings.json`.

### Manual installation

<details>
<summary>macOS / Linux</summary>

**1. Copy the script**

```bash
mkdir -p ~/.claude/statusline
curl -o ~/.claude/statusline/statusline.mjs \
  https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.mjs
```

**2. Configure Claude Code**

Add to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/statusline.mjs"
  }
}
```

</details>

<details>
<summary>Windows</summary>

**1. Copy the script**

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\.claude\statusline" -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.mjs" -OutFile "$env:USERPROFILE\.claude\statusline\statusline.mjs"
```

**2. Configure Claude Code**

Add to your `%USERPROFILE%\.claude\settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/statusline.mjs"
  }
}
```

</details>

The statusline will appear at the bottom of your terminal immediately.

## Requirements

- Claude Code CLI
- Node.js (v18+)

## How it works

The script:
1. Receives model/context info from Claude Code via stdin (JSON)
2. Reads cached quota data and returns immediately (never blocks the UI)
3. If the cache is stale (>2 minutes), refreshes from Anthropic's OAuth API in the background
4. Converts UTC reset time to your local timezone
5. Outputs a formatted statusline with ANSI colors

Quota data is cached to the system temp directory and refreshed every 2 minutes. Since Claude Code calls the statusline on every message update, this avoids excessive API calls while keeping the data fresh.

## Troubleshooting

If the statusline shows `ERR`, check the error log:

```bash
# macOS/Linux
cat /tmp/claude-statusline.log

# Windows (PowerShell)
Get-Content $env:TEMP\claude-statusline.log
```

To force a fresh quota fetch, clear the cache:

```bash
# macOS/Linux
rm /tmp/claude-statusline-quota.json

# Windows (PowerShell)
Remove-Item $env:TEMP\claude-statusline-quota.json
```

## License

MIT
