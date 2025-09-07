#!/usr/bin/env node
// Gzip tous les fichiers d'épisodes non encore compressés
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EP_DIR = path.join(process.cwd(), 'dataset', 'episodes');
if (!fs.existsSync(EP_DIR)) process.exit(0);

for (const f of fs.readdirSync(EP_DIR)) {
	if (!f.endsWith('.json')) continue;
	const full = path.join(EP_DIR, f);
	const gzPath = full + '.gz';
	if (fs.existsSync(gzPath)) continue;
	const data = fs.readFileSync(full);
	const gz = zlib.gzipSync(data);
	fs.writeFileSync(gzPath, gz);
	console.log('Compressed', f, '->', path.basename(gzPath));
}
