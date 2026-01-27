#!/bin/bash
# Claude Code Statusline - Shows Model | Context % | Next Reset | 5h Quota % | 7d Quota %

# Redirect all stderr to /dev/null to prevent any stray output
exec 2>/dev/null

# ANSI color codes - raw escape sequences
GREEN="\033[0;32m"
ORANGE="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

# Color a percentage value based on thresholds
color_pct() {
    local val="$1"
    # Handle non-numeric values
    if [[ ! "$val" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        echo -n "$val"
        return
    fi

    local int_val=${val%.*}  # Remove decimal
    if (( int_val <= 50 )); then
        echo -n -e "${GREEN}${val}%${RESET}"
    elif (( int_val <= 69 )); then
        echo -n -e "${ORANGE}${val}%${RESET}"
    else
        echo -n -e "${RED}${val}%${RESET}"
    fi
}

# Read stdin (JSON from Claude Code)
INPUT=$(cat)

# Extract model and context from Claude Code input
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Unknown"')
CONTEXT_USED=$(echo "$INPUT" | jq -r '.context_window.used_percentage // 0')

# Get OAuth token
CREDS_FILE="$HOME/.claude/.credentials.json"
if [[ -f "$CREDS_FILE" ]]; then
    TOKEN=$(jq -r '.claudeAiOauth.accessToken // empty' "$CREDS_FILE" 2>/dev/null)
fi

# Fetch quota data from API (async with 2-minute cache)
CACHE_FILE="/tmp/claude-statusline-quota.json"
LOCK_FILE="/tmp/claude-statusline-quota.lock"
ERROR_FILE="/tmp/claude-statusline-error"
LOG_FILE="/tmp/claude-statusline.log"
CACHE_MAX_AGE=120  # seconds
QUOTA_DATA=""

if [[ -n "$TOKEN" ]]; then
    # Always read cache first (even if stale) so we never block
    if [[ -f "$CACHE_FILE" ]]; then
        QUOTA_DATA=$(cat "$CACHE_FILE")
    fi

    # Check if cache needs refreshing
    NEED_REFRESH=false
    if [[ ! -f "$CACHE_FILE" ]]; then
        NEED_REFRESH=true
    else
        CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) ))
        if (( CACHE_AGE >= CACHE_MAX_AGE )); then
            NEED_REFRESH=true
        fi
    fi

    # Refresh in background (skip if another fetch is already running)
    if $NEED_REFRESH && ! [[ -f "$LOCK_FILE" ]]; then
        (
            touch "$LOCK_FILE"
            HTTP_CODE=$(curl -s --max-time 10 -w "%{http_code}" -o /tmp/claude-statusline-resp.json \
                "https://api.anthropic.com/api/oauth/usage" \
                -H "Authorization: Bearer $TOKEN" \
                -H "anthropic-beta: oauth-2025-04-20" \
                -H "Accept: application/json" \
                -H "User-Agent: claude-code/2.1.12" 2>/dev/null)
            FRESH=$(cat /tmp/claude-statusline-resp.json 2>/dev/null)
            rm -f /tmp/claude-statusline-resp.json

            if [[ "$HTTP_CODE" == "200" && -n "$FRESH" && "$FRESH" != *"error"* ]]; then
                echo "$FRESH" > "$CACHE_FILE"
                rm -f "$ERROR_FILE"
            else
                # Log the error with timestamp
                TS=$(date "+%Y-%m-%d %H:%M:%S")
                if [[ -z "$FRESH" || "$HTTP_CODE" == "000" ]]; then
                    ERR_MSG="Timeout or connection failure"
                elif [[ "$HTTP_CODE" != "200" ]]; then
                    ERR_MSG="HTTP $HTTP_CODE"
                else
                    ERR_MSG="Invalid response"
                fi
                echo "[$TS] $ERR_MSG" >> "$LOG_FILE"
                echo "$ERR_MSG" > "$ERROR_FILE"
                # Keep log from growing unbounded (last 50 lines)
                if [[ $(wc -l < "$LOG_FILE") -gt 50 ]]; then
                    tail -50 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
                fi
            fi
            rm -f "$LOCK_FILE"
        ) &
        disown
    fi
fi

# Check for recent error state
QUOTA_ERR=""
if [[ -f "$ERROR_FILE" ]]; then
    QUOTA_ERR=$(cat "$ERROR_FILE")
fi

# Parse quota data
if [[ -n "$QUOTA_DATA" && "$QUOTA_DATA" != *"error"* ]]; then
    # Check if five_hour and seven_day are null (organization accounts may not have quota)
    FIVE_HOUR_RAW=$(echo "$QUOTA_DATA" | jq -r '.five_hour')
    SEVEN_DAY_RAW=$(echo "$QUOTA_DATA" | jq -r '.seven_day')

    if [[ "$FIVE_HOUR_RAW" == "null" || "$SEVEN_DAY_RAW" == "null" ]]; then
        # Organization/team plan without individual quota tracking
        FIVE_HOUR_PCT="N/A"
        SEVEN_DAY_PCT="N/A"
        RESET_LOCAL="N/A"
    else
        FIVE_HOUR_PCT=$(echo "$QUOTA_DATA" | jq -r '.five_hour.utilization // 0')
        SEVEN_DAY_PCT=$(echo "$QUOTA_DATA" | jq -r '.seven_day.utilization // 0')
        RESET_TIME=$(echo "$QUOTA_DATA" | jq -r '.five_hour.resets_at // empty')

        # Convert reset time to local HH:mm (API returns UTC with +00:00)
        if [[ -n "$RESET_TIME" ]]; then
            # Strip fractional seconds: 2026-01-23T22:00:00.169802+00:00 -> 2026-01-23T22:00:00
            UTC_TIME="${RESET_TIME%%.*}"
            # macOS: Parse as UTC, convert to epoch, then to local time
            if EPOCH=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$UTC_TIME" "+%s" 2>/dev/null); then
                # Round to nearest minute (add 30 seconds before truncating)
                EPOCH=$((EPOCH + 30))
                RESET_LOCAL=$(date -j -f "%s" "$EPOCH" "+%H:%M" 2>/dev/null)
            else
                # Linux/GNU date fallback - handles ISO 8601 with timezone natively
                RESET_LOCAL=$(date -d "$RESET_TIME + 30 seconds" "+%H:%M" 2>/dev/null)
            fi
            [[ -z "$RESET_LOCAL" ]] && RESET_LOCAL="--:--"
        else
            RESET_LOCAL="--:--"
        fi
    fi
else
    FIVE_HOUR_PCT="?"
    SEVEN_DAY_PCT="?"
    RESET_LOCAL="--:--"
fi

# Build colored percentages
CTX_COLORED=$(color_pct "$CONTEXT_USED")
FIVE_COLORED=$(color_pct "$FIVE_HOUR_PCT")
SEVEN_COLORED=$(color_pct "$SEVEN_DAY_PCT")

# Output: Model | % | HH:mm | 5h % | 7d % [| ERR]
OUTPUT="${CYAN}${MODEL}${RESET} | ${CTX_COLORED} | ${RESET_LOCAL} | 5h:${FIVE_COLORED} | 7d:${SEVEN_COLORED}"
if [[ -n "$QUOTA_ERR" ]]; then
    OUTPUT="${OUTPUT} | ${RED}ERR${RESET}"
fi
echo -n -e "$OUTPUT"
