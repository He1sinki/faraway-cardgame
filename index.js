// Faraway Card Game Server (refactored with instrumentation Phase 2.4)
const app = require('express')();
const { logEvent } = require('./logger/serverLogger');
const server = require('http').createServer(app);
const { Server } = require('socket.io');
const port = process.env.PORT || 8080;

const { regions, sanctuaries } = require('./class/cards.js');

const io = new Server(server, { cors: { origin: 'http://localhost:5173', credentials: true } });

function generateId() { return Math.random().toString(36).substring(2, 7); }

const PROTOCOL_VERSION = 1;
const rooms = {};

function ensureRuntimeFields(room) {
	if (!rooms[room]._sentTimes) rooms[room]._sentTimes = new Map();
	if (!rooms[room]._invalidMoves) rooms[room]._invalidMoves = {}; // playerId -> count
}

function buildRoomState(roomId) {
	const base = rooms[roomId];
	if (!base) return null;
	if (base._stateSeq === undefined) base._stateSeq = 0;
	return {
		...base,
		protocolVersion: PROTOCOL_VERSION,
		serverTime: Date.now(),
		stateSeq: base._stateSeq,
		serverSent: Date.now()
	};
}

function sendUpdate(room) {
	if (!rooms[room]) return;
	ensureRuntimeFields(room);
	rooms[room]._stateSeq++;
	const seq = rooms[room]._stateSeq;
	rooms[room]._sentTimes.set(seq, Date.now());
	io.to(room).emit('update', buildRoomState(room));
}

function countMaps(player) {
	let total = 0;
	for (const s of player.playedSanctuaries) if (sanctuaries[s].clue) total++;
	for (const c of player.playedCards) if (regions[c].clue) total++;
	return total;
}

function drawCard(pool) { const idx = Math.floor(Math.random() * pool.length); return pool.splice(idx, 1)[0]; }
function drawSanctuary(pool, number) { const res = []; for (let i = 0; i < number; i++) { const idx = Math.floor(Math.random() * pool.length); res.push(pool.splice(idx, 1)[0]); } return res; }
function resetHasPlayed(room) { for (const uid of rooms[room].users) { rooms[room].players[uid].hasPlayed = false; rooms[room].players[uid].hasToChoose = false; } }
function generateShop(room) { rooms[room].shop = []; const target = Math.min(rooms[room].pool.length, Math.max(3, rooms[room].users.length + 1)); for (let i = 0; i < target; i++) rooms[room].shop.push(drawCard(rooms[room].pool)); }

function beginGame(room) {
	logEvent({ scope: 'server', action: 'beginGame_init', gameId: room, payload: { users: rooms[room].users.length } });
	io.to(room).emit('beginGame', { protocolVersion: PROTOCOL_VERSION, serverTime: Date.now(), gameId: room });
	rooms[room]._stateSeq = 0; ensureRuntimeFields(room);
	rooms[room].turn = 0;
	rooms[room].pool = Array.from({ length: regions.length }, (_, i) => i);
	rooms[room].sanctuaryPool = Array.from({ length: sanctuaries.length }, (_, i) => i);
	rooms[room].phase = 'play';
	rooms[room].players = {};
	for (const uid of rooms[room].users) rooms[room].players[uid] = { hand: [], sanctuaries: [], playedCards: [], playedSanctuaries: [], hasPlayed: false, hasToChoose: false, sanctuaryChoose: [] };
	for (const uid of rooms[room].users) for (let j = 0; j < 3; j++) rooms[room].players[uid].hand.push(drawCard(rooms[room].pool));
	generateShop(room);
	setTimeout(() => { rooms[room].state = true; logEvent({ scope: 'server', action: 'beginGame_started', gameId: room }); sendUpdate(room); }, 300);
}

function goToSanctuary(room) { resetHasPlayed(room); const prev = rooms[room].phase; rooms[room].phase = 'sanctuary'; logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: prev, to: 'sanctuary', turn: rooms[room].turn } }); for (const uid of rooms[room].users) { const p = rooms[room].players[uid]; if (p.playedCards[p.playedCards.length - 1] > p.playedCards[p.playedCards.length - 2]) { p.hasToChoose = true; p.sanctuaryChoose = drawSanctuary(rooms[room].sanctuaryPool, countMaps(p) + 1); } else { p.hasPlayed = true; } } if (rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed)) goToShop(room); else sendUpdate(room); }

function goToShop(room) { const prevPhase = rooms[room].phase; if (rooms[room].turn === 7) { for (const uid of rooms[room].users) rooms[room].players[uid].hasPlayed = true; finishGame(room); sendUpdate(room); return; } resetHasPlayed(room); rooms[room].phase = 'shop'; logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: prevPhase, to: 'shop', turn: rooms[room].turn } }); const order = [...rooms[room].users].sort((a, b) => rooms[room].players[a].playedCards.slice(-1)[0] - rooms[room].players[b].playedCards.slice(-1)[0]); rooms[room].shopOrder = order; if (order.length) rooms[room].players[order[0]].hasToChoose = true; sendUpdate(room); }

function finishGame(room) {
	rooms[room].phase = 'end'; logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { to: 'end', turn: rooms[room].turn } }); const scores = []; let max = -Infinity; for (const uid of rooms[room].users) { const s = countPoints(rooms[room].players[uid]); logEvent({ scope: 'server', action: 'score_breakdown', gameId: room, playerId: uid, payload: s }); scores.push(s); if (s.total > max) max = s.total; } const winners = rooms[room].users.filter((uid, i) => scores[i].total === max); rooms[room].winner = winners; rooms[room].score = scores; logEvent({ scope: 'server', action: 'endGameScore', gameId: room, payload: { winners, scores } }); // invalid moves summary
	for (const uid of rooms[room].users) { const cnt = rooms[room]._invalidMoves[uid] || 0; logEvent({ scope: 'server', action: 'invalidMoves', gameId: room, playerId: uid, payload: { count: cnt } }); }
}

function countPoints(player) { let totalScore = 0; const roundScores = []; const total = { stone: 0, clue: 0, chimera: 0, thistle: 0, red: 0, green: 0, blue: 0, yellow: 0, colorless: 0, night: 0, wonderSet: 0, colorSet: 0 }; for (const sIdx of player.playedSanctuaries) { const s = sanctuaries[sIdx]; if (s.wonders) { if (s.wonders.stone) total.stone += s.wonders.stone; if (s.wonders.chimera) total.chimera += s.wonders.chimera; if (s.wonders.thistle) total.thistle += s.wonders.thistle; } if (s.clue) total.clue++; if (s.biome && total[s.biome] !== undefined) total[s.biome]++; if (s.night) total.night++; } for (let j = 7; j >= 0; j--) { const r = regions[player.playedCards[j]]; if (r.wonders) { if (r.wonders.stone) total.stone += r.wonders.stone; if (r.wonders.chimera) total.chimera += r.wonders.chimera; if (r.wonders.thistle) total.thistle += r.wonders.thistle; } if (r.clue) total.clue++; if (r.biome && total[r.biome] !== undefined) total[r.biome]++; if (r.night) total.night++; total.wonderSet = Math.min(total.stone, total.chimera, total.thistle); total.colorSet = Math.min(total.red, total.green, total.blue, total.yellow); let temp = 0; if (r.fame && (!r.quest || (r.quest && checkQuest(total, r.quest)))) { if (typeof r.fame === 'number') temp += r.fame; else if (typeof r.fame.per === 'string') temp += total[r.fame.per] * r.fame.score; else if (typeof r.fame.per === 'object') { for (const k in r.fame.per) temp += total[r.fame.per[k]] * r.fame.score; } } roundScores.push(temp); totalScore += temp; } let temp = 0; for (const sIdx of player.playedSanctuaries) { const s = sanctuaries[sIdx]; if (s.fame) { if (typeof s.fame === 'number') temp += s.fame; else if (typeof s.fame.per === 'string') temp += total[s.fame.per] * s.fame.score; else if (typeof s.fame.per === 'object') { for (const k in s.fame.per) temp += total[s.fame.per[k]] * s.fame.score; } } } roundScores.push(temp); totalScore += temp; return { total: totalScore, round: roundScores }; }

function checkQuest(total, quest) { for (const k in quest) if (total[k] < quest[k]) return false; return true; }

function roomUpdate(room) { switch (rooms[room].phase) { case 'play': { const allPlayed = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed); if (allPlayed) { rooms[room].turn !== 0 ? goToSanctuary(room) : goToShop(room); return; } logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'play', payload: { turn: rooms[room].turn } }); sendUpdate(room); break; } case 'shop': { const allPicked = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed); if (allPicked) { rooms[room].phase = 'play'; rooms[room].turn++; logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: 'shop', to: 'play', turn: rooms[room].turn } }); if (rooms[room].turn === 8) { finishGame(room); sendUpdate(room); return; } resetHasPlayed(room); generateShop(room); } logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'shop', payload: { turn: rooms[room].turn } }); sendUpdate(room); break; } case 'sanctuary': { const allDone = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed); if (allDone) { goToShop(room); return; } logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'sanctuary', payload: { turn: rooms[room].turn } }); sendUpdate(room); break; } } }

function leaveRoom(socket) { for (const room in rooms) { if (rooms[room].users.includes(socket.id)) { rooms[room].users = rooms[room].users.filter(id => id !== socket.id); if (!rooms[room].users.length) delete rooms[room]; } } }
function locatePlayer(socketId) { for (const room in rooms) if (rooms[room].users.includes(socketId)) return room; }

io.on('connection', socket => {
	socket.emit('wellConnected'); socket.emit('rooms', rooms); logEvent({ scope: 'server', action: 'socket_connected', playerId: socket.id });
	socket.on('getRooms', () => socket.emit('rooms', rooms));
	socket.on('disconnect', () => { leaveRoom(socket); logEvent({ scope: 'server', action: 'socket_disconnected', playerId: socket.id }); });
	socket.on('leaveRoom', () => leaveRoom(socket));
	socket.on('createRoom', () => { const id = generateId(); socket.join(id); socket.emit('joinedRoom', id); rooms[id] = { users: [socket.id], state: false, maxPlayers: 6 }; logEvent({ scope: 'server', action: 'room_created', gameId: id, playerId: socket.id }); });
	socket.on('joinRoom', msg => { if (rooms[msg]) { if (rooms[msg].users.length >= (rooms[msg].maxPlayers || 6)) { socket.emit('roomFull'); logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'full' } }); return; } if (rooms[msg].state) { socket.emit('roomStarted'); logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'started' } }); return; } socket.join(msg); rooms[msg].users.push(socket.id); socket.emit('roomJoined', { roomId: msg, ...rooms[msg] }); io.to(msg).emit('update', buildRoomState(msg)); logEvent({ scope: 'server', action: 'room_joined', gameId: msg, playerId: socket.id, payload: { users: rooms[msg].users.length } }); } else { socket.emit('roomNotFound'); logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'notFound' } }); } });
	socket.on('startGame', roomId => { if (!rooms[roomId]) return; if (rooms[roomId].state) return; if (rooms[roomId].users.length < 2) { socket.emit('notEnoughPlayers'); logEvent({ scope: 'server', action: 'startGame_reject', gameId: roomId, playerId: socket.id, payload: { reason: 'notEnoughPlayers' } }); return; } logEvent({ scope: 'server', action: 'startGame_request', gameId: roomId, playerId: socket.id }); beginGame(roomId); });
	socket.on('playCard', card => { const r = locatePlayer(socket.id); if (!r) return; const player = rooms[r].players[socket.id]; if (rooms[r].phase !== 'play') { logEvent({ scope: 'server', action: 'playCard_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (player.hasPlayed) { logEvent({ scope: 'server', action: 'playCard_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'alreadyPlayed' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (player.hand.includes(card)) { player.hand = player.hand.filter(c => c !== card); player.hasPlayed = true; player.playedCards.push(card); logEvent({ scope: 'server', action: 'playCard', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } }); roomUpdate(r); } });
	socket.on('shopChooseCard', card => { const r = locatePlayer(socket.id); if (!r) return; const player = rooms[r].players[socket.id]; if (rooms[r].phase !== 'shop') { logEvent({ scope: 'server', action: 'shopChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (!player.hasToChoose) { logEvent({ scope: 'server', action: 'shopChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'notYourTurn' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (rooms[r].shop.includes(card)) { player.hand.push(card); player.hasToChoose = false; player.hasPlayed = true; rooms[r].shop = rooms[r].shop.filter(c => c !== card); if (rooms[r].shopOrder) { for (const uid of rooms[r].shopOrder) { if (!rooms[r].players[uid].hasPlayed) { rooms[r].players[uid].hasToChoose = true; break; } } } logEvent({ scope: 'server', action: 'shopChooseCard', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } }); roomUpdate(r); } });
	socket.on('sanctuaryChoose', card => { const r = locatePlayer(socket.id); if (!r) return; const player = rooms[r].players[socket.id]; if (rooms[r].phase !== 'sanctuary') { logEvent({ scope: 'server', action: 'sanctuaryChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (!player.hasToChoose) { logEvent({ scope: 'server', action: 'sanctuaryChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'notEligible' } }); rooms[r]._invalidMoves[socket.id] = (rooms[r]._invalidMoves[socket.id] || 0) + 1; return; } if (player.sanctuaryChoose.includes(card)) { player.sanctuaryChoose = player.sanctuaryChoose.filter(c => c !== card); player.hasToChoose = false; player.hasPlayed = true; player.playedSanctuaries.push(card); logEvent({ scope: 'server', action: 'sanctuaryChoose', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } }); roomUpdate(r); } });
	socket.on('updateAck', msg => { const r = locatePlayer(socket.id); if (!r) return; if (!rooms[r] || !rooms[r]._sentTimes) return; const sent = rooms[r]._sentTimes.get(msg.stateSeq); if (sent) { const rtt = Date.now() - sent; logEvent({ scope: 'server', action: 'updateAck', playerId: socket.id, gameId: r, latencyMs: rtt, payload: { stateSeq: msg.stateSeq } }); rooms[r]._sentTimes.delete(msg.stateSeq - 5); } else { logEvent({ scope: 'server', action: 'updateAck_missingSent', playerId: socket.id, gameId: r, payload: { stateSeq: msg.stateSeq } }); } });
});

server.listen(port, () => console.log(`Listening on port ${port}`));