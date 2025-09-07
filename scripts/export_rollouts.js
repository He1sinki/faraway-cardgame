#!/usr/bin/env node
// Phase 3.4 - Exporte épisodes collectés vers format rollouts consommé par learner Python
// Produit: data/rollouts/episode_<game>_<player>_<ts>.jsonl
// Chaque ligne: {obs: base64(float32), mask: base64(uint8), action, logProb, value, reward, done, gameId, playerId, turn, episodeId}
// Action space normalisé: 256 (0..255). action = -1 si aucune.

const fs = require('fs');
const path = require('path');
const USE_ENCODE = process.env.USE_ENCODE_OBS === '1';
let encodeObservation = null; let regions = null, sanctuaries = null;
if (USE_ENCODE) {
	({ encodeObservation } = require('../rl/encode_observation'));
	({ regions, sanctuaries } = require('../class/cards.js'));
	console.log('[export_rollouts] using new encodeObservation');
}

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
const OUT_DIR = path.join(process.cwd(), 'data', 'rollouts');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function toBase64Float32(arr) { const buf = Buffer.alloc(arr.length * 4); const view = new DataView(buf.buffer); arr.forEach((v, i) => view.setFloat32(i * 4, v, true)); return buf.toString('base64'); }
function toBase64Uint8(arr) { return Buffer.from(Uint8Array.from(arr)).toString('base64'); }

function buildMask(step) { if (Array.isArray(step.mask) && step.mask.length === 256) return step.mask; const m = new Array(256).fill(0); if (Array.isArray(step.mask)) for (let i = 0; i < step.mask.length && i < 256; i++) if (step.mask[i]) m[i] = 1; return m; }

const files = fs.existsSync(EP_DIR) ? fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json')) : [];
if (!files.length) { console.log('[export_rollouts] no episodes'); process.exit(0); }
let exported = 0;
for (const f of files) {
	const full = path.join(EP_DIR, f);
	let data; try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
	const episodeId = `${data.gameId}_${data.playerId}_${data.createdAt}`;
	const outName = path.join(OUT_DIR, `episode_${episodeId}.jsonl`);
	if (fs.existsSync(outName)) continue; // skip already exported
	const stream = fs.createWriteStream(outName, 'utf8');
	for (const step of data.steps || []) {
		let obsArr = step.obs;
		let maskArr = buildMask(step);
		if (USE_ENCODE && step.info?.rawState) {
			try {
				const enc = encodeObservation(step.info.rawState, data.playerId, regions, sanctuaries);
				obsArr = enc.obs;
				maskArr = enc.mask;
			} catch (e) { /* fallback legacy */ }
		}
		if (!Array.isArray(obsArr)) continue;
		const obsB64 = toBase64Float32(obsArr);
		const maskB64 = toBase64Uint8(maskArr);
		const line = {
			obs: obsB64,
			mask: maskB64,
			action: step.action == null ? -1 : step.action,
			rawAction: step.rawAction ?? null,
			logProb: -1.0,
			value: 0.0,
			reward: step.reward || 0,
			done: !!step.done,
			gameId: data.gameId,
			playerId: data.playerId,
			turn: step.info?.seq || 0,
			episodeId
		};
		stream.write(JSON.stringify(line) + '\n');
	}
	stream.end();
	exported++;
}
console.log('[export_rollouts] exported episodes:', exported);
