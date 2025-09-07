#!/usr/bin/env node
// Phase 3.3 - Déduplication des transitions sur base obsHash si présent ou hash recomputé
// Garde la première occurrence d'une observation identique.
// Entrée: dernier transitions_*.jsonl
// Sortie: dataset/transitions/dedup_<timestamp>.jsonl

const fs = require('fs');
const path = require('path');
const { fnv1a } = require('../dataset/util_hash');

const TR_DIR = path.join(process.cwd(), 'dataset', 'transitions');
if (!fs.existsSync(TR_DIR)) { console.error('No transitions dir'); process.exit(1); }
const files = fs.readdirSync(TR_DIR).filter(f => f.startsWith('transitions_') && f.endsWith('.jsonl')).sort();
if (!files.length) { console.log('No transition files'); process.exit(0); }
const latest = path.join(TR_DIR, files[files.length - 1]);

const lines = fs.readFileSync(latest, 'utf8').trim().split(/\n+/).filter(Boolean);
const seen = new Set();
let kept = 0;
const outName = path.join(TR_DIR, `dedup_${Date.now()}.jsonl`);
const out = fs.createWriteStream(outName, 'utf8');
for (const line of lines) {
	try {
		const obj = JSON.parse(line);
		if (!Array.isArray(obj.obs)) continue;
		const h = fnv1a(obj.obs);
		if (seen.has(h)) continue;
		seen.add(h);
		out.write(JSON.stringify(obj) + '\n');
		kept++;
	} catch { /* ignore */ }
}
out.end(() => console.log('Deduplicated transitions kept', kept, '->', outName));
