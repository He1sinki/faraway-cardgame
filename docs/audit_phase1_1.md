# Audit Phase 1.1 – Cartographie Code Serveur & Règles
Date: 2025-09-07

## Objectif
Identifier points de connexion client, événements réseau, règles implicites et dimensions des espaces de cartes.

## Fichiers Clés
- `index.js` : logique serveur Socket.IO (rooms, phases, transitions, scoring partiel).
- `class/cards.js` : définition statique des cartes régions & sanctuaires (dérivé de TypeScript compilé).

## Dimensions Jeu
- Nombre de régions (R): 77 (indices 0..76)
- Nombre de sanctuaires (S): 53 (tiles 1..53)
  - Noter: sanctuaries tile index commence à 1, pas 0. Encodage interne devra uniformiser (0-based) ou conserver offset.

## Cycle de Jeu & Phases
1. `play` : chaque joueur joue UNE carte de sa main. Tour 0: après jeux → `shop`. Tours suivants: après jeux → `sanctuary`.
2. `sanctuary` : joueurs éligibles (dernière carte > avant-dernière) tirent X sanctuaires (X = countMaps(p)+1) et en choisissent 1 (phase asynchrone). Quand tous résolus → `shop`.
3. `shop` : ordre déterminé par valeur de la dernière carte jouée (croissant). Chaque joueur choisit 1 carte. Fin → increment turn, si turn==8 → `end` sinon retour `play`.
4. `end` : calcul scores & gagnants.

## Événements Réseau Identifiés
### Sortants (serveur → clients)
- `wellConnected` (connexion initiale)
- `rooms` (liste salles)
- `joinedRoom` (id nouvelle salle créée)
- `roomJoined` (état salle après join)
- `roomFull`
- `roomStarted`
- `roomNotFound`
- `notEnoughPlayers`
- `beginGame`
- `update` (RoomState complet)

### Entrants (clients → serveur)
- `getRooms`
- `createRoom`
- `joinRoom` (payload: roomId string)
- `leaveRoom`
- `startGame` (payload: roomId)
- `playCard` (payload: index carte région)
- `shopChooseCard` (payload: index carte région)
- `sanctuaryChoose` (payload: index sanctuaire)

## Objets & Structures Dynamiques
- rooms[roomId]: {
  users: string[],
  state: bool,
  turn: number,
  phase: 'play'|'sanctuary'|'shop'|'end',
  pool: number[],
  sanctuaryPool: number[],
  players: { [socketId]: PlayerState },
  shop: number[],
  shopOrder: string[],
  winner: string[],
  score: ScoreEntry[]
}
- PlayerState: {
  hand: number[],
  sanctuaries: number[], // (pas utilisé dans logique courante)
  playedCards: number[],
  playedSanctuaries: number[],
  hasPlayed: bool,
  hasToChoose: bool,
  sanctuaryChoose: number[]
}

## Règles de Transition Implicites
- `beginGame` initialise le pool régions (0..R-1) et sanctuaires (0..S-1) puis donne 3 cartes main.
- `turn` commence à 0; partie se termine quand `turn == 8` après incrément post-shop.
- Passage `play`→`sanctuary` uniquement si `turn != 0`, sinon `play`→`shop`.
- Éligibilité sanctuaire: comparaison des deux dernières `playedCards` (strictement croissant).
- Nombre de sanctuaires proposés = countMaps(player)+1 où countMaps = (#clue dans playedSanctuaries + playedCards).
- Boutique: taille = min(poolRestant, max(3, nbJoueurs + 1)).
- Ordre sélection boutique = tri joueurs par dernière carte jouée (valeur croissante).

## Scoring (Vue partielle du code)
- Accumulation ressources: stone/chimera/thistle/clue/night/biomes.
- Sets dérivés: wonderSet = min(stone, chimera, thistle); colorSet = min(red, green, blue, yellow).
- Fame de chaque carte région considérée en ordre inverse joué (du 7 au 0) — importance probable de l'ordre.
- Fame conditions `quest`: validée via `checkQuest(total, quest)`.
- Sanctuaires ajoutent wonders, clues, biomes, night, puis fame.

## Points d'Attention pour RL
- L'ordre des cartes jouées influe sur scoring (traitement boucle j=7..0). Conserver séquence exacte.
- Comparaisons pour sanctuaire nécessitent >=2 cartes jouées (toujours vrai après tour 1).
- Condition éligibilité sanctuaire dépend de valeurs brutes (indices) pas d'attributs; augmentation monotone non garantie par design (c'est juste un numéro). Risque: stratégie exploitant distribution index → vérifier si indices reflètent puissance ou juste ID.

## Gaps & Inconnues
| Sujet | Commentaire | Action recommandée |
|-------|-------------|--------------------|
| Auth | Pas d'auth joueurs | Ajouter tokens ou signature plus tard |
| Timestamps | Manquants dans `update` | Injecter `serverTime` |
| protocolVersion | Manquant | Ajouter champ constant (ex: 1) |
| sanctuaries[] indexation | `tile` débute à 1 | Décider mapping 0-based pour RL |
| PlayerState.sanctuaries | Inutilisé | Retirer ou clarifier usage futur |
| Erreurs silencieuses | Aucune réponse sur action illégale | Ajouter log warning/action rejetée |

## Recommandations Immédiates (pré Phase 1.2)
1. Ajouter fonction utilitaire pour construire `RoomState` enrichi (timestamps + version) centralisée avant chaque `update`.
2. Logger toutes actions rejetées avec motif (`phaseMismatch`, `alreadyPlayed`, `invalidCard`).
3. Séparer calcul score dans module dédié (`game/scoring.js`) pour test unitaire.
4. Exposer endpoint debug (optionnel dev) pour forcer fin de partie & tester scoring.

## Données pour Espace d'État RL
- R=77 régions → vecteurs région dimension 77.
- S=53 sanctuaires → vecteurs sanctuaire dimension 53.
- Action space dimension brute (sans sanctuaire offset) = 2R + S + 1 = 2*77 + 53 + 1 = 208.

## Vérifications Proposées
- Test: après `beginGame` : chaque joueur a 3 cartes distinctes, pool = R - 3*J.
- Test: ordonnancement shop stable pour valeurs identiques? (actuel: sort stable JS? non garanti → clarifier). 
- Test: finishGame winner array longueur >=1.

Fin du document.
