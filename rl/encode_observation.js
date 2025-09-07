// Phase 4.1 - Encodeur Observation détaillé
// Construit un vecteur dense + masque action 256-dim à partir de l'état serveur (room state) et playerId
// Ce module prépare la transition vers un espace d'action structuré (PLAY / SHOP / SANCT / NOOP).

const { R, S, ACT_DIM, PADDED_ACT_DIM, playIndex, shopIndex, sanctIndex, NOOP_INDEX } = require('./action_space');

function zero(n) { return new Array(n).fill(0); }

// Multi-hot utilitaire (valeurs ignorées si out of range)
function multiHot(indices, size) { const v = zero(size); for (const id of indices || []) if (id >= 0 && id < size) v[id] = 1; return v; }

// Calcule compte agrégé (stone,chimera,thistle,clue,red,green,blue,yellow,colorless,night,wonderSet,colorSet)
function aggregateScores(player, regions, sanctuaries) {
	const acc = { stone: 0, chimera: 0, thistle: 0, clue: 0, red: 0, green: 0, blue: 0, yellow: 0, colorless: 0, night: 0 };
	for (const s of player.playedSanctuaries) {
		const sc = sanctuaries[s - 1]; if (!sc) continue; // sanctuary tile numbering is 1-based
		if (sc.wonders) { if (sc.wonders.stone) acc.stone += sc.wonders.stone; if (sc.wonders.chimera) acc.chimera += sc.wonders.chimera; if (sc.wonders.thistle) acc.thistle += sc.wonders.thistle; }
		if (sc.clue) acc.clue++; if (sc.biome && acc[sc.biome] !== undefined) acc[sc.biome]++; if (sc.night) acc.night++;
	}
	for (const c of player.playedCards) {
		const rc = regions[c]; if (!rc) continue; if (rc.wonders) { if (rc.wonders.stone) acc.stone += rc.wonders.stone; if (rc.wonders.chimera) acc.chimera += rc.wonders.chimera; if (rc.wonders.thistle) acc.thistle += rc.wonders.thistle; }
		if (rc.clue) acc.clue++; if (rc.biome && acc[rc.biome] !== undefined) acc[rc.biome]++; if (rc.night) acc.night++;
	}
	acc.wonderSet = Math.min(acc.stone, acc.chimera, acc.thistle);
	acc.colorSet = Math.min(acc.red, acc.green, acc.blue, acc.yellow);
	return acc;
}

function normalizeCounts(acc) { // simple clamp/scale heuristique
	const cap = { stone: 10, chimera: 10, thistle: 10, clue: 15, red: 20, green: 20, blue: 20, yellow: 20, colorless: 15, night: 20, wonderSet: 5, colorSet: 5 };
	const feats = ['stone', 'chimera', 'thistle', 'clue', 'red', 'green', 'blue', 'yellow', 'colorless', 'night', 'wonderSet', 'colorSet'];
	return feats.map(k => Math.min(1, (acc[k] || 0) / cap[k]));
}

// Encode observation
function encodeObservation(state, playerId, regions, sanctuaries) {
	const player = state.players?.[playerId];
	if (!player) return { obs: [], mask: zero(PADDED_ACT_DIM) };
	const phaseMap = { play: 0, sanctuary: 1, shop: 2, end: 3 };
	const phaseOneHot = multiHot([phaseMap[state.phase] || 0], 4); // single index one-hot
	const turnScalar = (state.turn || 0) / 7; // normalized
	const hasToChoose = player.hasToChoose ? 1 : 0;

	// Multi-hot core sets
	const handVec = multiHot(player.hand, R);
	const playedSelf = multiHot(player.playedCards, R);
	// Opponents aggregate last played (simple: all played cards of others)
	const oppCards = [];
	for (const pid of state.users || []) if (pid !== playerId) { const op = state.players[pid]; if (op) oppCards.push(...op.playedCards); }
	const playedOthers = multiHot(oppCards, R);
	const shopVec = multiHot(state.shop || [], R);
	const sanctChoices = multiHot(player.sanctuaryChoose || [], S); // sanctuary ids are 1..S
	const sanctPlayed = multiHot(player.playedSanctuaries || [], S);

	const agg = aggregateScores(player, regions, sanctuaries);
	const scoreFeats = normalizeCounts(agg);

	// Assemble observation vector
	const obs = []
		.concat(phaseOneHot)
		.concat([turnScalar])
		.concat(scoreFeats)
		.concat([hasToChoose])
		.concat(handVec)
		.concat(shopVec)
		.concat(playedSelf)
		.concat(playedOthers)
		.concat(sanctChoices)
		.concat(sanctPlayed);

	// Build action mask padded to 256
	const mask = zero(PADDED_ACT_DIM);
	if (state.phase === 'play') {
		for (const c of player.hand) if (c < R) mask[playIndex(c)] = 1;
	} else if (state.phase === 'shop' && player.hasToChoose) {
		for (const c of state.shop || []) if (c < R) mask[shopIndex(c)] = 1;
	} else if (state.phase === 'sanctuary' && player.hasToChoose) {
		for (const t of player.sanctuaryChoose || []) if (t >= 1 && t <= S) mask[sanctIndex(t)] = 1;
	}
	// NOOP si aucune autre action
	if (!mask.some(v => v === 1)) mask[NOOP_INDEX] = 1;

	return { obs, mask };
}

module.exports = { encodeObservation };
