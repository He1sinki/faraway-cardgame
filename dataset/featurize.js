// Simple featurization of server state into a flat numeric array (Phase 3.1)
// NOTE: This is a first-pass heuristic; will evolve with learning.
// Export: featurize(state, playerId) -> { vector: number[], mask: number[] }

function oneHot(index, size) {
	const arr = new Array(size).fill(0);
	if (index >= 0 && index < size) arr[index] = 1;
	return arr;
}

// Build mask of playable actions (card indexes in hand) for phase 'play'
function actionMask(state, playerId) {
	const player = state.players?.[playerId];
	if (!player) return [];
	if (state.phase !== 'play') return player.hand.map(() => 0);
	// playable if card is in hand and not already played (simple check)
	return player.hand.map(() => 1);
}

function featurize(state, playerId) {
	const player = state.players?.[playerId];
	if (!player) return { vector: [], mask: [] };

	// Basic numeric descriptors
	const phaseMap = { play: 0, sanctuary: 1, shop: 2, end: 3 };
	const phaseVec = oneHot(phaseMap[state.phase] ?? 0, 4);

	const turn = state.turn ?? 0;
	const handCount = player.hand.length;
	const playedCount = player.playedCards.length;
	const sanctCount = player.playedSanctuaries.length;

	// Aggregate opponent counts
	let oppPlayedAvg = 0;
	let oppCount = 0;
	for (const pid of state.users || []) {
		if (pid === playerId) continue;
		const op = state.players[pid];
		if (op) { oppPlayedAvg += op.playedCards.length; oppCount++; }
	}
	if (oppCount) oppPlayedAvg /= oppCount;

	// Hand one-hot over limited window (assume card ids < 256) -> compress to bucketed counts
	const CARD_BUCKETS = 32; // coarse bucket
	const handBuckets = new Array(CARD_BUCKETS).fill(0);
	for (const c of player.hand) handBuckets[c % CARD_BUCKETS]++;

	const mask = actionMask(state, playerId);

	const vector = [
		turn / 8, // normalized
		handCount / 10,
		playedCount / 8,
		sanctCount / 8,
		oppPlayedAvg / 8,
		player.hasToChoose ? 1 : 0,
		player.hasPlayed ? 1 : 0
	].concat(phaseVec).concat(handBuckets);

	return { vector, mask };
}

module.exports = { featurize };
