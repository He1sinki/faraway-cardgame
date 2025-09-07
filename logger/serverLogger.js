const pino = require('pino');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs', 'raw');
if (!fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

const stream = pino.destination({
	dest: path.join(LOG_DIR, 'server.log'),
	mkdir: true,
	sync: false
});

const logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	base: null, // remove pid, hostname for lean logs
	timestamp: () => `,"ts":${Date.now()}`
}, stream);

function logEvent({ scope, gameId, playerId, action, phase, payload, level = 'info', latencyMs }) {
	const line = {
		scope: scope || 'server',
		gameId: gameId || null,
		playerId: playerId || null,
		action: action || null,
		phase: phase || null,
		latencyMs: latencyMs || null,
		payload: payload === undefined ? null : payload
	};
	logger[level](line);
}

module.exports = { logger, logEvent };
