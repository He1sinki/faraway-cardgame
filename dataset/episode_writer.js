// Episode writer accumulates transitions then flushes to disk.
// API:
// const w = new EpisodeWriter({ dir, gameId, playerId });
// w.add(step) where step = { obs, action, reward, done, info }
// w.close(finalInfo?)

const fs = require('fs');
const path = require('path');

class EpisodeWriter {
	constructor({ dir, gameId, playerId }) {
		this.dir = dir;
		this.gameId = gameId;
		this.playerId = playerId;
		this.buffer = [];
		this.startTs = Date.now();
	}
	add(step) { this.buffer.push(step); }
	close(finalInfo) {
		const out = {
			gameId: this.gameId,
			playerId: this.playerId,
			createdAt: this.startTs,
			finishedAt: Date.now(),
			steps: this.buffer,
			finalInfo: finalInfo || null
		};
		const file = path.join(this.dir, `${this.gameId}_${this.playerId}_${this.startTs}.json`);
		fs.writeFileSync(file, JSON.stringify(out));
		return file;
	}
}

module.exports = { EpisodeWriter };
