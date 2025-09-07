#!/usr/bin/env node
// Phase 5.4 – Contrôle qualité des données de self-play
// Analyse les transitions JSONL (queue_transitions_*.jsonl + transitions_*.jsonl) pour produire des indicateurs:
// - distribution actions (top-N, entropie brute)
// - % actions null / -1 (no-op)
// - longueur moyenne d'épisode (estimée via compte done=true / épisodes)
// - reward stats (mean, std, min, max, terminal vs shaping)
// - seeds cohérence (unicité gameSeed, proportion de playerSeed distincts)
// - backlog queue (.ready non consommés)
// - estimation invalid moves (si champ spécifié plus tard)
// Sortie: metrics/quality_latest.json + markdown metrics/quality_latest.md

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'dataset', 'transitions');
const QUEUE_DIR = path.join(process.cwd(), 'dataset', 'queue');

function listTransitionFiles() {
	if (!fs.existsSync(DATA_DIR)) return [];
	return fs.readdirSync(DATA_DIR)
		.filter(f => f.endsWith('.jsonl') && (f.startsWith('queue_transitions_') || f.startsWith('transitions_')))
		.map(f => path.join(DATA_DIR, f))
		.sort();
}

function readLinesLimited(file, maxLines) {
	const content = fs.readFileSync(file, 'utf8');
	const lines = content.split(/\n+/).filter(l => l.trim().length > 0);
	return maxLines ? lines.slice(0, maxLines) : lines;
}

function entropy(counts, total) {
	let H = 0;
	for (const c of Object.values(counts)) {
		if (!c) continue; const p = c / total; H -= p * Math.log2(p);
	}
	return H;
}

function qualityScan(limitFiles = 50) {
	const files = listTransitionFiles().slice(-limitFiles); // derniers fichiers
	let totalTransitions = 0;
	let actionCounts = {};
	let nullActions = 0;
	let doneCount = 0;
	let rewardSum = 0, rewardSq = 0, rMin = Infinity, rMax = -Infinity;
	let terminalRewardSum = 0, shapingRewardSum = 0;
	const seenGameSeeds = new Set();
	const seenPlayerSeeds = new Set();
	const sampleGames = new Set();

	for (const f of files) {
		let lines;
		try { lines = readLinesLimited(f); } catch { continue; }
		for (const L of lines) {
			let obj; try { obj = JSON.parse(L); } catch { continue; }
			totalTransitions++;
			const a = obj.action;
			if (a == null || a === -1) nullActions++;
			else actionCounts[a] = (actionCounts[a] || 0) + 1;
			if (obj.done) doneCount++;
			const r = +obj.reward || 0;
			rewardSum += r; rewardSq += r * r; rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
			if (obj.done) terminalRewardSum += r; else shapingRewardSum += r;
			if (obj.gameSeed) seenGameSeeds.add(obj.gameSeed);
			if (obj.playerSeed) seenPlayerSeeds.add(obj.playerSeed);
			if (obj.gameId) sampleGames.add(obj.gameId);
		}
	}
	const actionTotal = Object.values(actionCounts).reduce((a, b) => a + b, 0);
	const ent = actionTotal ? entropy(actionCounts, actionTotal) : 0;
	const topActions = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([k, v]) => ({ action: +k, count: v, pct: +(v / Math.max(actionTotal, 1) * 100).toFixed(2) }));
	const nullPct = totalTransitions ? (nullActions / totalTransitions * 100) : 0;
	const meanReward = totalTransitions ? rewardSum / totalTransitions : 0;
	const varReward = totalTransitions ? (rewardSq / totalTransitions) - meanReward * meanReward : 0;
	const stdReward = varReward > 0 ? Math.sqrt(varReward) : 0;

	// Estimation longueur moyenne épisode: totalTransitions / doneCount (approx, si 1 done par épisode)
	const avgEpisodeLen = doneCount ? (totalTransitions / doneCount) : 0;

	// Backlog queue: .ready non consommés
	let backlog = 0;
	try {
		const incoming = path.join(QUEUE_DIR, 'incoming');
		backlog = fs.readdirSync(incoming).filter(f => f.endsWith('.ready')).length;
	} catch { }

	const now = Date.now();
	return {
		generatedAt: now,
		filesAnalyzed: files.length,
		totalTransitions,
		episodesApprox: doneCount,
		avgEpisodeLen,
		actionDistinct: Object.keys(actionCounts).length,
		entropy: ent,
		topActions,
		nullActionPct: +nullPct.toFixed(2),
		reward: { mean: +meanReward.toFixed(4), std: +stdReward.toFixed(4), min: rMin, max: rMax, terminalSum: +terminalRewardSum.toFixed(4), shapingSum: +shapingRewardSum.toFixed(4) },
		seeds: { gameSeeds: seenGameSeeds.size, playerSeeds: seenPlayerSeeds.size, games: sampleGames.size },
		backlogReadyFiles: backlog
	};
}

function writeOutputs(stats) {
	const metricsDir = path.join(process.cwd(), 'metrics');
	if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });
	const outJson = path.join(metricsDir, 'quality_latest.json');
	fs.writeFileSync(outJson, JSON.stringify(stats, null, 2));
	const md = [];
	md.push('# Data Quality Report');
	md.push('\nGenerated: ' + new Date(stats.generatedAt).toISOString());
	md.push(`\nTransitions: ${stats.totalTransitions} | Episodes≈ ${stats.episodesApprox} | AvgEpLen≈ ${stats.avgEpisodeLen.toFixed(1)}`);
	md.push(`\nDistinct actions: ${stats.actionDistinct} | Entropy: ${stats.entropy.toFixed(3)} | NullAction%: ${stats.nullActionPct}`);
	md.push(`\nReward mean: ${stats.reward.mean} std: ${stats.reward.std} min: ${stats.reward.min} max: ${stats.reward.max}`);
	md.push(`\nTerminalRewardSum: ${stats.reward.terminalSum} | ShapingSum: ${stats.reward.shapingSum}`);
	md.push(`\nSeeds: gameSeeds=${stats.seeds.gameSeeds} playerSeeds=${stats.seeds.playerSeeds} games=${stats.seeds.games}`);
	md.push(`\nQueue backlog (.ready files): ${stats.backlogReadyFiles}`);
	md.push('\n\n## Top Actions');
	md.push('\n| action | count | pct |');
	md.push('|--------|-------|-----|');
	for (const t of stats.topActions) md.push(`| ${t.action} | ${t.count} | ${t.pct}% |`);
	fs.writeFileSync(path.join(metricsDir, 'quality_latest.md'), md.join('\n'));
	// Historique optionnel
	const histDir = path.join(metricsDir, 'quality_history');
	if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
	fs.writeFileSync(path.join(histDir, stats.generatedAt + '.json'), JSON.stringify(stats));
	console.log('[quality] report written:', outJson);
}

(function main() {
	const stats = qualityScan();
	writeOutputs(stats);
})();
