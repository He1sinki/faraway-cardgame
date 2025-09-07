#!/usr/bin/env node
// Phase 4.5 - Convertit episodes JSON -> format binaire (obs/actions/rewards/masks/dones) + meta.json

const fs = require('fs');
const path = require('path');
const { BinaryDatasetWriter } = require('../dataset/npz_writer');
const { encodeObservation } = require('../rl/encode_observation');
const { regions, sanctuaries } = require('../class/cards.js');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
const OUT_ROOT = path.join(process.cwd(), 'data', 'binary');
if (!fs.existsSync(OUT_ROOT)) fs.mkdirSync(OUT_ROOT, { recursive: true });

const ts = Date.now();
const OUT_DIR = path.join(OUT_ROOT, `batch_${ts}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const writer = new BinaryDatasetWriter(OUT_DIR);

const files = fs.readdirSync(EP_DIR).filter(f => f.endsWith('.json'));
let epCount = 0; let stepCount = 0;
for (const f of files) {
	let data; try { data = JSON.parse(fs.readFileSync(path.join(EP_DIR, f), 'utf8')); } catch { continue; }
	epCount++;
	for (const step of data.steps || []) {
		let obs = step.obs; let mask = step.mask;
		if (step.info?.rawState) {
			try { ({ obs, mask } = encodeObservation(step.info.rawState, data.playerId, regions, sanctuaries)); } catch { }
		}
		writer.add({ obs, action: step.action ?? -1, reward: step.reward || 0, done: !!step.done, mask });
		stepCount++;
	}
}
const meta = writer.close({ episodes: epCount, steps: stepCount, createdAt: ts });
console.log('[export_npz] batch complete', meta);
