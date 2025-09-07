#!/usr/bin/env node
// Bot RL Phase 3.1 - collecte de trajectoires basiques (random policy)

const { io } = require('socket.io-client');
const { featurize } = require('../dataset/featurize');
const { EpisodeWriter } = require('../dataset/episode_writer');
const { logLifecycle, logDecision } = require('../logger/botLogger');
const { fnv1a } = require('../dataset/util_hash');
const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const BOT_ID = process.env.BOT_ID || process.env.BOT_INDEX || 'bot';
const EPISODE_DIR = path.join(process.cwd(), 'dataset', 'episodes');

const socket = io(SERVER_URL, { reconnection: true });
let lastUpdate = null;
let currentGame = null;
let writer = null;
let lastScore = 0; // pour reward différentiel (simplifié)

function pickAction(state, playerId) {
	const player = state.players?.[playerId];
	if (!player) return null;
	if (state.phase === 'play') {
		// Random card from hand
		if (player.hand.length) return { type: 'playCard', card: player.hand[Math.floor(Math.random() * player.hand.length)] };
	} else if (state.phase === 'shop' && player.hasToChoose) {
		if (state.shop?.length) return { type: 'shopChooseCard', card: state.shop[Math.floor(Math.random() * state.shop.length)] };
	} else if (state.phase === 'sanctuary' && player.hasToChoose) {
		if (player.sanctuaryChoose?.length) return { type: 'sanctuaryChoose', card: player.sanctuaryChoose[0] };
	}
	return null;
}

socket.on('connect', () => {
	logLifecycle('connected', { socketId: socket.id });
	socket.emit('getRooms');
});

socket.on('rooms', (rooms) => {
	const existing = Object.keys(rooms).find(r => rooms[r].users && rooms[r].users.length < 4 && !rooms[r].state);
	if (existing) socket.emit('joinRoom', existing); else socket.emit('createRoom');
});

socket.on('joinedRoom', (id) => logLifecycle('room_created', { room: id }));

socket.on('roomJoined', (state) => {
	logLifecycle('room_joined', { users: state.users.length, roomId: state.roomId });
	if (state.users.length >= 2) setTimeout(() => socket.emit('startGame', state.roomId), 300);
});

socket.on('beginGame', (info) => {
	currentGame = info.gameId || currentGame || 'unknown';
	writer = new EpisodeWriter({ dir: EPISODE_DIR, gameId: currentGame, playerId: socket.id });
	lastScore = 0;
	logLifecycle('game_begin', { gameId: currentGame });
});

socket.on('update', (st) => {
	lastUpdate = st;
	socket.emit('updateAck', { stateSeq: st.stateSeq, clientTime: Date.now() });
	if (!writer) return; // game not initialized fully yet

	const { vector, mask } = featurize(st, socket.id);
	const obsHash = fnv1a(vector);
	const actionObj = pickAction(st, socket.id);
	let actionTaken = null;
	if (actionObj) {
		actionTaken = actionObj.card;
		if (actionObj.type === 'playCard') socket.emit('playCard', actionObj.card);
		if (actionObj.type === 'shopChooseCard') socket.emit('shopChooseCard', actionObj.card);
		if (actionObj.type === 'sanctuaryChoose') socket.emit('sanctuaryChoose', actionObj.card);
	}

	logDecision({ gameId: currentGame, playerId: socket.id, obsHash, action: actionTaken, policy: 'random', value: null, mask });
	// Reward shaping léger: +0.01 * (tour normalisé) quand une action play est posée
	let shaping = 0;
	if (actionObj && st.phase === 'play') shaping = (st.turn || 0) / 8 * 0.01;
	writer.add({ obs: vector, mask, action: actionTaken, reward: shaping, done: false, info: { seq: st.stateSeq, phase: st.phase, obsHash, rawState: st } });
});

socket.on('disconnect', () => logLifecycle('disconnected', {}));

// On va intercepter fin de partie via update contenant phase end + scores
const END_CHECK_INTERVAL = setInterval(() => {
	if (lastUpdate && lastUpdate.phase === 'end' && writer) {
		// Calcul reward final: différence de score vs moyenne (baseline simple)
		const meScoreObj = lastUpdate.score?.find((s, idx) => lastUpdate.users[idx] === socket.id);
		let finalReward = 0;
		if (meScoreObj?.total !== undefined) {
			const allScores = lastUpdate.score.map(s => s.total);
			const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
			finalReward = meScoreObj.total - avg;
		}
		// Marquer dernier step comme done + reward final, sinon ajouter un step terminal vide
		if (writer.buffer.length) {
			writer.buffer[writer.buffer.length - 1].reward += finalReward; // ajoute reward final
			writer.buffer[writer.buffer.length - 1].done = true;
		} else {
			writer.add({ obs: [], mask: [], action: null, reward: finalReward, done: true, info: { terminal: true } });
		}
		const file = writer.close({ finalReward });
		logLifecycle('episode_closed', { file, finalReward });
		writer = null; currentGame = null; lastUpdate = null; lastScore = 0;
	}
}, 500);

process.on('SIGINT', () => { clearInterval(END_CHECK_INTERVAL); process.exit(0); });
