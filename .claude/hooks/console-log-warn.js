#!/usr/bin/env node
// PostToolUse hook: warn (never block) when an edit ADDS console.log to shipped game code (game/**/*.js).
// Adapted from Everything Claude Code by Affaan Mustafa (MIT, see ../ECC-LICENSE),
// scripts/hooks/post-edit-console-warn.js, upstream commit 4adeee6.
// Changes: self-contained (no ECC lib), only looks at text added by this edit (not the whole file),
// only game/ files, never reads the disk, never touches the network, always exits 0.
'use strict';

const MAX = 4 * 1024 * 1024;
let raw = '';
let big = false;

function addedText(input) {
  const t = input.tool_input || {};
  if (typeof t.new_string === 'string') return t.new_string;
  if (typeof t.content === 'string') return t.content;
  if (Array.isArray(t.edits)) return t.edits.map(e => (e && typeof e.new_string === 'string' ? e.new_string : '')).join('\n');
  return '';
}

function run(data) {
  const input = JSON.parse(data);
  const file = String((input.tool_input && input.tool_input.file_path) || '').replace(/\\/g, '/');
  if (!/(^|\/)game\/.+\.js$/.test(file)) return null;
  const hits = addedText(input)
    .split('\n')
    .filter(l => /\bconsole\.log\s*\(/.test(l) && !/^\s*\/\//.test(l))
    .slice(0, 5)
    .map(l => '  ' + l.trim().slice(0, 160));
  if (!hits.length) return null;
  return `console.log added to ${file} (shipped game code). Remove it before committing, or use console.warn for a real problem:\n${hits.join('\n')}`;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { if (big) return; raw += c; if (raw.length > MAX) { big = true; raw = ''; } });
process.stdin.on('end', () => {
  try {
    const msg = big ? null : run(raw);
    if (msg) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } }));
    }
  } catch (_) {
    // Bad or unexpected input: stay silent, never break the tool call.
  }
  process.exitCode = 0;
});
