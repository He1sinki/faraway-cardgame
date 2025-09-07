const pino = require('pino');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs', 'raw');
if (!fs.existsSync(LOG_DIR)) {
	fs.mkdirSync(LOG_DIR, { recursive: true });
}

const botId = process.env.BOT_ID || process.env.BOT_INDEX || 'bot';
const stream = pino.destination({
	dest: path.join(LOG_DIR, `bot_${botId}.log`),
	mkdir: true,
	sync: false
});

const logger = pino({
	level: process.env.BOT_LOG_LEVEL || 'info',
	base: null,
	timestamp: () => `,"ts":${Date.now()}`
}, stream);

function logDecision({ gameId, playerId, obsHash, action, policy, value, mask }) {
	logger.info({ scope: 'bot', kind: 'decision', gameId, playerId, obsHash, action, policy, value, mask });
}

function logLifecycle(msg, extra) {
	logger.info({ scope: 'bot', kind: 'lifecycle', msg, ...extra });
}

module.exports = { logger, logDecision, logLifecycle };
