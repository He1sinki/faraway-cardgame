#!/usr/bin/env node
// Phase 3.3 - Calcule stats (mean/std) sur transitions et produit version normalisée
// Entrée: dernier transitions_*.jsonl
// Sorties:
// - dataset/stats/stats.json { mean:[], std:[] }
// - dataset/transitions/normalized_<timestamp>.jsonl

const fs = require('fs');
const path = require('path');

const TR_DIR = path.join(process.cwd(), 'dataset', 'transitions');
const STATS_DIR = path.join(process.cwd(), 'dataset', 'stats');
if (!fs.existsSync(STATS_DIR)) fs.mkdirSync(STATS_DIR, { recursive: true });
if (!fs.existsSync(TR_DIR)) { console.error('No transitions dir'); process.exit(1); }

const files = fs.readdirSync(TR_DIR).filter(f => f.startsWith('transitions_') && f.endsWith('.jsonl')).sort();
if (!files.length) { console.log('No transition files'); process.exit(0); }
const latest = path.join(TR_DIR, files[files.length - 1]);

const lines = fs.readFileSync(latest, 'utf8').trim().split(/\n+/).filter(Boolean);
if (!lines.length) { console.log('Empty transitions'); process.exit(0); }

let sum = [], sumSq = [], count = 0; let dim = null;
const parsed = [];
for (const line of lines) {
	try { const obj = JSON.parse(line); if (!Array.isArray(obj.obs)) continue; parsed.push(obj); if (dim === null) { dim = obj.obs.length; sum = new Array(dim).fill(0); sumSq = new Array(dim).fill(0); } if (obj.obs.length !== dim) continue; for (let i = 0; i < dim; i++) { const v = obj.obs[i]; sum[i] += v; sumSq[i] += v * v; } count++; } catch { /* ignore */ }
}
if (!count) { console.log('No numeric obs'); process.exit(0); }
const mean = sum.map(s => s / count);
const std = sumSq.map((s, i) => { const m = mean[i]; return Math.sqrt(Math.max(1e-8, s / count - m * m)); });
fs.writeFileSync(path.join(STATS_DIR, 'stats.json'), JSON.stringify({ source: latest, count, dim, mean, std }, null, 2));

const outName = path.join(TR_DIR, `normalized_${Date.now()}.jsonl`);
const out = fs.createWriteStream(outName, 'utf8');
for (const obj of parsed) {
	const normObs = obj.obs.map((v, i) => (v - mean[i]) / std[i]);
	out.write(JSON.stringify({ ...obj, obs: normObs }) + '\n');
}
out.end(() => console.log('Wrote normalized transitions ->', outName));
