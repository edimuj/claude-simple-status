#!/usr/bin/env node
// Claude Code Statusline - Shows Branch | Model | Context % | Next Reset | 5h Quota % | 7d Quota %
// Cross-platform Node.js version (no dependencies)

import { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync, existsSync, realpathSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, basename } from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Handle --uninstall flag (workaround: npm doesn't run preuninstall for global packages)
if (process.argv.includes('--uninstall')) {
    const settingsFile = join(homedir(), '.claude', 'settings.json');
    try {
        const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
        if (settings.statusLine?.command === 'claude-simple-status') {
            delete settings.statusLine;
            writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
            console.log('claude-simple-status removed from Claude Code settings.');
        } else {
            console.log('Nothing to remove (statusLine not managed by claude-simple-status).');
        }
    } catch {
        console.log('Nothing to remove (~/.claude/settings.json not found).');
    }
    process.exit(0);
}

// ANSI color codes
const GREEN = '\x1b[0;32m';
const ORANGE = '\x1b[0;33m';
const RED = '\x1b[0;31m';
const CYAN = '\x1b[0;36m';
const WHITE_BOLD = '\x1b[1;37m';
const MAGENTA_BOLD = '\x1b[1;35m';
const YELLOW_BOLD = '\x1b[1;33m';
const RESET = '\x1b[0m';

// File paths
const CREDS_FILE = join(homedir(), '.claude', '.credentials.json');
const CACHE_FILE = join(tmpdir(), 'claude-statusline-quota.json');
const LOCK_DIR = join(tmpdir(), 'claude-statusline-quota.lock');
const ERROR_FILE = join(tmpdir(), 'claude-statusline-error');
const LOG_FILE = join(tmpdir(), 'claude-statusline.log');
const CACHE_MAX_AGE = 120; // seconds - when to fetch
const CACHE_STALE_AGE = 300; // seconds - when to show "--" instead of old values
const GIT_BRANCH_CACHE = join(tmpdir(), 'claude-statusline-branches.json');
const GIT_BRANCH_MAX_AGE = 30; // seconds
const CONTEXT_HISTORY_FILE = join(tmpdir(), 'claude-statusline-context.json');
const CONTEXT_COMPACT_THRESHOLD = 83; // % at which autocompact typically fires
const CONTEXT_MAX_SAMPLES = 20; // rolling window of turn deltas
const QUOTA_HISTORY_FILE = join(tmpdir(), 'claude-statusline-quota-history.json');
const QUOTA_MAX_READINGS = 30; // ~1h of data at 120s refresh intervals

// Color a percentage value based on thresholds
function colorPct(val) {
    if (typeof val !== 'number' || isNaN(val)) {
        return val === 'N/A' ? 'N/A' : `${val}`;
    }
    const intVal = Math.floor(val);
    if (intVal <= 50) return `${GREEN}${val}%${RESET}`;
    if (intVal <= 69) return `${ORANGE}${val}%${RESET}`;
    return `${RED}${val}%${RESET}`;
}

// Get file age in seconds
function getFileAge(filepath) {
    try {
        const stats = statSync(filepath);
        return Math.floor((Date.now() - stats.mtimeMs) / 1000);
    } catch {
        return Infinity;
    }
}

// Read JSON file safely
function readJsonFile(filepath) {
    try {
        return JSON.parse(readFileSync(filepath, 'utf8'));
    } catch {
        return null;
    }
}

// User config — features off by default, opt-in via ~/.config/claude-simple-status.json
const CONFIG_FILE = join(homedir(), '.config', 'claude-simple-status.json');
const userConfig = readJsonFile(CONFIG_FILE) || {};
const SHOW_CONTEXT_VELOCITY = userConfig.contextVelocity === true;
const SHOW_BURN_RATE = userConfig.quotaBurnRate === true;

// Clean up stale lock (older than 30s)
function cleanStaleLock() {
    if (existsSync(LOCK_DIR) && getFileAge(LOCK_DIR) > 30) {
        try { rmdirSync(LOCK_DIR); } catch {}
    }
}

// Acquire lock atomically (mkdir fails if exists)
function acquireLock() {
    try {
        mkdirSync(LOCK_DIR);
        return true;
    } catch {
        return false;
    }
}

// Spawn background refresh process
function refreshInBackground(token) {
    const child = spawn(process.execPath, [
        '-e',
        `
        const { mkdirSync, rmdirSync, writeFileSync, readFileSync, appendFileSync } = require('fs');
        const { request } = require('https');
        const CACHE_FILE = ${JSON.stringify(CACHE_FILE)};
        const LOCK_DIR = ${JSON.stringify(LOCK_DIR)};
        const ERROR_FILE = ${JSON.stringify(ERROR_FILE)};
        const LOG_FILE = ${JSON.stringify(LOG_FILE)};

        function logError(msg) {
            const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
            try {
                appendFileSync(LOG_FILE, '[' + ts + '] ' + msg + '\\n');
                writeFileSync(ERROR_FILE, msg);
                const lines = readFileSync(LOG_FILE, 'utf8').split('\\n').filter(Boolean);
                if (lines.length > 50) writeFileSync(LOG_FILE, lines.slice(-50).join('\\n') + '\\n');
            } catch {}
        }

        const req = request({
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ${token}',
                'anthropic-beta': 'oauth-2025-04-20',
                'Accept': 'application/json',
                'User-Agent': 'claude-code/2.1.12'
            },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        JSON.parse(data);
                        writeFileSync(CACHE_FILE, data);
                        try { writeFileSync(ERROR_FILE, ''); } catch {}
                    } catch { logError('Invalid JSON'); }
                } else if (res.statusCode !== 401) {
                    // Skip 401 - token not ready yet at startup, will retry next cycle
                    logError('HTTP ' + res.statusCode);
                }
                try { rmdirSync(LOCK_DIR); } catch {}
            });
        });
        req.on('error', () => { logError('Connection failed'); try { rmdirSync(LOCK_DIR); } catch {} });
        req.on('timeout', () => { req.destroy(); logError('Timeout'); try { rmdirSync(LOCK_DIR); } catch {} });
        req.end();
        `
    ], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

// Convert UTC ISO time to local HH:mm
function toLocalTime(isoString) {
    if (!isoString) return '--:--';
    try {
        const date = new Date(isoString);
        // Round to nearest minute
        date.setSeconds(date.getSeconds() + 30);
        return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '--:--';
    }
}

// Get current git branch name (cached per cwd, 30s TTL)
function getGitBranch() {
    const cwd = process.cwd();
    try {
        const cache = readJsonFile(GIT_BRANCH_CACHE) || {};
        const entry = cache[cwd];
        if (entry && (Date.now() - entry.ts) < GIT_BRANCH_MAX_AGE * 1000) {
            return entry.branch;
        }
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            timeout: 1000,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        cache[cwd] = { branch, ts: Date.now() };
        try { writeFileSync(GIT_BRANCH_CACHE, JSON.stringify(cache)); } catch {}
        return branch;
    } catch {
        return null;
    }
}

// Track context % over time and estimate remaining turns until compaction
// Returns { arrow, turnsLeft } or null if not enough data
function getContextVelocity(projectDir, contextUsed) {
    if (!projectDir || typeof contextUsed !== 'number') return null;

    const now = Date.now();
    const history = readJsonFile(CONTEXT_HISTORY_FILE) || {};
    const entry = history[projectDir] || { readings: [], deltas: [] };

    // Append current reading
    const last = entry.readings[entry.readings.length - 1];
    entry.readings.push({ pct: contextUsed, ts: now });

    // Detect a new "turn": context jumped since last reading
    // (statusline is polled every ~2s, but context only changes between turns)
    if (last && contextUsed > last.pct) {
        const delta = contextUsed - last.pct;
        // Ignore tiny noise (<0.1%) and impossibly large jumps (>30% = probably a new session)
        if (delta >= 0.1 && delta <= 30) {
            entry.deltas.push(delta);
            if (entry.deltas.length > CONTEXT_MAX_SAMPLES) {
                entry.deltas = entry.deltas.slice(-CONTEXT_MAX_SAMPLES);
            }
        }
    }

    // Context went down = compaction happened or new session, reset tracking
    if (last && contextUsed < last.pct - 1) {
        entry.readings = [{ pct: contextUsed, ts: now }];
        entry.deltas = [];
    }

    // Keep only last 2 readings (we just need prev + current to detect jumps)
    if (entry.readings.length > 2) {
        entry.readings = entry.readings.slice(-2);
    }

    history[projectDir] = entry;
    try { writeFileSync(CONTEXT_HISTORY_FILE, JSON.stringify(history)); } catch {}

    // Need at least 5 turn deltas to estimate — fewer gives noisy results
    // (especially right after compaction when early turns inflate context quickly)
    if (entry.deltas.length < 5) return null;

    // Weighted average: recent deltas matter more
    let weightSum = 0;
    let deltaSum = 0;
    for (let i = 0; i < entry.deltas.length; i++) {
        const weight = i + 1; // linear: older=1, newest=N
        deltaSum += entry.deltas[i] * weight;
        weightSum += weight;
    }
    const avgDelta = deltaSum / weightSum;

    const remaining = CONTEXT_COMPACT_THRESHOLD - contextUsed;
    if (remaining <= 0 || avgDelta <= 0) return { arrow: '\u2191', turnsLeft: 0 };

    const turnsLeft = Math.round(remaining / avgDelta);

    // Arrow based on trend (last 3 deltas vs overall average)
    const recentSlice = entry.deltas.slice(-3);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;
    let arrow;
    if (recentAvg > avgDelta * 1.3) arrow = '\u2191'; // accelerating ↑
    else if (recentAvg < avgDelta * 0.7) arrow = '\u2193'; // decelerating ↓
    else arrow = '\u2192'; // steady →

    return { arrow, turnsLeft };
}

// Predict whether quota will be exhausted before the reset window
// windowKey: '5h' or '7d' — used to track readings separately
// Returns 'safe' | 'tight' | 'danger' | null
function getQuotaPressure(windowKey, utilization, resetsAtIso) {
    if (typeof utilization !== 'number' || !resetsAtIso) return null;

    const now = Date.now();
    const resetsAt = new Date(resetsAtIso).getTime();
    const msUntilReset = resetsAt - now;
    if (msUntilReset <= 0) return null; // reset imminent, no point predicting

    const allHistory = readJsonFile(QUOTA_HISTORY_FILE) || {};
    const history = allHistory[windowKey] || { readings: [] };

    // Record new reading if quota changed (API refreshes every ~120s)
    const last = history.readings[history.readings.length - 1];
    if (!last || last.pct !== utilization) {
        history.readings.push({ pct: utilization, ts: now });
        if (history.readings.length > QUOTA_MAX_READINGS) {
            history.readings = history.readings.slice(-QUOTA_MAX_READINGS);
        }
    }

    // Quota dropped = new window started, reset history
    if (last && utilization < last.pct - 5) {
        history.readings = [{ pct: utilization, ts: now }];
    }

    allHistory[windowKey] = history;
    try { writeFileSync(QUOTA_HISTORY_FILE, JSON.stringify(allHistory)); } catch {}

    // Need at least 2 distinct readings to compute rate
    if (history.readings.length < 2) return null;

    const oldest = history.readings[0];
    const elapsedMs = now - oldest.ts;
    if (elapsedMs < 600_000) return null; // need at least 10 min of data to avoid noisy early-window spikes

    const pctGained = utilization - oldest.pct;
    if (pctGained <= 0) return 'safe'; // not growing

    // % per millisecond → extrapolate time to 100%
    const rate = pctGained / elapsedMs;
    const pctRemaining = 100 - utilization;
    const msTo100 = pctRemaining / rate;

    // Compare projected exhaustion time to reset time
    const exhaustsAt = now + msTo100;
    const bufferMs = 30 * 60_000; // 30 min buffer for "tight"

    if (exhaustsAt < resetsAt) return 'danger';          // will hit limit before reset
    if (exhaustsAt < resetsAt + bufferMs) return 'tight'; // cutting it close
    return 'safe';
}

// Main
async function main() {
    // Read stdin
    let input = '';
    for await (const chunk of process.stdin) {
        input += chunk;
    }

    // Parse Claude Code input
    let model = 'Unknown';
    let contextUsed = 0;
    let totalCostUsd = null;
    let projectName = null;
    let projectDir = null;
    try {
        const data = JSON.parse(input);
        model = data.model?.display_name || 'Unknown';
        contextUsed = data.context_window?.used_percentage || 0;
        if (typeof data.cost?.total_cost_usd === 'number') {
            totalCostUsd = data.cost.total_cost_usd;
        }
        if (data.workspace?.project_dir) {
            projectDir = data.workspace.project_dir;
            projectName = basename(projectDir).toUpperCase();
        }
    } catch {}

    // Get OAuth token
    let token = null;
    const creds = readJsonFile(CREDS_FILE);
    if (creds?.claudeAiOauth?.accessToken) {
        token = creds.claudeAiOauth.accessToken;
    }

    // Read cached quota data (never block on fetch)
    let quotaData = readJsonFile(CACHE_FILE);

    // Check if refresh needed and spawn background fetch
    if (token) {
        cleanStaleLock();
        const cacheAge = getFileAge(CACHE_FILE);
        const needRefresh = !quotaData || cacheAge >= CACHE_MAX_AGE;

        if (needRefresh && acquireLock()) {
            refreshInBackground(token);
        }
    }

    // Parse quota data (show "--" if cache is too stale)
    let fiveHourPct = '?';
    let sevenDayPct = '?';
    let resetLocal = '--:--';
    let fiveHourResetsAt = null;
    let sevenDayResetsAt = null;
    const cacheIsStale = !quotaData || getFileAge(CACHE_FILE) > CACHE_STALE_AGE;

    if (cacheIsStale) {
        fiveHourPct = '--';
        sevenDayPct = '--';
        resetLocal = '--:--';
    } else if (quotaData) {
        if (quotaData.five_hour === null || quotaData.seven_day === null) {
            // Organization/team plan without individual quota
            fiveHourPct = 'N/A';
            sevenDayPct = 'N/A';
            resetLocal = 'N/A';
        } else {
            fiveHourPct = quotaData.five_hour?.utilization ?? '?';
            sevenDayPct = quotaData.seven_day?.utilization ?? '?';
            fiveHourResetsAt = quotaData.five_hour?.resets_at;
            sevenDayResetsAt = quotaData.seven_day?.resets_at;
            resetLocal = toLocalTime(fiveHourResetsAt);
        }
    }

    // Check for error state
    let hasError = false;
    try {
        const errContent = readFileSync(ERROR_FILE, 'utf8').trim();
        hasError = errContent.length > 0;
    } catch {}

    // Get context velocity estimate (opt-in)
    const velocity = SHOW_CONTEXT_VELOCITY ? getContextVelocity(projectDir, contextUsed) : null;

    // Get rig name (claude-rig sets CLAUDE_CONFIG_DIR to ~/.claude-rig/rigs/<name>)
    const rigProfile = (() => {
        const configDir = process.env.CLAUDE_CONFIG_DIR;
        if (!configDir) return null;
        const match = configDir.match(/\.claude-rig\/rigs\/([^/]+)\/?$/);
        return match ? match[1] : null;
    })();

    // Get git branch
    const branch = getGitBranch();

    // Build output
    const projectSegment = projectName
        ? `${WHITE_BOLD}${projectName}${branch ? ` ${YELLOW_BOLD}[${branch}]` : ''}${RESET}`
        : (branch ? `${YELLOW_BOLD}${branch}${RESET}` : '');
    // Format velocity: "42% →~8t" or just "42%" if not enough data yet
    let contextDisplay = colorPct(contextUsed);
    if (velocity) {
        const turnsStr = velocity.turnsLeft === 0 ? '!' : `~${velocity.turnsLeft}t`;
        const turnsColor = velocity.turnsLeft <= 5 ? RED : velocity.turnsLeft <= 15 ? ORANGE : GREEN;
        contextDisplay += ` ${turnsColor}${velocity.arrow}${turnsStr}${RESET}`;
    }

    // Color the reset time based on 5h quota burn rate projection (opt-in)
    const fiveHourPressure = SHOW_BURN_RATE ? getQuotaPressure('5h', fiveHourPct, fiveHourResetsAt) : null;
    let resetDisplay = resetLocal;
    if (fiveHourPressure === 'danger') resetDisplay = `${RED}${resetLocal}${RESET}`;
    else if (fiveHourPressure === 'tight') resetDisplay = `${ORANGE}${resetLocal}${RESET}`;
    else if (fiveHourPressure === 'safe') resetDisplay = `${GREEN}${resetLocal}${RESET}`;

    // Override 7d percentage color when burn rate projects exhaustion before reset (opt-in)
    const sevenDayPressure = SHOW_BURN_RATE ? getQuotaPressure('7d', sevenDayPct, sevenDayResetsAt) : null;
    let sevenDayDisplay = colorPct(sevenDayPct);
    if (sevenDayPressure === 'danger') sevenDayDisplay = `${RED}${sevenDayPct}%${RESET}`;
    else if (sevenDayPressure === 'tight') sevenDayDisplay = `${ORANGE}${sevenDayPct}%${RESET}`;

    let output = `${projectSegment ? `${projectSegment} | ` : ''}${rigProfile ? `${MAGENTA_BOLD}${rigProfile}${RESET} | ` : ''}${CYAN}${model}${RESET} | ${contextDisplay}`;
    if (token) {
        output += ` | ${resetDisplay} | 5h:${colorPct(fiveHourPct)} | 7d:${sevenDayDisplay}`;
        if (hasError) {
            output += ` | ${RED}ERR${RESET}`;
        }
    } else if (totalCostUsd !== null) {
        output += ` | ${GREEN}$${totalCostUsd.toFixed(2)}${RESET}`;
    }

    process.stdout.write(output);
}

// Only run when executed directly (not imported for testing)
const __filename = fileURLToPath(import.meta.url);
const _isMain = (() => {
    try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename); }
    catch { return false; }
})();
if (_isMain) main().catch(() => process.exit(1));

export { colorPct, getFileAge, readJsonFile, toLocalTime, getContextVelocity, getQuotaPressure, main };
