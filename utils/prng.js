// Phase 5.3 – PRNG déterministe & dérivation de seeds
// Fournit un générateur mulberry32 et fonctions utilitaires.
// Usage:
// const { makeRNG, hashCombine } = require('../utils/prng');
// const rng = makeRNG(seed32);
// const x = rng(); // [0,1)

function mulberry32(a) {
	let t = a >>> 0;
	return function () {
		t += 0x6D2B79F5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

// Simple FNV-1a 32-bit pour string
function hashString(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return h >>> 0;
}

// Combine deux seeds 32 bits (inspiration splitmix)
function hashCombine(a, b) {
	let x = (a ^ 0x9e3779b9) + (b >>> 0) + ((a << 6) >>> 0) + ((a >>> 2) >>> 0);
	x = (x ^ (x >>> 16)) >>> 0;
	x = Math.imul(x, 0x7feb352d) >>> 0;
	x = (x ^ (x >>> 15)) >>> 0;
	x = Math.imul(x, 0x846ca68b) >>> 0;
	x = (x ^ (x >>> 16)) >>> 0;
	return x >>> 0;
}

function deriveGameSeed(runSeed, gameId) {
	return hashCombine(runSeed >>> 0, hashString(String(gameId)) >>> 0);
}

function derivePlayerSeed(gameSeed, playerIndex) {
	return hashCombine(gameSeed >>> 0, (playerIndex & 0xff) >>> 0);
}

function makeRNG(seed) { return mulberry32(seed >>> 0); }

module.exports = { makeRNG, hashString, hashCombine, deriveGameSeed, derivePlayerSeed };
