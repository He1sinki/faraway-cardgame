// Phase 4.5 - Sérialisation transitions vers .npz (via simple format .npy concatené simulé)
// NOTE: Sans dépendance Python ici; on produit un dossier avec 3 fichiers binaires compatibles chargement numpy:
// obs.float32.bin, actions.int32.bin, rewards.float32.bin, masks.uint8.bin, dones.uint8.bin (plus meta.json)
// Un script Python pourra empaqueter en .npz si besoin.

const fs = require('fs');
const path = require('path');

class BinaryDatasetWriter {
	constructor(dir) {
		this.dir = dir;
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		this.obsFd = fs.openSync(path.join(dir, 'obs.float32.bin'), 'w');
		this.actionsFd = fs.openSync(path.join(dir, 'actions.int32.bin'), 'w');
		this.rewardsFd = fs.openSync(path.join(dir, 'rewards.float32.bin'), 'w');
		this.masksFd = fs.openSync(path.join(dir, 'masks.uint8.bin'), 'w');
		this.donesFd = fs.openSync(path.join(dir, 'dones.uint8.bin'), 'w');
		this.count = 0;
		this.obsDim = null;
		this.maskDim = null;
	}
	add({ obs, action, reward, done, mask }) {
		if (!Array.isArray(obs) || !Array.isArray(mask)) return;
		if (this.obsDim == null) this.obsDim = obs.length; else if (obs.length !== this.obsDim) return;
		if (this.maskDim == null) this.maskDim = mask.length; else if (mask.length !== this.maskDim) return;
		const obsBuf = Buffer.alloc(obs.length * 4);
		const dv = new DataView(obsBuf.buffer);
		obs.forEach((v, i) => dv.setFloat32(i * 4, v, true));
		fs.writeSync(this.obsFd, obsBuf);
		const actBuf = Buffer.alloc(4); new DataView(actBuf.buffer).setInt32(0, action | 0, true); fs.writeSync(this.actionsFd, actBuf);
		const rewBuf = Buffer.alloc(4); new DataView(rewBuf.buffer).setFloat32(0, reward, true); fs.writeSync(this.rewardsFd, rewBuf);
		const maskBuf = Buffer.from(Uint8Array.from(mask.map(x => x ? 1 : 0))); fs.writeSync(this.masksFd, maskBuf);
		const doneBuf = Buffer.from([done ? 1 : 0]); fs.writeSync(this.donesFd, doneBuf);
		this.count++;
	}
	close(metaExtra = {}) {
		fs.closeSync(this.obsFd); fs.closeSync(this.actionsFd); fs.closeSync(this.rewardsFd); fs.closeSync(this.masksFd); fs.closeSync(this.donesFd);
		const meta = { count: this.count, obsDim: this.obsDim, maskDim: this.maskDim, ...metaExtra };
		fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(meta, null, 2));
		return meta;
	}
}

module.exports = { BinaryDatasetWriter };
