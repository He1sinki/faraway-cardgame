#!/usr/bin/env node
// Phase 5.5 – Versioning des checkpoints policy
// Crée un dossier runs/ppo_YYYYMMDD_HHMMSS avec:
// - metadata.json (git commit, runSeed, config hash minimal)
// - symlink ou copie derniers artefacts policy (si existants)
// Intégré pour usage futur lors des itérations PPO.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function timestampDir() {
	const d = new Date();
	const pad = (x) => String(x).padStart(2, '0');
	return `ppo_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function shortGitCommit() {
	try {
		const rev = require('child_process').execSync('git rev-parse --short HEAD').toString().trim();
		return rev;
	} catch { return null; }
}

function hashConfig(obj) {
	try { return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12); } catch { return null; }
}

function loadPPOConfig() {
	const cfgPath = path.join(process.cwd(), 'rl', 'config', 'ppo.yaml');
	if (!fs.existsSync(cfgPath)) return null;
	return fs.readFileSync(cfgPath, 'utf8');
}

function main() {
	const runSeed = process.env.RUN_SEED ? parseInt(process.env.RUN_SEED, 10) : null;
	const dirBase = path.join(process.cwd(), 'runs');
	if (!fs.existsSync(dirBase)) fs.mkdirSync(dirBase, { recursive: true });
	const dir = path.join(dirBase, timestampDir());
	fs.mkdirSync(dir);

	// read minimal config
	const ppoYaml = loadPPOConfig();
	const cfgHash = ppoYaml ? hashConfig(ppoYaml) : null;
	const commit = shortGitCommit();

	// detect latest policy artifacts
	const files = fs.readdirSync(dirBase).filter(f => f.startsWith('ppo_policy_') && f.endsWith('.pt'));
	let latestPolicy = null;
	if (files.length) {
		latestPolicy = files.map(f => path.join(dirBase, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
	}

	if (latestPolicy) {
		const dest = path.join(dir, 'model.ckpt');
		fs.copyFileSync(latestPolicy, dest);
	}

	// stats json detection
	const statFiles = fs.readdirSync(dirBase).filter(f => f.startsWith('ppo_stats_') && f.endsWith('.json'));
	if (statFiles.length) {
		const latestStats = statFiles.map(f => path.join(dirBase, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
		fs.copyFileSync(latestStats, path.join(dir, 'stats.json'));
	}

	// metadata
	const meta = {
		createdAt: Date.now(),
		runSeed,
		gitCommit: commit,
		configHash: cfgHash,
		ppoConfigSnippet: ppoYaml ? ppoYaml.split(/\n/).slice(0, 50).join('\n') : null,
		source: 'phase5.5'
	};
	fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2));
	console.log('[checkpoint] created', dir);
}

if (require.main === module) main();
