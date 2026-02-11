<p align="center">
  <img src="assets/claude-simple-status-mascot-512.png" width="256" alt="claude-simple-status mascot">
</p>

# claude-simple-status

[![npm](https://img.shields.io/npm/v/claude-simple-status)](https://www.npmjs.com/package/claude-simple-status)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()

A simple, no-frills statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that shows what matters: **project name, git branch, model, context usage, quota, and API costs**.

![statusline screenshot](assets/statusline.png)

## Features

- **Zero dependencies** — single Node.js script, no runtime dependencies
- **Cross-platform** — works on macOS, Linux, and Windows
- **Non-blocking** — returns cached data instantly, refreshes quota in the background
- **Color-coded** — green/orange/red percentages at a glance
- **Project name** — bold uppercase project directory name so you never mix up sessions
- **Git-aware** — shows the current branch name in repos (cached 30s to reduce overhead)
- **API cost tracking** — pay-as-you-go API users see cumulative session cost instead of quota
- **Stale-aware** — shows `--` for quota values when cache is outdated, real values appear after first refresh
- **Timezone-smart** — quota reset time converted to your local timezone

If the quota API is unreachable, a red `ERR` indicator appears at the end and clears automatically once the connection recovers.

## Installation

```bash
npm install -g claude-simple-status
```

That's it — Claude Code is configured automatically. The statusline appears immediately.

To uninstall:

```bash
claude-simple-status --uninstall
npm uninstall -g claude-simple-status
```

<details>
<summary>Alternative: shell script (macOS / Linux)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/edimuj/claude-simple-status/main/install.sh | bash
```

</details>

<details>
<summary>Alternative: PowerShell (Windows)</summary>

```powershell
irm https://raw.githubusercontent.com/edimuj/claude-simple-status/main/install.ps1 | iex
```

</details>

<details>
<summary>Manual installation</summary>

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

To uninstall, remove `~/.claude/statusline/` and the `"statusLine"` block from settings.json.

</details>

## Requirements

- Claude Code CLI
- Node.js (v18+)

## How it works

1. Receives model/context/cost info from Claude Code via stdin (JSON)
2. Reads cached quota data and returns immediately (never blocks the UI)
3. If the cache is stale (>2 minutes), refreshes from Anthropic's OAuth API in the background
4. Converts UTC reset time to your local timezone
5. Outputs a formatted statusline with ANSI colors

**Subscription users** see quota percentages and reset times. **API (pay-as-you-go) users** see cumulative session cost (e.g. `$4.72`) — calculated by Claude Code from actual token usage, no external pricing lookups needed.

Quota data is cached to the system temp directory and refreshed every 2 minutes. Since Claude Code calls the statusline on every message update, this avoids excessive API calls while keeping the data fresh.

## Troubleshooting

**Indicators:**
- `--` for quota values means the cache is stale (>5 minutes old) — values appear after the first background refresh
- `?` means quota data has never been fetched yet
- `ERR` (red) means the last quota fetch failed — clears automatically on recovery

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

## Related projects

### [claude-rig](https://github.com/edimuj/claude-rig)

Run multiple isolated Claude Code configurations simultaneously — each with its own plugins, skills, MCP servers, and settings. When a session is launched through claude-rig, the active profile name appears in the statusline in bold magenta:

```
MY-PROJECT [main] | minimal | Opus 4.6 | 12% | 14:30 | 5h:34% | 7d:12%
```

No configuration needed — claude-simple-status detects claude-rig automatically. Users not using claude-rig are unaffected.

## Contributing

Contributions are welcome! This project follows a few principles:

- Single file, zero dependencies
- Cross-platform (macOS, Linux, Windows)
- Never block the UI

Open an [issue](https://github.com/edimuj/claude-simple-status/issues) or submit a pull request.

## License

[MIT](https://opensource.org/licenses/MIT)
