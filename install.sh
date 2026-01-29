#!/bin/bash
# claude-simple-status installer

set -e

SCRIPT_URL="https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.mjs"
INSTALL_DIR="$HOME/.claude/statusline"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Installing claude-simple-status..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Create directory
mkdir -p "$INSTALL_DIR"

# Download script
echo "> Downloading statusline.mjs..."
curl -fsSL "$SCRIPT_URL" -o "$INSTALL_DIR/statusline.mjs"
chmod +x "$INSTALL_DIR/statusline.mjs"

# Check if settings.json exists and has statusLine config
if [[ -f "$SETTINGS_FILE" ]]; then
    if grep -q '"statusLine"' "$SETTINGS_FILE"; then
        echo "> statusLine already configured in settings.json"
        echo "  If you want to use claude-simple-status, update your settings.json:"
        echo ""
        echo '  "statusLine": {'
        echo '    "type": "command",'
        echo '    "command": "node ~/.claude/statusline/statusline.mjs"'
        echo '  }'
    else
        echo "> Adding statusLine to settings.json..."
        # Use jq to add statusLine config (jq is optional)
        if command -v jq &> /dev/null; then
            jq '. + {"statusLine": {"type": "command", "command": "node ~/.claude/statusline/statusline.mjs"}}' \
                "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            echo "  Configuration added"
        else
            echo "  jq not found. Please add manually to $SETTINGS_FILE:"
            echo ""
            echo '  "statusLine": {'
            echo '    "type": "command",'
            echo '    "command": "node ~/.claude/statusline/statusline.mjs"'
            echo '  }'
        fi
    fi
else
    echo "> Creating settings.json..."
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    cat > "$SETTINGS_FILE" << 'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/statusline.mjs"
  }
}
EOF
    echo "  Configuration created"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Restart Claude Code to see your new statusline:"
echo "  Opus 4.5 | 31% | 23:00 | 5h:18% | 7d:10%"
