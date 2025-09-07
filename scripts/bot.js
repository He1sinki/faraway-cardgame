#!/usr/bin/env node
// Placeholder bot client script (Phase 3 will implement logic)
// For now it only connects and logs room list.

const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';

const socket = io(SERVER_URL, { reconnection: true });

socket.on('connect', () => {
	console.log('[bot] connected', socket.id);
	socket.emit('getRooms');
});

socket.on('rooms', (rooms) => {
	console.log('[bot] rooms', Object.keys(rooms));
	// join or create first room for stub
	const existing = Object.keys(rooms).find(r => rooms[r].users && rooms[r].users.length < 4 && !rooms[r].state);
	if (existing) {
		socket.emit('joinRoom', existing);
	} else {
		socket.emit('createRoom');
	}
});

socket.on('joinedRoom', (id) => {
	console.log('[bot] created room', id);
});

socket.on('roomJoined', (state) => {
	console.log('[bot] joined room, users:', state.users.length);
	if (state.users.length >= 2) {
		// try start game (anyone can for now)
		setTimeout(() => socket.emit('startGame', state.roomId || Object.keys(state)[0]), 500);
	}
});

socket.on('beginGame', (info) => {
	console.log('[bot] game begin', info);
});

socket.on('update', (st) => {
	// stub: do nothing yet
});

socket.on('disconnect', () => console.log('[bot] disconnected'));
