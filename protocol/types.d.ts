// Protocol Type Definitions (Phase 1.2)
// Versioned game state interfaces for Faraway Card Game

export interface PlayerState {
	hand: number[];
	sanctuaries: number[]; // currently unused placeholder
	playedCards: number[];
	playedSanctuaries: number[];
	hasPlayed: boolean;
	hasToChoose: boolean;
	sanctuaryChoose: number[];
}

export interface ScoreEntry {
	total: number;
	round: number[];
}

export interface RoomSummary {
	users: string[];
	state: boolean; // false before game start, true once started or finished
	maxPlayers?: number;
}

export type Phase = 'play' | 'sanctuary' | 'shop' | 'end';

export interface RoomState extends RoomSummary {
	protocolVersion: number;
	serverTime: number; // epoch ms
	turn?: number;
	phase?: Phase;
	pool?: number[];
	sanctuaryPool?: number[];
	players?: { [socketId: string]: PlayerState };
	shop?: number[];
	shopOrder?: string[];
	winner?: string[];
	score?: ScoreEntry[];
}

export interface UpdateMessage extends RoomState { }
