import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { colorPct, getFileAge, readJsonFile, toLocalTime, getContextVelocity, getQuotaPressure } from './statusline.mjs';

// ANSI codes for assertions
const GREEN = '\x1b[0;32m';
const ORANGE = '\x1b[0;33m';
const RED = '\x1b[0;31m';
const RESET = '\x1b[0m';

describe('colorPct', () => {
    it('returns green for values <= 50', () => {
        assert.equal(colorPct(0), `${GREEN}0%${RESET}`);
        assert.equal(colorPct(25), `${GREEN}25%${RESET}`);
        assert.equal(colorPct(50), `${GREEN}50%${RESET}`);
    });

    it('returns orange for values 51-69', () => {
        assert.equal(colorPct(51), `${ORANGE}51%${RESET}`);
        assert.equal(colorPct(65), `${ORANGE}65%${RESET}`);
        assert.equal(colorPct(69), `${ORANGE}69%${RESET}`);
    });

    it('returns red for values >= 70', () => {
        assert.equal(colorPct(70), `${RED}70%${RESET}`);
        assert.equal(colorPct(85), `${RED}85%${RESET}`);
        assert.equal(colorPct(100), `${RED}100%${RESET}`);
    });

    it('handles N/A string', () => {
        assert.equal(colorPct('N/A'), 'N/A');
    });

    it('handles non-number non-N/A values', () => {
        assert.equal(colorPct('--'), '--');
        assert.equal(colorPct('?'), '?');
    });

    it('handles NaN', () => {
        assert.equal(colorPct(NaN), `NaN`);
    });

    it('floors fractional values for threshold comparison', () => {
        assert.equal(colorPct(50.9), `${GREEN}50.9%${RESET}`);
        assert.equal(colorPct(69.9), `${ORANGE}69.9%${RESET}`);
    });
});

describe('getFileAge', () => {
    const testFile = join(tmpdir(), `claude-test-age-${process.pid}.tmp`);

    before(() => {
        writeFileSync(testFile, 'test');
    });

    after(() => {
        try { rmSync(testFile); } catch {}
    });

    it('returns age in seconds for existing file', () => {
        const age = getFileAge(testFile);
        assert.ok(typeof age === 'number');
        assert.ok(age >= 0 && age < 5);
    });

    it('returns Infinity for non-existent file', () => {
        assert.equal(getFileAge('/tmp/nonexistent-file-abc123'), Infinity);
    });
});

describe('readJsonFile', () => {
    const testDir = join(tmpdir(), `claude-test-json-${process.pid}`);
    const validFile = join(testDir, 'valid.json');
    const invalidFile = join(testDir, 'invalid.json');

    before(() => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(validFile, JSON.stringify({ foo: 'bar', num: 42 }));
        writeFileSync(invalidFile, 'not json {{{');
    });

    after(() => {
        try { rmSync(testDir, { recursive: true }); } catch {}
    });

    it('parses valid JSON file', () => {
        const result = readJsonFile(validFile);
        assert.deepEqual(result, { foo: 'bar', num: 42 });
    });

    it('returns null for invalid JSON', () => {
        assert.equal(readJsonFile(invalidFile), null);
    });

    it('returns null for non-existent file', () => {
        assert.equal(readJsonFile('/tmp/nonexistent-json-abc123'), null);
    });
});

describe('toLocalTime', () => {
    it('converts UTC ISO string to local HH:mm format', () => {
        const result = toLocalTime('2025-01-15T14:30:00Z');
        assert.match(result, /^\d{2}:\d{2}$/);
    });

    it('returns --:-- for null/undefined', () => {
        assert.equal(toLocalTime(null), '--:--');
        assert.equal(toLocalTime(undefined), '--:--');
    });

    it('returns --:-- for empty string', () => {
        assert.equal(toLocalTime(''), '--:--');
    });

    it('rounds to nearest minute', () => {
        const t1 = toLocalTime('2025-01-15T14:30:29Z');
        const t2 = toLocalTime('2025-01-15T14:30:31Z');
        // 29s rounds down (stays :30), 31s rounds up (goes to :31)
        assert.match(t1, /^\d{2}:30$/);
        assert.match(t2, /^\d{2}:31$/);
    });
});

describe('getContextVelocity', () => {
    const testProject = `/tmp/claude-test-velocity-${process.pid}`;
    const historyFile = join(tmpdir(), 'claude-statusline-context.json');
    let originalHistory;

    before(() => {
        try { originalHistory = readFileSync(historyFile, 'utf8'); } catch { originalHistory = null; }
    });

    beforeEach(() => {
        // Clear test project entries from history
        try {
            const h = JSON.parse(readFileSync(historyFile, 'utf8'));
            delete h[testProject];
            writeFileSync(historyFile, JSON.stringify(h));
        } catch {
            writeFileSync(historyFile, '{}');
        }
    });

    after(() => {
        // Restore original history
        try {
            if (originalHistory !== null) {
                const h = JSON.parse(readFileSync(historyFile, 'utf8'));
                delete h[testProject];
                writeFileSync(historyFile, JSON.stringify(h));
            }
        } catch {}
    });

    it('returns null when no project dir', () => {
        assert.equal(getContextVelocity(null, 50), null);
    });

    it('returns null when context is not a number', () => {
        assert.equal(getContextVelocity(testProject, undefined), null);
    });

    it('returns null with fewer than 5 data points', () => {
        // Simulate 4 turns — not enough
        for (let i = 0; i < 4; i++) {
            const result = getContextVelocity(testProject, 10 + i * 2);
        }
        const result = getContextVelocity(testProject, 18);
        assert.equal(result, null);
    });

    it('returns velocity estimate with enough data points', () => {
        // Simulate 6 increasing readings (each is a "turn")
        for (let i = 0; i < 7; i++) {
            getContextVelocity(testProject, 10 + i * 5);
        }
        const result = getContextVelocity(testProject, 45);
        assert.notEqual(result, null);
        assert.ok(result.arrow, 'should have arrow');
        assert.ok(typeof result.turnsLeft === 'number', 'should have turnsLeft');
        assert.ok(result.turnsLeft > 0, 'should have positive turns left');
    });

    it('resets on compaction (context drops)', () => {
        // Build up history
        for (let i = 0; i < 7; i++) {
            getContextVelocity(testProject, 20 + i * 5);
        }
        // Simulate compaction — context drops significantly
        getContextVelocity(testProject, 10);
        // Should return null — history was reset
        const result = getContextVelocity(testProject, 12);
        assert.equal(result, null);
    });
});

describe('getQuotaPressure', () => {
    const testWindow = `test-${process.pid}`;
    const historyFile = join(tmpdir(), 'claude-statusline-quota-history.json');
    let originalHistory;

    before(() => {
        try { originalHistory = readFileSync(historyFile, 'utf8'); } catch { originalHistory = null; }
    });

    beforeEach(() => {
        try {
            const h = JSON.parse(readFileSync(historyFile, 'utf8'));
            delete h[testWindow];
            writeFileSync(historyFile, JSON.stringify(h));
        } catch {
            writeFileSync(historyFile, '{}');
        }
    });

    after(() => {
        try {
            const h = JSON.parse(readFileSync(historyFile, 'utf8'));
            delete h[testWindow];
            writeFileSync(historyFile, JSON.stringify(h));
        } catch {}
    });

    it('returns null when utilization is not a number', () => {
        assert.equal(getQuotaPressure(testWindow, '?', '2025-01-15T20:00:00Z'), null);
    });

    it('returns null when no reset time', () => {
        assert.equal(getQuotaPressure(testWindow, 50, null), null);
    });

    it('returns null with only one reading', () => {
        const future = new Date(Date.now() + 3600_000).toISOString();
        const result = getQuotaPressure(testWindow, 50, future);
        assert.equal(result, null);
    });

    it('returns null with less than 10 min of data', () => {
        const future = new Date(Date.now() + 3600_000).toISOString();
        // Seed with a reading from 5 min ago (not enough — needs 10 min)
        const h = JSON.parse(readFileSync(historyFile, 'utf8'));
        h[testWindow] = { readings: [{ pct: 40, ts: Date.now() - 5 * 60_000 }] };
        writeFileSync(historyFile, JSON.stringify(h));

        const result = getQuotaPressure(testWindow, 50, future);
        assert.equal(result, null);
    });

    it('returns safe when usage is not growing', () => {
        const future = new Date(Date.now() + 3600_000).toISOString();
        // Seed with two readings at same utilization — function skips duplicate pct values
        const h = JSON.parse(readFileSync(historyFile, 'utf8'));
        h[testWindow] = { readings: [
            { pct: 50, ts: Date.now() - 15 * 60_000 },
            { pct: 50, ts: Date.now() - 5 * 60_000 },
        ] };
        writeFileSync(historyFile, JSON.stringify(h));

        const result = getQuotaPressure(testWindow, 50, future);
        assert.equal(result, 'safe');
    });

    it('returns danger when projected to exhaust before reset', () => {
        const future = new Date(Date.now() + 30 * 60_000).toISOString(); // resets in 30 min
        // Was at 20% fifteen min ago, now at 80% — burning fast
        const h = JSON.parse(readFileSync(historyFile, 'utf8'));
        h[testWindow] = { readings: [{ pct: 20, ts: Date.now() - 15 * 60_000 }] };
        writeFileSync(historyFile, JSON.stringify(h));

        const result = getQuotaPressure(testWindow, 80, future);
        assert.equal(result, 'danger');
    });

    it('returns safe when burn rate is low relative to reset', () => {
        const future = new Date(Date.now() + 4 * 3600_000).toISOString(); // resets in 4 hours
        // Was at 10% fifteen min ago, now at 12% — very slow burn
        const h = JSON.parse(readFileSync(historyFile, 'utf8'));
        h[testWindow] = { readings: [{ pct: 10, ts: Date.now() - 15 * 60_000 }] };
        writeFileSync(historyFile, JSON.stringify(h));

        const result = getQuotaPressure(testWindow, 12, future);
        assert.equal(result, 'safe');
    });

    it('resets history when quota drops (new window)', () => {
        const future = new Date(Date.now() + 3600_000).toISOString();
        // Seed with high reading
        const h = JSON.parse(readFileSync(historyFile, 'utf8'));
        h[testWindow] = { readings: [{ pct: 80, ts: Date.now() - 15 * 60_000 }] };
        writeFileSync(historyFile, JSON.stringify(h));

        // Quota dropped to 10% — new window
        const result = getQuotaPressure(testWindow, 10, future);
        // Should have reset, so only 1 reading = null
        assert.equal(result, null);
    });
});

describe('CLI integration', () => {
    const scriptPath = join(import.meta.dirname, 'statusline.mjs');

    it('produces output for subscription user input', () => {
        const input = JSON.stringify({
            model: { display_name: 'Claude Sonnet 4' },
            context_window: { used_percentage: 42 },
            workspace: { project_dir: '/tmp/test-project' }
        });
        const result = execFileSync(process.execPath, [scriptPath], {
            input,
            encoding: 'utf8',
            timeout: 5000,
        });
        assert.ok(result.includes('TEST-PROJECT'), 'should contain project name');
        assert.ok(result.includes('Claude Sonnet 4'), 'should contain model name');
        assert.ok(result.includes('42%'), 'should contain context percentage');
    });

    it('shows cost for API user (no OAuth token)', () => {
        const input = JSON.stringify({
            model: { display_name: 'Claude Sonnet 4' },
            context_window: { used_percentage: 10 },
            cost: { total_cost_usd: 1.23 },
            workspace: { project_dir: '/tmp/test-project' }
        });
        const result = execFileSync(process.execPath, [scriptPath], {
            input,
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, HOME: '/tmp/nonexistent-home' },
        });
        assert.ok(result.includes('$1.23'), 'should contain cost');
    });

    it('handles empty/minimal input gracefully', () => {
        const result = execFileSync(process.execPath, [scriptPath], {
            input: '{}',
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, HOME: '/tmp/nonexistent-home' },
        });
        assert.ok(result.includes('Unknown'), 'should show Unknown model');
    });

    it('exits 0 on success', () => {
        const result = execFileSync(process.execPath, [scriptPath], {
            input: '{}',
            timeout: 5000,
            env: { ...process.env, HOME: '/tmp/nonexistent-home' },
        });
        // execFileSync throws on non-zero exit, so reaching here = exit 0
        assert.ok(true);
    });
});
