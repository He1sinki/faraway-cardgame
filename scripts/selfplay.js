#!/usr/bin/env node
// Phase 5.1 - Orchestrateur self-play amélioré
// Fonctionnalités:
// - Paramètres: --bots N --episodes M --max-parallel P --seed S --batch-size B --rotate --quiet
// - Spawning contrôlé (limite max parallel) & relance jusqu'à atteindre episodes cibles
// - Génération seeds dérivées (seed_base + botIndex)
// - Monitoring: vitesse épisodes/min, ETA
// - Rotation par batch (si --batch-size) -> sous-dossiers dataset/episodes/batch_<k>
// - Arrêt propre et code retour non-zero si aucun épisode généré

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs() {
	const args = process.argv.slice(2);
	const cfg = {
		bots: parseInt(process.env.BOTS || '4', 10),
		episodes: parseInt(process.env.TARGET_EPISODES || '20', 10),
		maxParallel: null,
		seed: Date.now() % 1e9,
		batchSize: null,
		rotate: false,
		quiet: false,
		idleRestart: 5, // cycles d'inactivité (tick) avant restart bot (0=off)
		botTTL: 0, // minutes avant recycle (0=off)
		countMode: 'auto', // files|jsonl|auto
		countIncomplete: false // si true: 1 fichier = 1 épisode dès apparition (même non terminé)
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--bots') cfg.bots = parseInt(args[++i], 10);
		else if (a === '--episodes') cfg.episodes = parseInt(args[++i], 10);
		else if (a === '--max-parallel') cfg.maxParallel = parseInt(args[++i], 10);
		else if (a === '--seed') cfg.seed = parseInt(args[++i], 10);
		else if (a === '--batch-size') cfg.batchSize = parseInt(args[++i], 10);
		else if (a === '--rotate') cfg.rotate = true;
		else if (a === '--quiet') cfg.quiet = true;
		else if (a === '--idle-restart') cfg.idleRestart = parseInt(args[++i], 10);
		else if (a === '--bot-ttl') cfg.botTTL = parseInt(args[++i], 10);
		else if (a === '--count-mode') cfg.countMode = args[++i];
		else if (a === '--count-incomplete') cfg.countIncomplete = true;
	}
	if (!cfg.maxParallel || cfg.maxParallel > cfg.bots) cfg.maxParallel = cfg.bots;
	return cfg;
}

const CFG = parseArgs();
const ROOT_EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
if (!fs.existsSync(ROOT_EP_DIR)) fs.mkdirSync(ROOT_EP_DIR, { recursive: true });

let batchIndex = 0;
function currentEpisodeDir() {
	if (!CFG.rotate || !CFG.batchSize) return ROOT_EP_DIR;
	const dir = path.join(ROOT_EP_DIR, `batch_${batchIndex}`);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return dir;
}

const startTime = Date.now();
const RUN_SEED = CFG.seed >>> 0; // seed de base pour cette exécution
let spawned = 0; // total launched
let active = new Map(); // pid -> child meta { botIdx,start,seed,lastEp, idleCycles }
let episodes = 0; // total episodes counted (nouveaux)
const seen = new Set(); // nouveaux fichiers vus
const baselineFiles = new Set();
const baselineJsonlCounts = new Map(); // file -> lignes initiales
// Initial: enregistrer état existant pour ne pas sur-compter
try {
	for (const f of fs.readdirSync(ROOT_EP_DIR).filter(f => f.endsWith('.json'))) {
		baselineFiles.add(f);
		// jsonl baseline lines
		try {
			const content = fs.readFileSync(path.join(ROOT_EP_DIR, f), 'utf8');
			const lines = content.split(/\n+/).filter(l => l.trim().length > 0);
			baselineJsonlCounts.set(f, lines.length);
		} catch { }
	}
} catch { }

function detectCountMode(dir) {
	if (CFG.countMode !== 'auto') return CFG.countMode; // user override
	try {
		const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
		for (const f of files) {
			const p = path.join(dir, f);
			const txt = fs.readFileSync(p, 'utf8');
			const lines = txt.split(/\n+/).filter(l => l.trim().length > 0);
			if (lines.length > 1) return 'jsonl';
		}
	} catch { }
	return 'files';
}
let resolvedCountMode = null;

function log(...m) { if (!CFG.quiet) console.log('[selfplay]', ...m); }

function spawnBot(botIdx) {
	const botSeed = (RUN_SEED + botIdx) >>> 0;
	const env = { ...process.env, BOT_INDEX: String(botIdx), SEED: String(botSeed), RUN_SEED: String(RUN_SEED) };
	// On redirige la variable EPISODE_DIR si rotation
	env.EPISODE_DIR = currentEpisodeDir();
	const child = spawn('node', ['scripts/bot.js'], { stdio: 'inherit', env });
	active.set(child.pid, { botIdx, start: Date.now(), seed: botSeed, lastEp: episodes, idleCycles: 0 });
	child.on('exit', (code) => { active.delete(child.pid); if (episodes < CFG.episodes) schedule(); });
	spawned++;
}

function schedule() {
	while (active.size < CFG.maxParallel && spawned < CFG.bots) spawnBot(spawned);
	// Si tous les bots initialement lancés et besoin de plus d'épisodes après arrêt complet, relancer une vague
	if (active.size === 0 && episodes < CFG.episodes) {
		// relance nouvelle vague complète
		spawned = 0; spawnBot(spawned); // spawn au moins un puis boucle schedule le reste
		schedule();
	}
}

function maybeRotate() {
	if (!CFG.rotate || !CFG.batchSize) return;
	if (episodes > 0 && episodes % CFG.batchSize === 0) {
		batchIndex++;
		log('rotating to new batch', batchIndex);
	}
}

function computeStats() {
	const dtMin = (Date.now() - startTime) / 60000;
	const rate = episodes / Math.max(dtMin, 1e-6);
	const remain = CFG.episodes - episodes;
	const etaMin = rate > 0 ? (remain / rate) : Infinity;
	return { rate: rate.toFixed(2), etaMin: isFinite(etaMin) ? etaMin.toFixed(1) : '∞' };
}

function tick() {
	const dir = currentEpisodeDir();
	if (!resolvedCountMode) resolvedCountMode = detectCountMode(dir);
	let files = [];
	try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { }
	if (resolvedCountMode === 'files') {
		for (const f of files) {
			if (baselineFiles.has(f)) continue; // existed before run
			if (!seen.has(f)) {
				// lire fichier pour détecter phase end si nécessaire
				let isComplete = true;
				if (!CFG.countIncomplete) {
					try {
						const txt = fs.readFileSync(path.join(dir, f), 'utf8');
						// Cherche "\"phase\":\"end\"" ou "\"done\":true" ou finalInfo
						isComplete = /"phase"\s*:\s*"end"/.test(txt) || /"done"\s*:\s*true/.test(txt) || /"finalInfo"/.test(txt);
					} catch { isComplete = false; }
				}
				if (isComplete) { seen.add(f); episodes++; maybeRotate(); }
			}
		}
	} else if (resolvedCountMode === 'jsonl') {
		let newlyCounted = 0;
		for (const f of files) {
			const p = path.join(dir, f);
			let lines = [];
			try { lines = fs.readFileSync(p, 'utf8').split(/\n+/).filter(l => l.trim().length > 0); } catch { }
			const baseline = baselineJsonlCounts.get(f) || 0;
			if (lines.length > baseline) {
				// si on ne compte que épisodes complets, il faut inspecter seulement les nouvelles lignes et incrémenter si elles contiennent done true ou phase end
				if (CFG.countIncomplete) {
					newlyCounted += (lines.length - baseline);
				} else {
					for (let i = baseline; i < lines.length; i++) {
						const L = lines[i];
						if (/"phase"\s*:\s*"end"/.test(L) || /"done"\s*:\s*true/.test(L) || /"finalInfo"/.test(L)) newlyCounted += 1;
					}
				}
				baselineJsonlCounts.set(f, lines.length); // update baseline to avoid double count
			}
		}
		if (newlyCounted > 0) {
			episodes += newlyCounted;
			while (newlyCounted-- > 0) maybeRotate();
		}
	}
	// Inactivité / TTL
	for (const [pid, meta] of Array.from(active.entries())) {
		if (meta.lastEp === episodes) meta.idleCycles += 1; else meta.idleCycles = 0;
		meta.lastEp = episodes;
		if (CFG.idleRestart && meta.idleCycles >= CFG.idleRestart) {
			log(`bot pid=${pid} idle ${meta.idleCycles} cycles -> restart`);
			try { process.kill(pid, 'SIGINT'); } catch { }
			active.delete(pid);
			spawnBot(meta.botIdx);
			continue;
		}
		if (CFG.botTTL > 0) {
			const ageMin = (Date.now() - meta.start) / 60000;
			if (ageMin >= CFG.botTTL) {
				log(`bot pid=${pid} ttl ${ageMin.toFixed(1)}m -> recycle`);
				try { process.kill(pid, 'SIGINT'); } catch { }
				active.delete(pid);
				spawnBot(meta.botIdx);
			}
		}
	}
	const { rate, etaMin } = computeStats();
	log(`episodes=${episodes}/${CFG.episodes} active=${active.size} rate=${rate}ep/min ETA=${etaMin}m mode=${resolvedCountMode}`);
	if (episodes >= CFG.episodes) {
		shutdown(0);
	}
}

let interval = null;
function start() {
	log('config', { ...CFG, runSeed: RUN_SEED });
	schedule();
	interval = setInterval(tick, 2000);
}

function shutdown(code) {
	if (interval) clearInterval(interval);
	for (const [pid, meta] of active) { try { process.kill(pid, 'SIGINT'); } catch { } }
	setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => { log('interrupt – shutting down'); shutdown(0); });
process.on('uncaughtException', e => { console.error('[selfplay] uncaught', e); shutdown(1); });

start();
