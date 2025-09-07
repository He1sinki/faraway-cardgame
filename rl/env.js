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
		if (state.users.length >= 2) setTimeout(() => this.socket.emit('startGame', this.roomId), 300);
	}

	_handleUpdate(st) {
		this.socket.emit('updateAck', { stateSeq: st.stateSeq, clientTime: Date.now() });
		this.lastState = st;
		this.stateSeq = st.stateSeq;
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
		// Attendre beginGame + premier update
		const start = Date.now();
		while (!this._pendingBegin) {
			if (Date.now() - start > this.timeoutMs) throw new Error('Timeout attente beginGame');
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
		if (netAct && this.lastState.phase === 'play') this.episodeReward += (this.lastState.turn || 0) / 8 * this._shapingCoeff;
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
			this.episodeReward += this._finalReward();
			this.finished = true;
		}
		const { obs, mask } = encodeObservation(this.lastState, this.playerId, regions, sanctuaries);
		const stepReward = this.episodeReward; // reward cumul (simple); could return incremental diff
		const info = { stateSeq: this.stateSeq, phase: this.lastState.phase, obsHash: sha1(obs), stalled: this.stateSeq === beforeSeq };
		return { obs, mask, reward: stepReward, done, info };
	}
}

module.exports = { NetworkEnv };
