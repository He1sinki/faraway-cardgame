#!/usr/bin/env node
// Compresse les fichiers logs > 24h en .gz
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAW_DIR = path.join(process.cwd(), 'logs', 'raw');
if (!fs.existsSync(RAW_DIR)) process.exit(0);

const cutoff = Date.now() - 24 * 3600 * 1000;

for (const file of fs.readdirSync(RAW_DIR)) {
	if (file.endsWith('.gz')) continue;
	const full = path.join(RAW_DIR, file);
	const stat = fs.statSync(full);
	if (stat.mtimeMs < cutoff) {
		const gzPath = full + '.gz';
		if (fs.existsSync(gzPath)) continue;
		const inp = fs.createReadStream(full);
		const out = fs.createWriteStream(gzPath);
		const gz = zlib.createGzip();
		inp.pipe(gz).pipe(out).on('finish', () => {
			fs.unlinkSync(full);
			console.log('Compressed', file);
		});
	}
}
