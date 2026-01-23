#!/bin/bash
# claude-simple-status installer

set -e

SCRIPT_URL="https://raw.githubusercontent.com/edimuj/claude-simple-status/main/statusline.sh"
INSTALL_DIR="$HOME/.claude/statusline"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Installing claude-simple-status..."

# Create directory
mkdir -p "$INSTALL_DIR"

# Download script
echo "→ Downloading statusline.sh..."
curl -fsSL "$SCRIPT_URL" -o "$INSTALL_DIR/statusline.sh"
chmod +x "$INSTALL_DIR/statusline.sh"

# Check if settings.json exists and has statusLine config
if [[ -f "$SETTINGS_FILE" ]]; then
    if grep -q '"statusLine"' "$SETTINGS_FILE"; then
        echo "→ statusLine already configured in settings.json"
        echo "  If you want to use claude-simple-status, update your settings.json:"
        echo ""
        echo '  "statusLine": {'
        echo '    "type": "command",'
        echo '    "command": "bash ~/.claude/statusline/statusline.sh"'
        echo '  }'
    else
        echo "→ Adding statusLine to settings.json..."
        # Use jq to add statusLine config
        if command -v jq &> /dev/null; then
            jq '. + {"statusLine": {"type": "command", "command": "bash ~/.claude/statusline/statusline.sh"}}' \
                "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            echo "✓ Configuration added"
        else
            echo "  jq not found. Please add manually to $SETTINGS_FILE:"
            echo ""
            echo '  "statusLine": {'
            echo '    "type": "command",'
            echo '    "command": "bash ~/.claude/statusline/statusline.sh"'
            echo '  }'
        fi
    fi
else
    echo "→ Creating settings.json..."
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    cat > "$SETTINGS_FILE" << 'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline/statusline.sh"
  }
}
EOF
    echo "✓ Configuration created"
fi

echo ""
echo "✓ Installation complete!"
echo ""
echo "Restart Claude Code to see your new statusline:"
echo "  Opus 4.5 | 🧠  31% | ⏰ 23:00 | 5h:18% | 7d:10%"
