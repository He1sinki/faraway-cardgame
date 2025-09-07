#!/usr/bin/env node
// Phase 3.4 - Exporte épisodes collectés vers format rollouts consommé par learner Python
// Produit: data/rollouts/episode_<game>_<player>_<ts>.jsonl
// Chaque ligne: {obs: base64(float32), mask: base64(uint8), action, logProb, value, reward, done, gameId, playerId, turn, episodeId}
// Action space normalisé: 256 (0..255). action = -1 si aucune.

const fs = require('fs');
const path = require('path');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
const OUT_DIR = path.join(process.cwd(), 'data', 'rollouts');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function toBase64Float32(arr){ const buf = Buffer.alloc(arr.length * 4); const view = new DataView(buf.buffer); arr.forEach((v,i)=> view.setFloat32(i*4, v, true)); return buf.toString('base64'); }
function toBase64Uint8(arr){ return Buffer.from(Uint8Array.from(arr)).toString('base64'); }

function buildMask(step){ // fixed 256 vector
  const m = new Array(256).fill(0);
  // If we have original mask length meaning playable slots for current hand, we cannot map back indices; we approximate by enabling first k slots
  if (Array.isArray(step.mask)) {
    for (let i=0;i<step.mask.length && i<256;i++) m[i] = step.mask[i] ? 1 : 0;
  }
  return m;
}

const files = fs.existsSync(EP_DIR) ? fs.readdirSync(EP_DIR).filter(f=> f.endsWith('.json')): [];
if (!files.length){ console.log('[export_rollouts] no episodes'); process.exit(0); }
let exported = 0;
for (const f of files){
  const full = path.join(EP_DIR, f);
  let data; try { data = JSON.parse(fs.readFileSync(full,'utf8')); } catch { continue; }
  const episodeId = `${data.gameId}_${data.playerId}_${data.createdAt}`;
  const outName = path.join(OUT_DIR, `episode_${episodeId}.jsonl`);
  if (fs.existsSync(outName)) continue; // skip already exported
  const stream = fs.createWriteStream(outName,'utf8');
  for (const step of data.steps || []){
    if (!Array.isArray(step.obs)) continue;
    const obsB64 = toBase64Float32(step.obs);
    const maskB64 = toBase64Uint8(buildMask(step));
    const line = {
      obs: obsB64,
      mask: maskB64,
      action: step.action == null ? -1 : step.action,
      logProb: -1.0,
      value: 0.0,
      reward: step.reward || 0,
      done: !!step.done,
      gameId: data.gameId,
      playerId: data.playerId,
      turn: step.info?.seq || 0,
      episodeId
    };
    stream.write(JSON.stringify(line)+'\n');
  }
  stream.end();
  exported++;
}
console.log('[export_rollouts] exported episodes:', exported);
