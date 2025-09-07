// Phase 4.2 - Tests basiques encode_observation (hash stabilité + masque cohérence)
const crypto = require('crypto');
const { encodeObservation } = require('./encode_observation');
const { regions, sanctuaries } = require('../class/cards.js');

function hash(arr) { return crypto.createHash('sha1').update(Buffer.from(Float32Array.from(arr).buffer)).digest('hex'); }

function testDeterminism() {
	const dummy = buildDummyState();
	const a = encodeObservation(dummy, 'P1', regions, sanctuaries);
	const b = encodeObservation(dummy, 'P1', regions, sanctuaries);
	if (hash(a.obs) !== hash(b.obs)) throw new Error('Determinism failed');
}

function testMaskPlayPhase() {
	const st = buildDummyState();
	st.phase = 'play';
	st.players.P1.hand = [0, 5, 10];
	const { mask } = encodeObservation(st, 'P1', regions, sanctuaries);
	for (const c of [0, 5, 10]) if (mask[c] !== 1) throw new Error('Mask missing play card ' + c);
}

function testMaskNoop() {
	const st = buildDummyState();
	st.phase = 'shop';
	st.players.P1.hand = [1, 2];
	st.shop = []; // no choice
	const { mask } = encodeObservation(st, 'P1', regions, sanctuaries);
	const any = mask.some(v => v === 1);
	if (!any) throw new Error('Expected NOOP set');
}

function buildDummyState() {
	return {
		phase: 'play',
		turn: 0,
		users: ['P1', 'P2'],
		players: {
			P1: { hand: [0, 1], playedCards: [0], playedSanctuaries: [], hasToChoose: false, hasPlayed: false, sanctuaryChoose: [] },
			P2: { hand: [2, 3], playedCards: [2], playedSanctuaries: [], hasToChoose: false, hasPlayed: false, sanctuaryChoose: [] }
		},
		shop: [4, 5, 6]
	};
}

function run() {
	testDeterminism();
	testMaskPlayPhase();
	testMaskNoop();
	console.log('[encode_observation tests] OK');
}

if (require.main === module) run();

module.exports = { run };
