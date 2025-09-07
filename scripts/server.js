#!/usr/bin/env node
// Simple launcher for the game server
const { spawn } = require('child_process');

const proc = spawn('node', ['index.js'], { stdio: 'inherit' });

proc.on('exit', (code) => {
	process.exit(code || 0);
});
