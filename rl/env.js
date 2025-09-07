// Phase 4.4 - Wrapper Environnement réseau (synchronisation state <-> step)
// Fournit une interface proche Gym: reset() -> {obs, mask}, step(actionIndex) -> {obs, mask, reward, done, info}
// Hypothèses: un seul agent contrôle son joueur; on rejoint/crée une room, lance la partie si besoin.

const { io } = require('socket.io-client');
const crypto = require('crypto');
const { encodeObservation } = require('./encode_observation');
const { regions, sanctuaries } = require('../class/cards.js');
const { R, S, playIndex, shopIndex, sanctIndex, NOOP_INDEX } = require('./action_space');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sha1(arr) { return crypto.createHash('sha1').update(Buffer.from(Float32Array.from(arr).buffer)).digest('hex'); }

class NetworkEnv {
	constructor(opts = {}) {
		this.serverUrl = opts.serverUrl || process.env.SERVER_URL || 'http://localhost:8080';
		this.timeoutMs = opts.timeoutMs || 5000; // attente step
		this.joinRetry = opts.joinRetry || 5;
		this.minPlayers = opts.minPlayers || 2; // nouveau: autoriser démarrage solo (minPlayers=1)
		this.fillWithDummies = opts.fillWithDummies || 0; // nombre de joueurs fantômes à créer si besoin
		this.socket = null;
		this.playerId = null;
		this.roomId = null;
		this.lastState = null;
		this.stateSeq = 0;
		this.episodeReward = 0;
		this.finished = false;
		this._pendingBegin = false;
		this._awaitingStep = false;
		this._lastActionPhase = null;
		this._shapingCoeff = 0.01; // même logique que bot
	}

	async _connect() {
		if (this.socket) return;
		this.socket = io(this.serverUrl, { reconnection: true });
		this.socket.on('connect', () => { this.playerId = this.socket.id; });
		this.socket.on('rooms', (rooms) => this._handleRooms(rooms));
		this.socket.on('roomJoined', (state) => this._handleRoomJoined(state));
		this.socket.on('joinedRoom', (id) => { this.roomId = id; });
		this.socket.on('beginGame', (info) => { this._pendingBegin = true; this.gameId = info.gameId; });
		this.socket.on('update', (st) => this._handleUpdate(st));
	}

	_handleRooms(rooms) {
		if (this.roomId) return; // already joined
		const existing = Object.keys(rooms).find(r => rooms[r].users && rooms[r].users.length < 4 && !rooms[r].state);
		if (existing) this.socket.emit('joinRoom', existing); else this.socket.emit('createRoom');
	}

	_handleRoomJoined(state) {
		this.roomId = state.roomId;
		// Démarrage auto si nombre de joueurs suffisant OU mode solo
		if (state.users.length >= this.minPlayers) {
			setTimeout(() => this.socket.emit('startGame', this.roomId), 300);
		} else if (this.minPlayers === 1) {
			// mode solo: tenter démarrage même seul après petit délai (si serveur l'autorise)
			setTimeout(() => this.socket.emit('startGame', this.roomId), 800);
		} else if (this.fillWithDummies > 0) {
			// Créer des sockets fantômes pour atteindre minPlayers
			const needed = Math.max(0, this.minPlayers - state.users.length);
			for (let i = 0; i < Math.min(needed, this.fillWithDummies); i++) this._spawnDummy();
		}
	}

	_spawnDummy() {
		const sock = io(this.serverUrl, { reconnection: false, forceNew: true });
		sock.on('connect', () => {
			if (this.roomId) sock.emit('joinRoom', this.roomId);
		});
		sock.on('roomJoined', (st) => {
			if (st.users.length >= this.minPlayers) setTimeout(() => this.socket.emit('startGame', this.roomId), 200);
		});
		sock.on('disconnect', () => { });
	}

	_handleUpdate(st) {
		this.socket.emit('updateAck', { stateSeq: st.stateSeq, clientTime: Date.now() });
		this.lastState = st;
		this.stateSeq = st.stateSeq;
		if (!this._pendingBegin && st.phase !== undefined) this._pendingBegin = true; // fallback si pas d'event beginGame
		if (this._awaitingStep) this._awaitingStep = false;
	}

	async _waitForGameStart() {
		const start = Date.now();
		while (!this.lastState || this.lastState.phase === undefined) {
			if (Date.now() - start > this.timeoutMs) throw new Error('Timeout attente début de partie');
			await sleep(50);
		}
	}

	async reset() {
		this.finished = false; this.episodeReward = 0; this.lastState = null; this.stateSeq = 0; this.gameId = null;
		await this._connect();
		// demander rooms pour trigger join/create
		this.socket.emit('getRooms');
		// Attendre beginGame (ou un update qui indique déjà un état de partie si serveur ne fait pas d'event distinct)
		const start = Date.now();
		while (!this._pendingBegin) {
			if (this.lastState && this.lastState.phase !== undefined) break; // fallback: on a déjà un state
			if (Date.now() - start > this.timeoutMs) {
				if (this.minPlayers === 1 && this.lastState) break; // tolère en solo
				throw new Error('Timeout attente beginGame');
			}
			await sleep(50);
		}
		await this._waitForGameStart();
		const { obs, mask } = encodeObservation(this.lastState, this.playerId, regions, sanctuaries);
		return { obs, mask, info: { stateSeq: this.stateSeq, phase: this.lastState.phase, obsHash: sha1(obs) } };
	}

	_legalFromMask(mask) { const idx = []; for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i); return idx; }

	_actionToNetwork(actionIndex) {
		if (actionIndex === NOOP_INDEX) return null;
		if (actionIndex < R) return { type: 'playCard', card: actionIndex };
		if (actionIndex < 2 * R) return { type: 'shopChooseCard', card: actionIndex - R };
		if (actionIndex < 2 * R + S) return { type: 'sanctuaryChoose', card: (actionIndex - 2 * R) + 1 };
		return null; // out of logical range
	}

	_isTerminal(st) { return st && st.phase === 'end'; }

	_finalReward() {
		if (!this.lastState?.score || !Array.isArray(this.lastState.users)) return 0;
		const idx = this.lastState.users.indexOf(this.playerId);
		if (idx === -1) return 0;
		const my = this.lastState.score[idx]?.total; if (typeof my !== 'number') return 0;
		const all = this.lastState.score.map(s => s.total);
		const avg = all.reduce((a, b) => a + b, 0) / all.length;
		return my - avg;
	}

	async step(actionIndex) {
		if (this.finished) throw new Error('Episode déjà terminé');
		// Encode observation & mask courant
		const { obs: prevObs, mask: prevMask } = encodeObservation(this.lastState, this.playerId, regions, sanctuaries);
		const legal = this._legalFromMask(prevMask.slice(0, 256));
		if (!legal.includes(actionIndex)) {
			// fallback NOOP si illégale
			actionIndex = NOOP_INDEX;
		}
		const netAct = this._actionToNetwork(actionIndex);
		const beforeSeq = this.stateSeq;
		if (netAct) this.socket.emit(netAct.type, netAct.card);
		// shaping
		let deltaReward = 0;
		if (netAct && this.lastState.phase === 'play') {
			deltaReward += (this.lastState.turn || 0) / 8 * this._shapingCoeff;
			this.episodeReward += deltaReward;
		}
		// attendre next update ou terminal
		const start = Date.now();
		this._awaitingStep = true;
		while (this._awaitingStep) {
			if (Date.now() - start > this.timeoutMs) break; // timeout: on break (stagnation) -> renvoie même état
			await sleep(25);
		}
		// Si pas d’avancement, continuer quand même
		if (this.stateSeq === beforeSeq && !this._isTerminal(this.lastState)) {
			// On signale stagnation via info.stalled
		}
		const done = this._isTerminal(this.lastState);
		if (done) {
			const finalR = this._finalReward();
			deltaReward += finalR;
			this.episodeReward += finalR;
			this.finished = true;
		}
		const { obs, mask } = encodeObservation(this.lastState, this.playerId, regions, sanctuaries);
		const info = { stateSeq: this.stateSeq, phase: this.lastState.phase, obsHash: sha1(obs), stalled: this.stateSeq === beforeSeq, episodeReturn: this.episodeReward };
		return { obs, mask, reward: deltaReward, done, info };
	}
}

module.exports = { NetworkEnv };
