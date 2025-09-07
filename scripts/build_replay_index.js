#!/usr/bin/env node
// Phase 3.3 - Construit un index léger (replay) des épisodes: métadonnées pour navigation/visualisation
// Produit dataset/episodes/index.json

const fs = require('fs');
const path = require('path');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
if (!fs.existsSync(EP_DIR)) { console.error('No episodes dir'); process.exit(1); }

const result = [];
for (const f of fs.readdirSync(EP_DIR)) {
	if (!f.endsWith('.json')) continue;
	try {
		const data = JSON.parse(fs.readFileSync(path.join(EP_DIR, f), 'utf8'));
		result.push({
			file: f,
			gameId: data.gameId,
			playerId: data.playerId,
			steps: data.steps?.length || 0,
			createdAt: data.createdAt,
			finishedAt: data.finishedAt,
			finalReward: data.finalInfo?.finalReward ?? null
		});
	} catch { /* ignore */ }
}

result.sort((a, b) => a.createdAt - b.createdAt);
fs.writeFileSync(path.join(EP_DIR, 'index.json'), JSON.stringify({ generatedAt: Date.now(), episodes: result }, null, 2));
console.log('Replay index written with', result.length, 'episodes');
