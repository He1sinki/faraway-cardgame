#!/usr/bin/env node
// Orchestrator spawning multiple bot processes for self-play (stub Phase 1.4)
const { spawn } = require('child_process');

const N = parseInt(process.env.BOTS || process.argv[2] || '2', 10);
console.log('[selfplay] spawning', N, 'bots');

const children = [];
for (let i = 0; i < N; i++) {
	const c = spawn('node', ['scripts/bot.js'], { stdio: 'inherit', env: { ...process.env, BOT_INDEX: String(i) } });
	children.push(c);
}

process.on('SIGINT', () => {
	console.log('\n[selfplay] shutting down');
	for (const c of children) c.kill('SIGINT');
	process.exit(0);
});
