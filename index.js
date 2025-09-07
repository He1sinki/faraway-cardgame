const app = require('express')();
const { logEvent } = require('./logger/serverLogger');
const server = require('http').createServer(app);
const { Server } = require("socket.io");
const port = process.env.PORT || 8080;

// const cors = require("cors");

var io = new Server(server, {
	cors: {
		origin: "http://localhost:5173",
		credentials: true
	}
});

//function to generate 5 character id
function generateId() {
	return Math.random().toString(36).substring(2, 7);
}

//load /class/cards.ts
const { regions, sanctuaries } = require('./class/cards.js');

var rooms = {};
const PROTOCOL_VERSION = 1;

function buildRoomState(roomId) {
	const base = rooms[roomId];
	if (!base) return null;
	if (base._stateSeq === undefined) base._stateSeq = 0;
	return {
		...base,
		protocolVersion: PROTOCOL_VERSION,
		serverTime: Date.now(),
		stateSeq: base._stateSeq,
	};
}

function beginGame(room) {
	logEvent({ scope: 'server', action: 'beginGame_init', gameId: room, payload: { users: rooms[room].users.length } });
	io.to(room).emit('beginGame', { protocolVersion: PROTOCOL_VERSION, serverTime: Date.now() });
	rooms[room]._stateSeq = 0;

	rooms[room].turn = 0;
	//pool is a list of numbers between 0 and regions.length -1
	rooms[room].pool = [];
	for (let i = 0; i < regions.length; i++) {
		rooms[room].pool.push(i);
	}

	rooms[room].sanctuaryPool = [];
	for (let i = 0; i < sanctuaries.length; i++) {
		rooms[room].sanctuaryPool.push(i);
	}

	rooms[room].phase = "play"; // play, sanctuary, shop, end

	// Initialisation dynamique des joueurs
	rooms[room].players = {};
	for (const uid of rooms[room].users) {
		rooms[room].players[uid] = { hand: [], sanctuaries: [], playedCards: [], playedSanctuaries: [], hasPlayed: false, hasToChoose: false, sanctuaryChoose: [] };
	}

	// Distribution de 3 cartes de départ à chacun
	for (const uid of rooms[room].users) {
		for (let j = 0; j < 3; j++) {
			rooms[room].players[uid].hand.push(drawCard(rooms[room].pool));
		}
	}
	generateShop(room);

	setTimeout(() => {
		rooms[room].state = true;
		logEvent({ scope: 'server', action: 'beginGame_started', gameId: room });
		rooms[room]._stateSeq++;
		io.to(room).emit('update', buildRoomState(room));
	}, 300); // délai réduit
}

function goToShop(room) {
	const prevPhase = rooms[room].phase;
	if (rooms[room].turn == 7) {
		// Dernier tour terminé -> fin de partie
		for (const uid of rooms[room].users) {
			rooms[room].players[uid].hasPlayed = true;
		}
		finishGame(room);
		rooms[room]._stateSeq++;
		io.to(room).emit('update', buildRoomState(room));
		return;
	}
	resetHasPlayed(room);
	rooms[room].phase = "shop";
	logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: prevPhase, to: 'shop', turn: rooms[room].turn } });

	// Ordre de choix magasin selon la dernière carte jouée (valeur croissante)
	const order = [...rooms[room].users].sort((a, b) => {
		const pa = rooms[room].players[a];
		const pb = rooms[room].players[b];
		const la = pa.playedCards[pa.playedCards.length - 1];
		const lb = pb.playedCards[pb.playedCards.length - 1];
		return la - lb;
	});
	rooms[room].shopOrder = order; // stocker l'ordre complet
	// Premier joueur peut choisir
	if (order.length) {
		rooms[room].players[order[0]].hasToChoose = true;
	}
}

function countMaps(player) {
	let total = 0;
	for (let i = 0; i < player.playedSanctuaries.length; i++) {
		if (sanctuaries[player.playedSanctuaries[i]].clue) {
			total++;
		}
	}
	for (let j = 0; j < player.playedCards.length; j++) {
		if (regions[player.playedCards[j]].clue) {
			total++;
		}
	}
	return total;
}



function goToSanctuary(room) {
	resetHasPlayed(room);
	const prevPhase = rooms[room].phase;
	rooms[room].phase = "sanctuary";
	logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: prevPhase, to: 'sanctuary', turn: rooms[room].turn } });

	for (const uid of rooms[room].users) {
		const p = rooms[room].players[uid];
		// Comparaison entre les deux dernières cartes jouées
		if (p.playedCards[p.playedCards.length - 1] > p.playedCards[p.playedCards.length - 2]) {
			p.hasToChoose = true;
			const count = countMaps(p) + 1;
			p.sanctuaryChoose = drawSanctuary(rooms[room].sanctuaryPool, count);
		} else {
			p.hasPlayed = true; // rien à choisir
		}
	}

	// Si personne n'a de choix, passer directement au shop
	if (rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed)) {
		goToShop(room);
	}
}

function finishGame(room) {
	rooms[room].phase = "end";
	logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { to: 'end', turn: rooms[room].turn } });
	const scores = [];
	let max = -Infinity;
	for (const uid of rooms[room].users) {
		const s = countPoints(rooms[room].players[uid]);
		logEvent({ scope: 'server', action: 'score_breakdown', gameId: room, playerId: uid, payload: s });
		scores.push(s);
		if (s.total > max) max = s.total;
	}
	const winners = rooms[room].users.filter((uid, idx) => scores[idx].total === max);
	rooms[room].winner = winners; // tableau (peut contenir plusieurs gagnants)
	rooms[room].score = scores; // aligné avec users
	logEvent({ scope: 'server', action: 'endGameScore', gameId: room, payload: { winners, scores } });
}

function countPoints(player) {
	let totalScore = 0;

	let roundScores = [];

	let total = {
		stone: 0,
		clue: 0,
		chimera: 0,
		thistle: 0,
		red: 0,
		green: 0,
		blue: 0,
		yellow: 0,
		colorless: 0,
		night: 0,

		wonderSet: 0,
		colorSet: 0
	}

	for (let i = 0; i < player.playedSanctuaries.length; i++) {
		let sanctuary = sanctuaries[player.playedSanctuaries[i]];
		if (sanctuary.wonders && sanctuary.wonders.stone) {
			total.stone += sanctuary.wonders.stone;
		}
		if (sanctuary.wonders && sanctuary.wonders.chimera) {
			total.chimera += sanctuary.wonders.chimera;
		}
		if (sanctuary.wonders && sanctuary.wonders.thistle) {
			total.thistle += sanctuary.wonders.thistle;
		}
		if (sanctuary.clue) {
			total.clue++;
		}
		if (sanctuary.biome == "red") {
			total.red++;
		}
		if (sanctuary.biome == "green") {
			total.green++;
		}
		if (sanctuary.biome == "blue") {
			total.blue++;
		}
		if (sanctuary.biome == "yellow") {
			total.yellow++;
		}
		if (sanctuary.biome == "colorless") {
			total.colorless++;
		}
		if (sanctuary.night) {
			total.night++;
		}
	}

	for (let j = 7; j >= 0; j--) {
		let region = regions[player.playedCards[j]];
		if (region.wonders && region.wonders.stone) {
			total.stone += region.wonders.stone;
		}
		if (region.wonders && region.wonders.chimera) {
			total.chimera += region.wonders.chimera;
		}
		if (region.wonders && region.wonders.thistle) {
			total.thistle += region.wonders.thistle;
		}
		if (region.clue) {
			total.clue++;
		}
		if (region.biome == "red") {
			total.red++;
		}
		if (region.biome == "green") {
			total.green++;
		}
		if (region.biome == "blue") {
			total.blue++;
		}
		if (region.biome == "yellow") {
			total.yellow++;
		}
		if (region.biome == "colorless") {
			total.colorless++;
		}
		if (region.night) {
			total.night++;
		}

		//count wonderSet and colorSet
		total.wonderSet = Math.min(total.stone, total.chimera, total.thistle);
		total.colorSet = Math.min(total.red, total.green, total.blue, total.yellow);

		let tempScore = 0;
		if (region.fame && (!region.quest || region.quest && checkQuest(total, region.quest))) {
			console.log(region.number)
			if (typeof region.fame.per == 'string') {
				tempScore += total[region.fame.per] * region.fame.score;
			} else if (typeof region.fame == 'number') {
				tempScore += region.fame;
			} else if (typeof region.fame.per == 'object') {
				for (const prop in region.fame.per) {
					tempScore += total[region.fame.per[prop]] * region.fame.score;
				}
			}
		}
		roundScores.push(tempScore);
		totalScore += tempScore;
	}

	//Sanctuary points
	let tempScore = 0;
	for (let i = 0; i < player.playedSanctuaries.length; i++) {
		let sanctuary = sanctuaries[player.playedSanctuaries[i]];
		if (sanctuary.fame) {
			if (typeof sanctuary.fame.per == 'string') {
				tempScore += total[sanctuary.fame.per] * sanctuary.fame.score;
			} else if (typeof sanctuary.fame == 'number') {
				tempScore += sanctuary.fame;
			} else if (typeof sanctuary.fame.per == 'object') {
				for (const item in sanctuary.fame.per) {
					tempScore += total[sanctuary.fame.per[item]] * sanctuary.fame.score;
				}
			}
		}
	}
	roundScores.push(tempScore);
	totalScore += tempScore;

	return { total: totalScore, round: roundScores };
}

function checkQuest(total, quest) {
	for (const questItem in quest) {
		console.log(questItem)
		console.log(total[questItem])
		console.log(quest[questItem])
		if (total[questItem] < quest[questItem]) {
			return false;
		}
	}
	return true;
}

function roomUpdate(room) {
	switch (rooms[room].phase) {
		case "play": {
			const allPlayed = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed);
			if (allPlayed) {
				if (rooms[room].turn !== 0) {
					goToSanctuary(room);
				} else {
					goToShop(room);
				}
			}
			rooms[room]._stateSeq++;
			logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'play', payload: { turn: rooms[room].turn } });
			io.to(room).emit('update', buildRoomState(room));
			break;
		}
		case "shop": {
			const allPicked = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed);
			if (allPicked) {
				rooms[room].phase = "play";
				rooms[room].turn++;
				logEvent({ scope: 'server', action: 'phase_transition', gameId: room, payload: { from: 'shop', to: 'play', turn: rooms[room].turn } });
				if (rooms[room].turn == 8) {
					finishGame(room);
					io.to(room).emit('update', buildRoomState(room));
					return;
				}
				resetHasPlayed(room);
				generateShop(room);
			}
			logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'shop', payload: { turn: rooms[room].turn } });
			rooms[room]._stateSeq++;
			io.to(room).emit('update', buildRoomState(room));
			break;
		}
		case "sanctuary": {
			const allDone = rooms[room].users.every(uid => rooms[room].players[uid].hasPlayed);
			if (allDone) {
				goToShop(room);
			}
			logEvent({ scope: 'server', action: 'state_update', gameId: room, phase: 'sanctuary', payload: { turn: rooms[room].turn } });
			rooms[room]._stateSeq++;
			io.to(room).emit('update', buildRoomState(room));
			break;
		}
	}
}

function resetHasPlayed(room) {
	for (const uid of rooms[room].users) {
		rooms[room].players[uid].hasPlayed = false;
		rooms[room].players[uid].hasToChoose = false;
	}
}

function generateShop(room) {
	rooms[room].shop = [];
	// nombre de cartes en boutique : joueurs + 1 (au minimum 3, plafonné par cartes restantes)
	const target = Math.min(rooms[room].pool.length, Math.max(3, rooms[room].users.length + 1));
	for (let i = 0; i < target; i++) {
		rooms[room].shop.push(drawCard(rooms[room].pool));
	}
}

function drawCard(pool) {
	let card = Math.floor(Math.random() * (pool.length));

	return pool.splice(card, 1)[0];
}

function drawSanctuary(pool, number) {
	let final = [];
	for (let i = 0; i < number; i++) {
		sanctuary = Math.floor(Math.random() * (pool.length));
		final.push(pool.splice(sanctuary, 1)[0]);
	}
	return final;
}

function leaveRoom(socket) {
	for (let room in rooms) {
		if (rooms[room].users.includes(socket.id)) {
			rooms[room].users = rooms[room].users.filter((id) => id != socket.id);
			if (rooms[room].users.length == 0) {
				delete rooms[room];
			}
		}
	}
}

function locatePlayer(socketId) {
	for (let room in rooms) {
		if (rooms[room].users.includes(socketId)) {
			return room;
		}
	}
}

io.on('connection', (socket) => {
	socket.emit("wellConnected");
	socket.emit("rooms", rooms);
	logEvent({ scope: 'server', action: 'socket_connected', playerId: socket.id });
	socket.on("getRooms", () => {
		socket.emit("rooms", rooms);
	});

	socket.on('disconnect', function () {
		//find all rooms where the socket.id is in, and removes him (if the room is empty delete it)
		leaveRoom(socket)
		logEvent({ scope: 'server', action: 'socket_disconnected', playerId: socket.id });
	});

	socket.on("leaveRoom", () => {
		leaveRoom(socket)
	})

	socket.on('createRoom', (msg) => {
		let id = generateId();
		socket.join(id);
		socket.emit('joinedRoom', id);
		rooms[id] = { users: [socket.id], state: false, maxPlayers: 6 };
		console.log(rooms)
		logEvent({ scope: 'server', action: 'room_created', gameId: id, playerId: socket.id });
	});

	socket.on("joinRoom", (msg) => {
		if (rooms[msg]) {
			if (rooms[msg].users.length >= (rooms[msg].maxPlayers || 6)) {
				socket.emit("roomFull");
				logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'full' } });
				return;
			}
			if (rooms[msg].state) {
				socket.emit("roomStarted");
				logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'started' } });
				return;
			}
			socket.join(msg);
			rooms[msg].users.push(socket.id);
			socket.emit("roomJoined", rooms[msg]);
			io.to(msg).emit('update', buildRoomState(msg));
			logEvent({ scope: 'server', action: 'room_joined', gameId: msg, playerId: socket.id, payload: { users: rooms[msg].users.length } });
		} else {
			socket.emit("roomNotFound");
			logEvent({ scope: 'server', action: 'room_join_reject', gameId: msg, playerId: socket.id, payload: { reason: 'notFound' } });
		}
	});

	// Démarrage manuel de la partie (créateur ou n'importe qui pour simplifier)
	socket.on('startGame', (roomId) => {
		if (!rooms[roomId]) return;
		if (rooms[roomId].state) return; // déjà démarré
		if (rooms[roomId].users.length < 2) {
			socket.emit('notEnoughPlayers');
			logEvent({ scope: 'server', action: 'startGame_reject', gameId: roomId, playerId: socket.id, payload: { reason: 'notEnoughPlayers' } });
			return;
		}
		logEvent({ scope: 'server', action: 'startGame_request', gameId: roomId, playerId: socket.id });
		beginGame(roomId);
	});

	//GAME INTERACTIONS
	socket.on("playCard", (card) => {
		let r = locatePlayer(socket.id);
		let player = rooms[r].players[socket.id];
		if (rooms[r].phase != "play") {
			logEvent({ scope: 'server', action: 'playCard_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } });
			return;
		}
		if (player.hasPlayed) {
			logEvent({ scope: 'server', action: 'playCard_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'alreadyPlayed' } });
			return;
		}
		if (player.hand.includes(card)) {
			player.hand = player.hand.filter((c) => c != card);
			player.hasPlayed = true;
			player.playedCards.push(card);
			logEvent({ scope: 'server', action: 'playCard', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } });
			roomUpdate(r);
		}
	})

	socket.on("shopChooseCard", (card) => {
		let r = locatePlayer(socket.id);
		let player = rooms[r].players[socket.id];
		if (rooms[r].phase != "shop") {
			logEvent({ scope: 'server', action: 'shopChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } });
			return;
		}
		if (!player.hasToChoose) {
			logEvent({ scope: 'server', action: 'shopChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'notYourTurn' } });
			return;
		}
		if (rooms[r].shop.includes(card)) {
			player.hand.push(card);
			player.hasToChoose = false;
			player.hasPlayed = true;
			rooms[r].shop = rooms[r].shop.filter((c) => c != card);
			// Donner la main au prochain joueur dans l'ordre
			if (rooms[r].shopOrder) {
				for (const uid of rooms[r].shopOrder) {
					if (!rooms[r].players[uid].hasPlayed) {
						rooms[r].players[uid].hasToChoose = true;
						break;
					}
				}
			}
			logEvent({ scope: 'server', action: 'shopChooseCard', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } });
			roomUpdate(r);
		}
	})

	socket.on("sanctuaryChoose", (card) => {
		let r = locatePlayer(socket.id);
		let player = rooms[r].players[socket.id];
		if (rooms[r].phase != "sanctuary") {
			logEvent({ scope: 'server', action: 'sanctuaryChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'phase' } });
			return;
		}
		if (!player.hasToChoose) {
			logEvent({ scope: 'server', action: 'sanctuaryChoose_reject', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card, reason: 'notEligible' } });
			return;
		}
		if (player.sanctuaryChoose.includes(card)) {
			player.sanctuaryChoose = player.sanctuaryChoose.filter((c) => c != card);
			player.hasToChoose = false;
			player.hasPlayed = true;
			player.playedSanctuaries.push(card);
			logEvent({ scope: 'server', action: 'sanctuaryChoose', playerId: socket.id, gameId: r, phase: rooms[r].phase, payload: { card } });
			roomUpdate(r);
		}
	})

	socket.on('updateAck', (msg) => {
		// msg: { stateSeq, clientTime }
		// latency approximative serveur->client->serveur = now - serverSentTime (approx absent) -> utiliser serverTime dans update future (Phase 2.4). Ici on log juste réception ack.
		logEvent({ scope: 'server', action: 'updateAck', playerId: socket.id, payload: { stateSeq: msg.stateSeq, clientTime: msg.clientTime } });
	});
})
server.listen(port, function () {
	console.log(`Listening on port ${port}`);
});