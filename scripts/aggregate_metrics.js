#!/usr/bin/env node
// Phase 2.5 - Agrégation avancée des métriques serveur
// Lit logs JSONL (pino) dans logs/raw/*.log et produit:
// - metrics/latest.json : snapshot complet
// - metrics/history/<timestamp>.json : archive
// - metrics/latest.md : résumé lisible
// Champs calculés: latence (avg, p50, p90, p99, max), invalid moves, durée parties,
// distribution actions, durées par phase, taux d'ack, throughput.

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(process.cwd(), 'logs', 'raw');
const METRICS_DIR = path.join(process.cwd(), 'metrics');
const HISTORY_DIR = path.join(METRICS_DIR, 'history');
if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(RAW_DIR)) {
	const empty = { generatedAt: Date.now(), games: 0, note: 'No raw logs directory present' };
	fs.writeFileSync(path.join(METRICS_DIR, 'latest.json'), JSON.stringify(empty, null, 2));
	process.exit(0);
}

function pct(arr, p) {
	if (!arr.length) return null;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
	return sorted[idx];
}

const games = {}; // gameId -> structure

function ensureGame(id) {
	if (!games[id]) {
		games[id] = {
			gameId: id,
			beginTs: null,
			endTs: null,
			actions: {},
			latency: [],
			invalidMoves: 0,
			invalidMovesByPlayer: {},
			phaseTransitions: [], // {from,to,ts}
			phaseDurations: {}, // phase -> ms
			acks: 0,
			updates: 0 // approximé via state_update ou updateAck ratio
		};
	}
	return games[id];
}

function recordPhaseDurations(g) {
	// dérive durées entre transitions successives
	const list = g.phaseTransitions;
	for (let i = 0; i < list.length - 1; i++) {
		const cur = list[i];
		const next = list[i + 1];
		const phase = cur.to || cur.phase || 'unknown';
		const dur = next.ts - cur.ts;
		g.phaseDurations[phase] = (g.phaseDurations[phase] || 0) + dur;
	}
	// dernière phase jusqu'à fin de partie si endTs connu
	if (g.endTs && list.length) {
		const last = list[list.length - 1];
		const phase = last.to || last.phase || 'unknown';
		const dur = g.endTs - last.ts;
		if (dur > 0) g.phaseDurations[phase] = (g.phaseDurations[phase] || 0) + dur;
	}
}

function ingestLine(obj) {
	const gId = obj.gameId || 'NO_GAME';
	const g = ensureGame(gId);
	const ts = obj.ts || Date.now();
	switch (obj.action) {
		case 'beginGame_init':
			if (!g.beginTs) g.beginTs = ts; break;
		case 'endGameScore':
			g.endTs = ts; break;
		case 'phase_transition':
			g.phaseTransitions.push({ from: obj.payload?.from || null, to: obj.payload?.to || obj.payload?.phase || null, ts });
			break;
		case 'invalidMoves': // summary line en fin de partie
			if (obj.payload && typeof obj.payload.count === 'number') {
				g.invalidMoves += obj.payload.count;
				if (obj.playerId) {
					g.invalidMovesByPlayer[obj.playerId] = (g.invalidMovesByPlayer[obj.playerId] || 0) + obj.payload.count;
				}
			}
			break;
		case 'updateAck':
			if (typeof obj.latencyMs === 'number') g.latency.push(obj.latencyMs);
			g.acks++; break;
		default:
			break;
	}
	// Toute action compte dans distribution actions
	if (obj.action) g.actions[obj.action] = (g.actions[obj.action] || 0) + 1;

	// Heuristique invalid moves incrémentale: actions se terminant par _reject
	if (obj.action && obj.action.endsWith('_reject')) {
		g.invalidMoves++;
		if (obj.playerId) g.invalidMovesByPlayer[obj.playerId] = (g.invalidMovesByPlayer[obj.playerId] || 0) + 1;
	}
}

function processFile(file) {
	const full = path.join(RAW_DIR, file);
	const content = fs.readFileSync(full, 'utf8').split(/\n+/);
	for (const line of content) {
		if (!line.trim()) continue;
		try { ingestLine(JSON.parse(line)); } catch { /* ignore */ }
	}
}

for (const f of fs.readdirSync(RAW_DIR)) {
	if (f.endsWith('.log')) processFile(f);
}

// Post-traitement
let aggregateLatency = [];
let totalInvalid = 0;
let totalGamesWithEnd = 0;

for (const id in games) {
	const g = games[id];
	if (g.beginTs && g.endTs) totalGamesWithEnd++;
	recordPhaseDurations(g);
	aggregateLatency.push(...g.latency);
	totalInvalid += g.invalidMoves;
	// Stats par jeu
	const lat = g.latency;
	g.latencyStats = lat.length ? {
		count: lat.length,
		avg: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2),
		p50: pct(lat, 0.50),
		p90: pct(lat, 0.90),
		p99: pct(lat, 0.99),
		max: Math.max(...lat)
	} : { count: 0 };
	g.durationMs = (g.beginTs && g.endTs) ? g.endTs - g.beginTs : null;
	// Throughput approx: nombre d'updateAck / durée
	if (g.durationMs && g.latencyStats.count) {
		g.throughputAckPerSec = +(g.latencyStats.count / (g.durationMs / 1000)).toFixed(3);
	}
}

const latAll = aggregateLatency;
const globalLatency = latAll.length ? {
	count: latAll.length,
	avg: +(latAll.reduce((a, b) => a + b, 0) / latAll.length).toFixed(2),
	p50: pct(latAll, 0.50),
	p90: pct(latAll, 0.90),
	p99: pct(latAll, 0.99),
	max: Math.max(...latAll)
} : { count: 0 };

// Invalid moves per 100 actions (normalisation)
let totalActions = 0;
for (const id in games) {
	totalActions += Object.values(games[id].actions).reduce((a, b) => a + b, 0);
}
const invalidPer100Actions = totalActions ? +(totalInvalid / totalActions * 100).toFixed(2) : 0;

const snapshot = {
	generatedAt: Date.now(),
	games: Object.keys(games).length,
	gamesCompleted: totalGamesWithEnd,
	globalLatency,
	totalInvalidMoves: totalInvalid,
	invalidPer100Actions,
	totalActions,
	perGame: games
};

fs.writeFileSync(path.join(METRICS_DIR, 'latest.json'), JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(HISTORY_DIR, `${Date.now()}.json`), JSON.stringify(snapshot));

// Markdown résumé
function fmt(v) { return v === null || v === undefined ? '-' : v; }
let md = `# Metrics Snapshot\n\nGenerated: ${new Date(snapshot.generatedAt).toISOString()}\n\n`;
md += `Total games: ${snapshot.games} (completed: ${snapshot.gamesCompleted})\n\n`;
md += `## Global Latency\n\n`;
md += 'count: ' + snapshot.globalLatency.count + '\n';
if (snapshot.globalLatency.count) {
	md += `avg: ${snapshot.globalLatency.avg} ms  p50: ${snapshot.globalLatency.p50}  p90: ${snapshot.globalLatency.p90}  p99: ${snapshot.globalLatency.p99}  max: ${snapshot.globalLatency.max}\n`;
}
md += `\nInvalid moves: ${snapshot.totalInvalidMoves} (per100Actions: ${snapshot.invalidPer100Actions})\n`;
md += `Total actions: ${snapshot.totalActions}\n\n`;
md += `## Per Game\n\n`;
md += '| Game | Duration(ms) | Actions | Invalid | LatAvg | p90 | p99 | Ack/s |\n';
md += '|------|--------------|---------|---------|--------|-----|-----|-------|\n';
for (const id in games) {
	const g = games[id];
	md += `| ${id} | ${fmt(g.durationMs)} | ${Object.values(g.actions).reduce((a, b) => a + b, 0)} | ${g.invalidMoves} | ${fmt(g.latencyStats.avg)} | ${fmt(g.latencyStats.p90)} | ${fmt(g.latencyStats.p99)} | ${fmt(g.throughputAckPerSec)} |\n`;
}

fs.writeFileSync(path.join(METRICS_DIR, 'latest.md'), md, 'utf8');
console.log('Metrics written: metrics/latest.json & metrics/latest.md');
