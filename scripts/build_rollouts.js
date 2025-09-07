#!/usr/bin/env node
// Convertit les fichiers d'épisodes (dataset/episodes/*.json) en rollouts linéaires
// Format cible: data/rollouts/processed/episode_<counter>.jsonl
// Chaque ligne contient: {obs, mask, action, reward, done, gameId, playerId, runSeed, gameSeed, playerSeed}
// obs: float32 little-endian binaire base64; mask: bytes base64 (longueur PAD_DIM, défaut 256)

const fs = require('fs');
const path = require('path');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
const OUT_DIR = path.join(process.cwd(), 'data', 'rollouts', 'processed');
const PAD_DIM = 256;

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(OUT_DIR);

function float32ToB64(arr) {
	const buf = Buffer.alloc(arr.length * 4);
	for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i] ?? 0, i * 4);
	return buf.toString('base64');
}

function maskToB64(arr) {
	const buf = Buffer.alloc(PAD_DIM, 0);
	for (let i = 0; i < Math.min(arr.length, PAD_DIM); i++) buf[i] = arr[i] ? 1 : 0;
	return buf.toString('base64');
}

let counter = 0;
let stepTotal = 0;
let expectedObsLen = null;
const skippedByLen = new Map();
const files = fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json'));
if (!files.length) {
	console.error('[rollouts] Aucun fichier épisode trouvé dans', EP_DIR);
	process.exit(1);
}

for (const f of files) {
	let data; try { data = JSON.parse(fs.readFileSync(path.join(EP_DIR, f), 'utf8')); } catch (e) { console.warn('[rollouts] skip (parse)', f, e.message); continue; }
	if (!Array.isArray(data.steps)) { console.warn('[rollouts] skip (no steps)', f); continue; }
	const outName = `episode_${String(counter).padStart(6, '0')}.jsonl`;
	const outPath = path.join(OUT_DIR, outName);
	const w = fs.createWriteStream(outPath, { flags: 'w' });
	for (const step of data.steps) {
		if (!Array.isArray(step.obs) || !Array.isArray(step.mask)) continue;
		if (expectedObsLen === null) expectedObsLen = step.obs.length;
		if (step.obs.length !== expectedObsLen) {
			const k = step.obs.length;
			skippedByLen.set(k, (skippedByLen.get(k) || 0) + 1);
			continue;
		}
		const line = {
			obs: float32ToB64(step.obs),
			mask: maskToB64(step.mask),
			action: step.action ?? -1,
			reward: step.reward || 0,
			done: !!step.done,
			gameId: data.gameId,
			playerId: data.playerId,
			runSeed: step.runSeed || data.finalInfo?.runSeed || null,
			gameSeed: step.gameSeed || data.finalInfo?.gameSeed || null,
			playerSeed: step.playerSeed || data.finalInfo?.playerSeed || null
		};
		w.write(JSON.stringify(line) + '\n');
		stepTotal++;
	}
	w.end();
	counter++;
	if (counter % 25 === 0) console.log(`[rollouts] converti ${counter} épisodes...`);
}

let skipMsg = '';
if (skippedByLen.size) {
	skipMsg = ' | skipped=' + Array.from(skippedByLen.entries()).map(([l, c]) => `${c}x(len=${l})`).join(',');
}
console.log(`[rollouts] Terminé: épisodes=${counter} steps=${stepTotal} obsDim=${expectedObsLen}${skipMsg} -> ${OUT_DIR}`);