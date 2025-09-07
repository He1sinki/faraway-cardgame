# Définition Espace d'État & Actions – Faraway Card Game (Draft)
Version: 0.1
Date: 2025-09-07

## Objectif
Spécifier un encodage déterministe de l'état de jeu pour un agent RL + la liste des actions possibles & masques.

## Vue d'ensemble
Le jeu est multi-joueurs simultané par phases séquentielles. L'agent observe des informations publiques + ses propres cartes en main.

## Hypothèses (à valider)
- Pas d'information cachée autre que la main des adversaires et leurs choix futurs.
- Les indices de cartes (régions, sanctuaires) sont stables et peuvent être utilisés comme identifiants.

## Composants de l'État (Observation)
| Composant | Description | Type brut | Encodage proposé |
|-----------|-------------|-----------|------------------|
| phase | Phase courante (`play/sanctuary/shop/end`) | string | one-hot (4) |
| turn | Tour courant 0..7 | int | scalar normalisé (turn/7) |
| hand | Cartes régions en main du joueur | int[] | multi-hot vecteur taille R (nb régions) |
| playedCardsSelf | Séquence cartes jouées par soi | int[] (<=8) | multi-hot cumul + option embed historique ordonné (R x 8 one-hot) |
| playedCardsOthers | Dernières cartes jouées adversaires | int[] | moyenne / somme multi-hot + masques présence |
| shop | Cartes disponibles boutique | int[] | multi-hot R |
| sanctuaryChoices | Cartes sanctuaires offertes (si phase sanctuary) | int[] | multi-hot S (nb sanctuaires) |
| playedSanctuariesSelf | Sanctuaires acquis | int[] | multi-hot S |
| scoresPartial | Features dérivées (stone,chimera,thistle,clue,red,green,blue,yellow,colorless,night,wonderSet,colorSet) | obj | 12 scalars normalisés |
| hasToChoose | Flag décision en attente | bool | 1 bit |
| legalActionMask | Masque actions valides | bool[] | calculé séparé |

## Taille des Espaces
Soit R = nombre total de régions, S = nombre total sanctuaires.
Observation dense final = concat(
- phase:4, turn:1, scores:12, hasToChoose:1,
- hand:R, shop:R, playedSelf:R, playedOthers:R,
- sanctuaryChoices:S, playedSanctuariesSelf:S
) + éventuellement encodage historique (R*8) si besoin pour ordre.

## Actions
Deux familles selon la phase:
1. Phase `play`: jouer une carte de sa main. Action set = {PLAY_i | i in [0..R-1]}.
2. Phase `shop`: choisir une carte de la boutique. {SHOP_i | i in [0..R-1]} (seulement celles présentes).
3. Phase `sanctuary`: choisir un sanctuaire proposé. {SANCT_j | j in [0..S-1]}.
4. Option: NOOP (ou PASS) si design nécessite action stable (sinon masque exclut tout ce qui n'est pas valide).

Total dimension action = R (play) + R (shop) + S (sanctuary) + 1 (noop) = 2R + S + 1.

## Masque d'Actions
- Phase play: mask[PLAY_i]=1 si carte i dans hand & !hasPlayed.
- Phase shop: mask[SHOP_i]=1 si carte i dans shop & hasToChoose.
- Phase sanctuary: mask[SANCT_j]=1 si j dans sanctuaryChoices & hasToChoose.
- Always: mask[NOOP]=1 uniquement si aucune autre action valide (sécurité).

## Reward
- Reward terminal: +1 victoire, 0 égalité partagée, -1 défaite. Option scoring différentiel: (scoreSelf - mean(scoreOthers))/K.
- Reward intermédiaire (optionnel / expérimental): changeset sur sets (wonderSet/colorSet), acquisition sanctuaire clé. À activer plus tard.

## Normalisations
| Feature | Méthode |
|---------|---------|
| turn | /7 |
| counts (stone,etc.) | /cap hypothétique (ex: 10) clamp 0..1 |
| multi-hot | binaire 0/1 |

## Inconnues à clarifier
- R exact (taille `regions`).
- S exact (taille `sanctuaries`).
- Importance ordre des cartes jouées pour scoring futur (si oui, ajouter embedding séquentiel). 

## Format Sérialisation Transition
```json
{
  "obs": Float32Array,
  "action": int,
  "mask": Uint8Array,
  "logProb": float,
  "value": float,
  "reward": float,
  "done": bool,
  "meta": {"gameId": "...", "playerId": "...", "turn": 3}
}
```

## Hash Observation
Pour debug cohérence: `obsHash = sha1(rawBinary)` logué avec chaque décision.

## Étapes Suivantes
1. Extraire R & S réels depuis `cards.js` pour figer dimensions.
2. Implémenter encodeur (`rl/encode_state.py` ou `.js`).
3. Ajouter tests: même `RoomState` produit identique vecteur.
4. Bench taille & sparsité vecteur (objectif <10k floats). 

Fin du document.
