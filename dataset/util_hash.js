// Stable hash for observation vectors (simple FNV-1a 32-bit)
function fnv1a(arr) {
	let h = 0x811c9dc5;
	for (let i = 0; i < arr.length; i++) {
		let x = Math.floor(arr[i] * 1000); // quantize to reduce floating noise
		h ^= x & 0xff; h = (h * 0x01000193) >>> 0;
		h ^= (x >>> 8) & 0xff; h = (h * 0x01000193) >>> 0;
		h ^= (x >>> 16) & 0xff; h = (h * 0x01000193) >>> 0;
		h ^= (x >>> 24) & 0xff; h = (h * 0x01000193) >>> 0;
	}
	return h >>> 0;
}
module.exports = { fnv1a };
