#!/usr/bin/env node
// Split transitions jsonl récents en train/val/test (80/10/10)
const fs = require('fs');
const path = require('path');

const TR_DIR = path.join(process.cwd(), 'dataset', 'transitions');
if (!fs.existsSync(TR_DIR)) { console.error('No transitions dir'); process.exit(1); }

const files = fs.readdirSync(TR_DIR).filter(f => f.startsWith('transitions_') && f.endsWith('.jsonl')).sort();
if (!files.length) { console.log('No transition files'); process.exit(0); }
const latest = path.join(TR_DIR, files[files.length - 1]);
const lines = fs.readFileSync(latest, 'utf8').trim().split(/\n+/);

const N = lines.length;
const idxTrain = Math.floor(N * 0.8);
const idxVal = Math.floor(N * 0.9);

function writeSplit(name, slice) {
	const outPath = path.join(TR_DIR, name);
	fs.writeFileSync(outPath, slice.join('\n') + '\n');
	console.log('Wrote', name, slice.length);
}

writeSplit('train.jsonl', lines.slice(0, idxTrain));
writeSplit('val.jsonl', lines.slice(idxTrain, idxVal));
writeSplit('test.jsonl', lines.slice(idxVal));
