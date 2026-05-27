const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let rooms = new Map();

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    socket.on('createRoom', (data) => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const room = {
            code, mode: data.mode, map: data.map,
            players: [{ id: socket.id, name: data.playerName, team: 'A', position: {x:0, y:2, z:0}, kills:0, score:0 }],
            isStarted: false
        };
        rooms.set(code, room);
        socket.join(code);
        socket.emit('roomCreated', { code, mode: data.mode, map: data.map });
    });

    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.code);
        if (room) {
            room.players.push({ id: socket.id, name: data.playerName, team: data.team, position: {x:Math.random()*10, y:2, z:Math.random()*10}, kills:0, score:0 });
            socket.join(data.code);
            io.to(data.code).emit('roomUpdated', room);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
