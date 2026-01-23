# claude-simple-status

A simple, no-frills statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that shows what matters: **model, context usage, and quota**.

```
Opus 4.5 | 🧠  31% | ⏰ 23:00 | 5h:18.0% | 7d:10.0%
```

## Why?

Other statusline solutions are overcomplicated. This one is ~90 lines of bash that shows:

- **Model name** (cyan) - Which model you're using
- **🧠 Context %** - How full your context window is (green/orange/red)
- **⏰ Reset time** - When your 5-hour quota resets (local timezone)
- **5h %** - 5-hour rolling quota usage
- **7d %** - 7-day rolling quota usage

The quota percentages are color-coded:
- 🟢 Green: ≤50%
- 🟠 Orange: 51-69%
- 🔴 Red: ≥70%

## Installation

### 1. Copy the script

```bash
mkdir -p ~/.claude/statusline
curl -o ~/.claude/statusline/statusline.sh \
  https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.sh
chmod +x ~/.claude/statusline/statusline.sh
```

### 2. Configure Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline/statusline.sh"
  }
}
```

### 3. Restart Claude Code

The statusline will appear at the bottom of your terminal.

## Requirements

- Claude Code CLI
- `jq` for JSON parsing
- `curl` for API calls
- Bash 4+

## How it works

The script:
1. Receives model/context info from Claude Code via stdin (JSON)
2. Fetches quota data from Anthropic's OAuth API using your credentials
3. Converts UTC reset time to your local timezone
4. Outputs a formatted statusline with ANSI colors

## License

MIT
