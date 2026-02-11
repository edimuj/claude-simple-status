#!/usr/bin/env node
// Claude Code Statusline - Shows Branch | Model | Context % | Next Reset | 5h Quota % | 7d Quota %
// Cross-platform Node.js version (no dependencies)

import { readFileSync, writeFileSync, mkdirSync, rmdirSync, statSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, basename } from 'path';
import { spawn, execSync } from 'child_process';

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
    try {
        const data = JSON.parse(input);
        model = data.model?.display_name || 'Unknown';
        contextUsed = data.context_window?.used_percentage || 0;
        if (typeof data.cost?.total_cost_usd === 'number') {
            totalCostUsd = data.cost.total_cost_usd;
        }
        if (data.workspace?.project_dir) {
            projectName = basename(data.workspace.project_dir).toUpperCase();
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
            resetLocal = toLocalTime(quotaData.five_hour?.resets_at);
        }
    }

    // Check for error state
    let hasError = false;
    try {
        const errContent = readFileSync(ERROR_FILE, 'utf8').trim();
        hasError = errContent.length > 0;
    } catch {}

    // Get rig profile (claude-rig sets CLAUDE_CONFIG_DIR to ~/.claude-rig/profiles/<name>)
    const rigProfile = (() => {
        const configDir = process.env.CLAUDE_CONFIG_DIR;
        if (!configDir) return null;
        const match = configDir.match(/\.claude-rig\/profiles\/([^/]+)\/?$/);
        return match ? match[1] : null;
    })();

    // Get git branch
    const branch = getGitBranch();

    // Build output
    const projectSegment = projectName
        ? `${WHITE_BOLD}${projectName}${branch ? ` ${YELLOW_BOLD}[${branch}]` : ''}${RESET}`
        : (branch ? `${YELLOW_BOLD}${branch}${RESET}` : '');
    let output = `${projectSegment ? `${projectSegment} | ` : ''}${rigProfile ? `${MAGENTA_BOLD}${rigProfile}${RESET} | ` : ''}${CYAN}${model}${RESET} | ${colorPct(contextUsed)}`;
    if (token) {
        output += ` | ${resetLocal} | 5h:${colorPct(fiveHourPct)} | 7d:${colorPct(sevenDayPct)}`;
        if (hasError) {
            output += ` | ${RED}ERR${RESET}`;
        }
    } else if (totalCostUsd !== null) {
        output += ` | ${GREEN}$${totalCostUsd.toFixed(2)}${RESET}`;
    }

    process.stdout.write(output);
}

main().catch(() => process.exit(1));
