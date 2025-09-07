#!/usr/bin/env node
// Self-play orchestrator Phase 3.2
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const N = parseInt(process.env.BOTS || process.argv[2] || '2', 10);
const TARGET = parseInt(process.env.TARGET_EPISODES || '10', 10);
const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
if (!fs.existsSync(EP_DIR)) fs.mkdirSync(EP_DIR, { recursive: true });

console.log('[selfplay] bots:', N, 'target episodes:', TARGET);

let children = [];
for (let i = 0; i < N; i++) {
	const c = spawn('node', ['scripts/bot.js'], { stdio: 'inherit', env: { ...process.env, BOT_INDEX: String(i) } });
	children.push(c);
}

function shutdown() {
	console.log('[selfplay] target reached, shutting down');
	for (const c of children) c.kill('SIGINT');
	process.exit(0);
}

let count = 0;
const seen = new Set();

const interval = setInterval(() => {
	const files = fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json'));
	for (const f of files) { if (!seen.has(f)) { seen.add(f); count++; console.log('[selfplay] episode detected', f, 'count', count); } }
	if (count >= TARGET) { clearInterval(interval); shutdown(); }
}, 1000);

process.on('SIGINT', () => { clearInterval(interval); shutdown(); });
