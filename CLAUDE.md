# CLAUDE.md

Single-file statusline for Claude Code. See README.md for user-facing docs.

## Architecture

One script, zero dependencies: `statusline.mjs` (Node.js, ESM).
Config file: `~/.config/claude-simple-status.json` (optional, features off by default).

- Receives model/context JSON from Claude Code via stdin
- Fetches quota from Anthropic OAuth API in a detached background child process (never blocks)
- Caches quota to temp dir (`/tmp/claude-statusline-quota.json`, 120s TTL)
- Uses mkdir-based file locking to prevent concurrent fetches
- Errors logged to `/tmp/claude-statusline.log` (auto-trimmed to 50 lines)

## Statusline format

Subscription users:
```
PROJECT [branch] | Profile | Model | Context% →~Nt | ResetTime | 5h:Quota% | 7d:Quota%
```

API (pay-as-you-go) users:
```
PROJECT [branch] | Profile | Model | Context% →~Nt | $Cost
```

- Project: bold white uppercase (from workspace.project_dir in stdin)
- Branch: bold yellow in brackets, hidden when not in a git repo
- Profile: bold magenta, hidden when not using claude-rig
- Model: cyan
- Cost: green, cumulative session cost from Claude Code (cost.total_cost_usd)
- Percentages: green (<=50%), orange (51-69%), red (>=70%)
- Context velocity: `→~8t` = steady, ~8 turns left; `↑~3t` = accelerating; `↓~12t` = decelerating
  - Color: green (>15t), orange (6-15t), red (≤5t)
  - Hidden until 2+ turn deltas observed; resets on compaction (context % drop)
  - History cached per project in `/tmp/claude-statusline-context.json`
- Quota burn rate prediction: tracked per window (5h/7d) in `/tmp/claude-statusline-quota-history.json`
  - Reset time: colored by 5h burn rate projection (green=safe, orange=tight, red=will exhaust before reset)
  - 7d percentage: color overridden to orange/red when projection says danger (even if absolute % is low)
  - Needs 2+ distinct readings with ≥1min elapsed to compute rate
  - "tight" threshold: projected exhaustion within 30min after reset
  - Resets tracking when quota drops (new window detected)
- `ERR` appended in red if last quota fetch failed

## Key conventions

- No external dependencies - only Node.js built-in modules
- Never block stdout - return cached data immediately, refresh in background
- Cross-platform: works on macOS, Linux, Windows (Node.js handles the differences)
- Installers: `install.sh` (bash) and `install.ps1` (PowerShell) mirror each other
