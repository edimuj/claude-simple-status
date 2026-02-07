#!/usr/bin/env node
// Postinstall / preuninstall hook for claude-simple-status
// Configures (or removes) the statusLine entry in ~/.claude/settings.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');
const COMMAND = 'claude-simple-status';

function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeSettings(settings) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}

function install() {
  try {
    const settings = readSettings() || {};

    if (settings.statusLine) {
      if (settings.statusLine.command === COMMAND) {
        console.log('claude-simple-status is already configured.');
        return;
      }
      console.log('');
      console.log('Note: statusLine is already configured in ~/.claude/settings.json.');
      console.log('To switch to claude-simple-status, update your settings:');
      console.log('');
      console.log('  "statusLine": {');
      console.log('    "type": "command",');
      console.log(`    "command": "${COMMAND}"`);
      console.log('  }');
      console.log('');
      return;
    }

    settings.statusLine = {
      type: 'command',
      command: COMMAND
    };

    writeSettings(settings);
    console.log('');
    console.log('claude-simple-status installed!');
    console.log('Your statusline will appear at the bottom of Claude Code.');
    console.log('');
  } catch (err) {
    console.log(`Note: Could not auto-configure Claude Code (${err.message}).`);
    console.log('Add this manually to ~/.claude/settings.json:');
    console.log('');
    console.log('  "statusLine": {');
    console.log('    "type": "command",');
    console.log(`    "command": "${COMMAND}"`);
    console.log('  }');
    console.log('');
  }
}

function uninstall() {
  try {
    const settings = readSettings();
    if (!settings || !settings.statusLine) return;
    if (settings.statusLine.command !== COMMAND) return;

    delete settings.statusLine;
    writeSettings(settings);
    console.log('');
    console.log('claude-simple-status removed from Claude Code settings.');
    console.log('');
  } catch {
    // Best-effort cleanup, don't fail the uninstall
  }
}

const action = process.argv[2];
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
