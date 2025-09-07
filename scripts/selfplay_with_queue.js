#!/usr/bin/env node
// Wrapper pour lancer consumer + selfplay avec propagation des arguments à selfplay uniquement.
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const consumer = spawn('node', ['dataset/queue/queue_consumer.js'], { stdio: 'inherit' });
const selfplay = spawn('node', ['scripts/selfplay.js', ...args], { stdio: 'inherit' });

function shutdown() {
	try { consumer.kill('SIGINT'); } catch { }
	try { selfplay.kill('SIGINT'); } catch { }
	setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
selfplay.on('exit', (code) => { shutdown(); process.exit(code); });
