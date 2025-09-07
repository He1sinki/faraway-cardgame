#!/usr/bin/env node
// Construit un buffer transitions à partir des épisodes JSON.
// Sorties:
// - dataset/transitions/transitions_<ts>.jsonl (une ligne par transition)
// Format transition: { obs: number[], mask:number[], action, reward, done }

const fs = require('fs');
const path = require('path');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
const OUT_DIR = path.join(process.cwd(), 'dataset', 'transitions');
if (!fs.existsSync(EP_DIR)) { console.error('No episodes dir'); process.exit(1); }
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json'));
if (!files.length) { console.log('No episode files.'); process.exit(0); }

const outName = path.join(OUT_DIR, `transitions_${Date.now()}.jsonl`);
const out = fs.createWriteStream(outName, { flags: 'w' });
let count = 0;

for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(EP_DIR, f), 'utf8'));
    for (const step of data.steps || []) {
      out.write(JSON.stringify({ obs: step.obs, mask: step.mask, action: step.action, reward: step.reward, done: step.done }) + '\n');
      count++;
    }
  } catch (e) { /* ignore */ }
}

out.end(()=>{
  console.log('Wrote', count, 'transitions to', outName);
});
