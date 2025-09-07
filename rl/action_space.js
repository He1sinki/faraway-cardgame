// Phase 4.1 - Définition espace d'actions normalisé
// Dimensions réelles issues des données:
// R (regions) = 77, S (sanctuaries) = 53
// Mapping index:
//   0 .. R-1                => PLAY_i (phase 'play')
//   R .. 2R-1               => SHOP_i (phase 'shop')
//   2R .. 2R+S-1            => SANCT_j (phase 'sanctuary')
//   2R+S                    => NOOP
// Masque exporté: taille 256 pour compat compat (indices >= ACT_DIM remplis de 0)

const R = 77; // regions length
const S = 53; // sanctuaries length
const ACT_DIM = 2 * R + S + 1; // = 208
const PADDED_ACT_DIM = 256;    // masque final (restant zeros)

function playIndex(cardId) { return cardId; }
function shopIndex(cardId) { return R + cardId; }
function sanctIndex(tileId /* sanctuary tile number (1-based in data) */) { return 2 * R + (tileId - 1); }
const NOOP_INDEX = 2 * R + S; // 207

module.exports = {
	R, S, ACT_DIM, PADDED_ACT_DIM,
	playIndex, shopIndex, sanctIndex, NOOP_INDEX
};
