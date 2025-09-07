// Phase 4.6 - Vérification de cohérence masque vs actions possibles dérivées de l'état brut
// Pour un échantillon d'épisodes, on ré-encode rawState (si dispo) et on vérifie que:
// - Toute action play card dans hand -> mask[cardId] = 1 en phase 'play'
// - Si shop choose nécessaire -> toutes cartes shop présentes dans portion shop du mask OU fallback NOOP
// Rapporte stats d'incohérences.

const fs = require('fs');
const path = require('path');
const { encodeObservation } = require('./encode_observation');
const { regions, sanctuaries } = require('../class/cards.js');
const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');

function evaluateEpisode(file) {
	let data; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
	let playMissing = 0, playTotal = 0, shopMissing = 0, shopTotal = 0, sanctMissing = 0, sanctTotal = 0;
	for (const step of data.steps || []) {
		const raw = step.info?.rawState; if (!raw) continue;
		const enc = encodeObservation(raw, data.playerId, regions, sanctuaries);
		const mask = enc.mask;
		const player = raw.players?.[data.playerId]; if (!player) continue;
		if (raw.phase === 'play') {
			for (const c of player.hand) { playTotal++; if (!mask[c]) playMissing++; }
		}
		if (raw.phase === 'shop' && player.hasToChoose && Array.isArray(raw.shop)) {
			// Shop actions segment: offset R (regions length) -> R + cardId
			for (const c of raw.shop) { shopTotal++; const idx = regions.length + c; if (!mask[idx]) shopMissing++; }
		}
		if (raw.phase === 'sanctuary' && player.hasToChoose && Array.isArray(player.sanctuaryChoose)) {
			for (const c of player.sanctuaryChoose) { sanctTotal++; const idx = 2 * regions.length + (c - 1); if (!mask[idx]) sanctMissing++; }
		}
	}
	return { file: path.basename(file), playMissing, playTotal, shopMissing, shopTotal, sanctMissing, sanctTotal };
}

function run() {
	if (!fs.existsSync(EP_DIR)) { console.error('episodes dir missing'); process.exit(1); }
	const files = fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json')).slice(0, 50);
	if (!files.length) { console.log('[mask_consistency] no episodes'); return; }
	const rows = files.map(f => evaluateEpisode(path.join(EP_DIR, f))).filter(Boolean);
	const agg = rows.reduce((a, r) => {
		a.playMissing += r.playMissing; a.playTotal += r.playTotal;
		a.shopMissing += r.shopMissing; a.shopTotal += r.shopTotal;
		a.sanctMissing += r.sanctMissing; a.sanctTotal += r.sanctTotal; return a;
	}, { playMissing: 0, playTotal: 0, shopMissing: 0, shopTotal: 0, sanctMissing: 0, sanctTotal: 0 });
	function rate(m, t) { return t ? (m + '/' + t + ' (' + (100 * m / t).toFixed(2) + '%)') : '0'; }
	console.log('[mask_consistency] sample files=', rows.length);
	console.log(' play missing:', rate(agg.playMissing, agg.playTotal));
	console.log(' shop missing:', rate(agg.shopMissing, agg.shopTotal));
	console.log(' sanct missing:', rate(agg.sanctMissing, agg.sanctTotal));
	if (agg.playMissing > 0 || agg.shopMissing > 0 || agg.sanctMissing > 0) process.exitCode = 2;
}

if (require.main === module) run();

module.exports = { run };
