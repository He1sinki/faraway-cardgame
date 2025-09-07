// Test basique du wrapper NetworkEnv
// Lance un reset puis réalise quelques steps NOOP / aléatoires

const { NetworkEnv } = require('./env');

(async () => {
	const env = new NetworkEnv({ serverUrl: process.env.SERVER_URL || 'http://localhost:8080', timeoutMs: 7000, minPlayers: 1, fillWithDummies: 0 });
	console.log('[env-test] reset...');
	const { obs, mask, info } = await env.reset();
	console.log('[env-test] obs length=', obs.length, 'mask length=', mask.length, 'phase=', info.phase, 'seq=', info.stateSeq);
	for (let i = 0; i < 5; i++) {
		const legal = [];
		for (let k = 0; k < mask.length; k++) if (mask[k]) legal.push(k);
		const a = legal[Math.floor(Math.random() * legal.length)] ?? 0;
		const { obs: o2, mask: m2, reward, done, info: inf2 } = await env.step(a);
		console.log(`[env-test] step ${i} -> delta=${reward.toFixed(4)} return=${inf2.episodeReturn?.toFixed(4)} done=${done} phase=${inf2.phase} stalled=${inf2.stalled}`);
		if (done) break;
	}
	console.log('[env-test] terminé');
	process.exit(0);
})();
