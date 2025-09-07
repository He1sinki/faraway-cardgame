#!/usr/bin/env node
// Agrège métriques simples depuis logs bruts
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(process.cwd(), 'logs', 'raw');
const METRICS_DIR = path.join(process.cwd(), 'metrics');
if (!fs.existsSync(RAW_DIR)) process.exit(0);
if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });

let games = {}; // gameId -> { decisions, actions, lastTs }

function processFile(file) {
	const full = path.join(RAW_DIR, file);
	const data = fs.readFileSync(full, 'utf8').split(/\n+/);
	for (const line of data) {
		if (!line.trim()) continue;
		try {
			const obj = JSON.parse(line);
			const g = obj.gameId || 'NA';
			if (!games[g]) games[g] = { decisions: 0, actions: 0, lastTs: 0 };
			if (obj.kind === 'decision') games[g].decisions++;
			if (obj.action) games[g].actions++;
			if (obj.ts && obj.ts > games[g].lastTs) games[g].lastTs = obj.ts;
		} catch (e) {
			// ignore malformed
		}
	}
}

for (const f of fs.readdirSync(RAW_DIR)) {
	if (f.endsWith('.log')) processFile(f);
}

// Agrégats globaux
let totalDecisions = 0;
let totalActions = 0;
for (const g in games) {
	totalDecisions += games[g].decisions;
	totalActions += games[g].actions;
}

const out = {
	generatedAt: Date.now(),
	games: Object.keys(games).length,
	totalDecisions,
	totalActions,
	perGame: games
};

fs.writeFileSync(path.join(METRICS_DIR, 'latest.json'), JSON.stringify(out, null, 2));
console.log('Metrics written metrics/latest.json');
