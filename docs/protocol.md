# Protocole Réseau – Faraway Card Game

Version: 0.2 (draft)
Date: 2025-09-07

## Transport
WebSocket via Socket.IO (namespace par défaut). Toutes les émissions sont côté serveur sauf mention contraire.

## Connexion & Lobby
| Event (S->C) | Payload | Description |
|--------------|---------|-------------|
| `wellConnected` | none | Confirmation connexion socket. |
| `rooms` | `{ [roomId]: RoomSummary }` | Liste des salles en cours. |
| `joinedRoom` | `roomId: string` | Confirmation création et jointure d'une nouvelle salle. |
| `roomJoined` | `RoomState` | État complet après avoir rejoint. |
| `roomFull` | none | Salle pleine. |
| `roomStarted` | none | Partie déjà démarrée. |
| `roomNotFound` | none | Salle inexistante. |
| `notEnoughPlayers` | none | Tentative de démarrage sans assez de joueurs. |

| Event (C->S) | Payload | Description |
|--------------|---------|-------------|
| `getRooms` | none | Redemander la liste des salles. |
| `createRoom` | none | Crée une salle (id aléatoire). |
| `joinRoom` | `roomId: string` | Rejoindre salle existante. |
| `leaveRoom` | none | Quitter les salles où le client est. |
| `startGame` | `roomId: string` | Démarrer la partie. |

## Démarrage de Partie
| Event (S->C) | Payload | Description |
|--------------|---------|-------------|
| `beginGame` | `{ protocolVersion:number, serverTime:number }` | Signal initial; l'état détaillé suit via `update`. |
| `update` | `RoomState` | État jeu courant sérialisé (inclut `protocolVersion`, `serverTime`). |

## Interactions de Jeu
| Event (C->S) | Payload | Conditions | Effet |
|--------------|---------|------------|-------|
| `playCard` | `cardIndex: number` | Phase = `play`, carte en main, joueur pas encore joué | Joue carte, passe joueur à hasPlayed=true. |
| `shopChooseCard` | `cardIndex: number` | Phase = `shop`, joueur hasToChoose=true, carte dans shop | Ajoute carte à la main, avance ordre du shop. |
| `sanctuaryChoose` | `cardIndex: number` | Phase = `sanctuary`, joueur hasToChoose=true, carte dans sanctuaryChoose | Ajoute sanctuaire au board. |

## Modèle de Données
### RoomSummary
```ts
interface RoomSummary {
  users: string[]; // socket ids
  state: boolean;  // false avant début, true après beginGame (partie en cours ou terminée)
  maxPlayers?: number; // défaut 6
}
```

### RoomState
```ts
interface RoomState extends RoomSummary {
  protocolVersion: number;
  serverTime: number;      // epoch ms
  turn?: number;           // 0..7
  phase?: 'play' | 'sanctuary' | 'shop' | 'end';
  pool?: number[];         // indices régions restants
  sanctuaryPool?: number[];// indices sanctuaires restants
  players?: { [socketId: string]: PlayerState };
  shop?: number[];         // cartes proposées en boutique
  shopOrder?: string[];    // ordre de choix boutique (socket ids)
  winner?: string[];       // gagnants en fin de partie
  score?: ScoreEntry[];    // aligné avec users
}
```

### PlayerState
```ts
interface PlayerState {
  hand: number[];              // indices régions en main
  sanctuaries: number[];       // (non utilisé? placeholder)
  playedCards: number[];       // historique (8 cartes au final)
  playedSanctuaries: number[]; // sanctuaires acquis
  hasPlayed: boolean;          // a terminé l'action de phase
  hasToChoose: boolean;        // doit choisir (shop ou sanctuary)
  sanctuaryChoose: number[];   // propositions sanctuaires pendant phase sanctuary
}
```

### ScoreEntry
```ts
interface ScoreEntry {
  total: number;    // score total
  round: number[];  // détail par étape de calcul
}
```

## Phases
1. `play` : Chaque joueur joue une carte de sa main (sauf tour 0 pas de sanctuary avant). Quand tous ont joué -> (turn=0 ? shop : sanctuary).
2. `sanctuary` : Joueurs éligibles choisissent 1 sanctuaire parmi tirage (selon condition comparaison deux dernières cartes). Quand terminé -> shop.
3. `shop` : Ordre de choix basé sur valeur de la dernière carte jouée (croissant). Chaque joueur choisi 1 carte ou passe implicitement (hasPlayed). Quand tous ont choisi -> turn++ & retour `play` ou `end` si turn==8.
4. `end` : Scores calculés, winners définis.

## Règles Clés Inférées
- Partie se termine après `turn == 7` et passage final dans shop (ou direct end si condition atteinte). Code montre check sur `turn == 8` après incrément.
- Distribution initiale: 3 cartes régions par joueur.
- Boutique: `max(players+1,3)` cartes (capped par pool restant).
- Condition choix sanctuaire: dernière carte jouée strictement supérieure à l'avant-dernière.
- Score: accumulation wonders, clues, biomes, sets (wonderSet, colorSet) puis application de fame per.*

## Considérations pour Bot IA
- Doit maintenir un miroir local de `RoomState` basé sur derniers `update`.
- Action légale dépend de `phase`, flags `hasPlayed` / `hasToChoose`, appartenance de la carte à la collection pertinente (hand, shop, sanctuaryChoose).
- Aucune signature de message / auth pour l'instant (doit être durci plus tard).

## Limitations / Inconnues
- Pas de notion d'identité joueur autre que socket.id.
- Pas de persistance de partie après restart serveur.
- Pas d'horodatage serveur dans events (à ajouter pour logs déterministes).
- Pas de version protocole dans payload `update`.

## Changements Recommandés (Phase 1)
1. (FAIT 0.2) Ajouter `protocolVersion` dans chaque `update`.
2. (FAIT 0.2) Ajouter `serverTime` (ms epoch) dans chaque `update`.
3. Exposer explicitement `legalActions` côté client (optionnel; sinon reconstituer). 
4. Séparer `RoomSummary` vs `RoomState` en endpoints clairs.

---
Fin du document.
