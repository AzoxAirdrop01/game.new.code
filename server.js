const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const MODES = {
    FREE_FOR_ALL: 'FREE_FOR_ALL',
    TEAM_BATTLE: 'TEAM_BATTLE',
    VS_COMPUTER: 'VS_COMPUTER'
};

const TEAMS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

const POINTS = {
    KILL: 4,
    LAST_SURVIVOR: 50,
    WINNING_TEAM_SURVIVOR: 50,
    WINNING_TEAM_ELIMINATED: 15
};

const WEAPON_DAMAGE = {
    pistol: 1,
    ak: 1,
    m4: 1,
    bkc: 2,
    sniper: 3  // instant kill (health=3)
};

// ═══════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════
const rooms = new Map();

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); }
    while (rooms.has(code));
    return code;
}

function createRoom(mode, hostSocketId, config = {}) {
    const code = generateRoomCode();
    const room = {
        code,
        mode,
        status: 'WAITING',
        players: new Map(),
        config: {
            map: config.map || 'snow',
            difficulty: config.difficulty || 'medium'
        },
        scores: { teamScores: {}, playerScores: {} },
        hostId: hostSocketId,
        gameTimer: null,
        startTime: null
    };
    rooms.set(code, room);
    return room;
}

function getRoomBySocketId(socketId) {
    for (const room of rooms.values()) {
        if (room.players.has(socketId)) return room;
    }
    return null;
}

function getAlivePlayers(room) {
    return Array.from(room.players.values()).filter(p => p.health > 0);
}

function checkWinCondition(room) {
    if (room.status !== 'PLAYING') return;

    const alive = getAlivePlayers(room);

    if (room.mode === MODES.FREE_FOR_ALL) {
        if (alive.length <= 1) {
            const winner = alive[0] || null;
            if (winner) {
                room.scores.playerScores[winner.id] =
                    (room.scores.playerScores[winner.id] || 0) + POINTS.LAST_SURVIVOR;
            }
            endGame(room, winner ? winner.id : null);
        }
    } else if (room.mode === MODES.TEAM_BATTLE) {
        const aliveTeams = new Set(alive.map(p => p.team));
        if (aliveTeams.size <= 1) {
            const winningTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : null;
            endGame(room, null, winningTeam);
        }
    }
}

function endGame(room, winnerId = null, winningTeam = null) {
    room.status = 'ENDED';
    if (room.gameTimer) { clearInterval(room.gameTimer); room.gameTimer = null; }

    io.to(room.code).emit('gameOver', {
        winnerId,
        winningTeam,
        scores: room.scores,
        players: Array.from(room.players.values())
    });

    // Clean up room after 30 seconds
    setTimeout(() => { rooms.delete(room.code); }, 30000);
}

// ═══════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════
io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── CREATE ROOM ──────────────────────
    socket.on('createRoom', (data) => {
        const { mode, config, playerName } = data;
        if (!MODES[mode]) return socket.emit('error', 'Invalid game mode');

        const room = createRoom(mode, socket.id, config);

        const player = {
            id: socket.id,
            socketId: socket.id,
            name: playerName || `Player_${socket.id.substring(0,4)}`,
            roomId: room.code,
            team: mode === MODES.TEAM_BATTLE ? (data.team || 'A') : null,
            position: { x: 0, y: 2, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            health: 3,
            maxHealth: 3,
            score: 0,
            kills: 0,
            isBot: false,
            isAlive: true
        };

        room.players.set(socket.id, player);
        room.scores.playerScores[socket.id] = 0;
        socket.join(room.code);

        socket.emit('roomCreated', {
            code: room.code,
            player,
            players: Array.from(room.players.values()),
            config: room.config
        });
    });

    // ── JOIN ROOM ────────────────────────
    socket.on('joinRoom', (data) => {
        const { code, mode, team, playerName } = data;
        const room = rooms.get(code);

        if (!room) return socket.emit('error', 'Room not found');
        if (room.status !== 'WAITING') return socket.emit('error', 'Game already started');
        if (room.mode !== mode) return socket.emit('error', 'Wrong game mode for this room');
        if (mode === MODES.TEAM_BATTLE && team && !TEAMS.includes(team))
            return socket.emit('error', 'Invalid team');

        const spawnIndex = room.players.size;
        const spawnPositions = [
            {x:0,y:2,z:0},{x:5,y:2,z:5},{x:-5,y:2,z:5},
            {x:5,y:2,z:-5},{x:-5,y:2,z:-5},{x:10,y:2,z:0}
        ];
        const spawnPos = spawnPositions[spawnIndex % spawnPositions.length];

        const player = {
            id: socket.id,
            socketId: socket.id,
            name: playerName || `Player_${socket.id.substring(0,4)}`,
            roomId: room.code,
            team: mode === MODES.TEAM_BATTLE ? (team || 'A') : null,
            position: spawnPos,
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            health: 3,
            maxHealth: 3,
            score: 0,
            kills: 0,
            isBot: false,
            isAlive: true
        };

        room.players.set(socket.id, player);
        room.scores.playerScores[socket.id] = 0;
        socket.join(room.code);

        socket.emit('roomJoined', {
            code: room.code,
            player,
            players: Array.from(room.players.values()),
            config: room.config
        });

        socket.to(room.code).emit('playerJoined', player);
    });

    // ── START GAME ───────────────────────
    socket.on('startGame', (code) => {
        const room = rooms.get(code);
        if (!room) return;
        if (room.hostId !== socket.id) return socket.emit('error', 'Only host can start');
        if (room.status !== 'WAITING') return;

        room.status = 'PLAYING';
        room.startTime = Date.now();

        // Assign spawn positions to all players
        const players = Array.from(room.players.values());
        const spawns = generateSpawnPositions(players.length);
        players.forEach((p, i) => {
            p.position = spawns[i];
            room.players.set(p.id, p);
        });

        io.to(room.code).emit('gameStarted', {
            players: Array.from(room.players.values()),
            config: room.config,
            mode: room.mode
        });

        // Game timer - emit every second
        room.gameTimer = setInterval(() => {
            if (room.status !== 'PLAYING') {
                clearInterval(room.gameTimer);
                return;
            }
            const elapsed = Math.floor((Date.now() - room.startTime) / 1000);
            io.to(room.code).emit('timerUpdate', { elapsed });
        }, 1000);
    });

    // ── PLAYER MOVEMENT ──────────────────
    socket.on('playerMove', (data) => {
        const room = getRoomBySocketId(socket.id);
        if (!room || room.status !== 'PLAYING') return;

        const player = room.players.get(socket.id);
        if (!player || !player.isAlive) return;

        player.position = data.position;
        player.rotation = data.rotation;

        socket.to(room.code).emit('playerMoved', {
            id: socket.id,
            position: data.position,
            rotation: data.rotation,
            animState: data.animState || 'idle'
        });
    });

    // ── PLAYER SHOOT ─────────────────────
    socket.on('playerShoot', (data) => {
        const room = getRoomBySocketId(socket.id);
        if (!room || room.status !== 'PLAYING') return;

        const shooter = room.players.get(socket.id);
        if (!shooter || !shooter.isAlive) return;

        // Broadcast shoot event to others (for visual effect)
        socket.to(room.code).emit('playerShot', {
            id: socket.id,
            position: data.position,
            direction: data.direction,
            weapon: data.weapon
        });

        // Server-side hit detection
        if (data.hitPlayerId) {
            const target = room.players.get(data.hitPlayerId);
            if (!target || !target.isAlive) return;

            const damage = WEAPON_DAMAGE[data.weapon] || 1;
            const isSniper = data.weapon === 'sniper';
            const actualDamage = isSniper ? 3 : damage;

            target.health = Math.max(0, target.health - actualDamage);

            if (target.health <= 0) {
                target.isAlive = false;
                target.health = 0;

                // Award points
                shooter.kills += 1;
                shooter.score += POINTS.KILL;
                room.scores.playerScores[socket.id] =
                    (room.scores.playerScores[socket.id] || 0) + POINTS.KILL;

                io.to(room.code).emit('playerEliminated', {
                    eliminatedId: data.hitPlayerId,
                    killerId: socket.id,
                    killerName: shooter.name,
                    weapon: data.weapon
                });

                checkWinCondition(room);
            } else {
                // Send damage to target
                io.to(data.hitPlayerId).emit('playerDamaged', {
                    attackerId: socket.id,
                    damage: actualDamage,
                    health: target.health,
                    weapon: data.weapon
                });

                // Broadcast health update to room
                io.to(room.code).emit('playerHealthUpdate', {
                    id: data.hitPlayerId,
                    health: target.health
                });
            }
        }
    });

    // ── WEAPON SWITCH ────────────────────
    socket.on('weaponSwitch', (data) => {
        const room = getRoomBySocketId(socket.id);
        if (!room) return;
        socket.to(room.code).emit('playerWeaponSwitch', {
            id: socket.id,
            weapon: data.weapon
        });
    });

    // ── DISCONNECT ───────────────────────
    socket.on('disconnect', () => {
        const room = getRoomBySocketId(socket.id);
        if (room) {
            room.players.delete(socket.id);
            io.to(room.code).emit('playerLeft', { id: socket.id });

            if (room.players.size === 0) {
                if (room.gameTimer) clearInterval(room.gameTimer);
                rooms.delete(room.code);
                console.log(`[x] Room ${room.code} deleted (empty)`);
            } else if (room.hostId === socket.id) {
                const newHostId = Array.from(room.players.keys())[0];
                room.hostId = newHostId;
                io.to(room.code).emit('newHost', { id: newHostId });
            }

            if (room.status === 'PLAYING') checkWinCondition(room);
        }
        console.log(`[-] Disconnected: ${socket.id}`);
    });

    // ── PING ─────────────────────────────
    socket.on('ping', () => socket.emit('pong', { time: Date.now() }));
});

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function generateSpawnPositions(count) {
    const positions = [];
    const radius = 15;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions.push({
            x: Math.cos(angle) * radius,
            y: 2,
            z: Math.sin(angle) * radius
        });
    }
    return positions;
}

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════
server.listen(PORT, () => {
    console.log(`\n🎮 AZOX World Battle Arena`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Open: http://localhost:${PORT}\n`);
});
