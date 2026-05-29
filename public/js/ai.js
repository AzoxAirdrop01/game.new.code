// ai.js - AZOX AI Bot System (VS Computer Mode)
import * as THREE from 'three';

const BOT_SETTINGS = {
    easy:   { speed:3.5, reactionMs:1200, accuracy:0.35, shootInterval:1800, viewRange:25 },
    medium: { speed:5.0, reactionMs:700,  accuracy:0.60, shootInterval:900,  viewRange:40 },
    hard:   { speed:7.0, reactionMs:250,  accuracy:0.85, shootInterval:400,  viewRange:60 }
};

const BOT_NAMES = [
    'Ghost','Viper','Hawk','Wolf','Reaper','Titan',
    'Nova','Storm','Blade','Raven','Specter','Iron'
];

// ═══════════════════════════════════════
// BOT CLASS
// ═══════════════════════════════════════
class Bot {
    constructor(id, position, difficulty, scene, models) {
        this.id         = id;
        this.name       = BOT_NAMES[id % BOT_NAMES.length];
        this.difficulty = difficulty;
        this.settings   = BOT_SETTINGS[difficulty] || BOT_SETTINGS.medium;
        this.scene      = scene;
        this.health     = 3;
        this.isAlive    = true;
        this.team       = null;

        // Movement
        this.position   = new THREE.Vector3(position.x, position.y, position.z);
        this.velocity   = new THREE.Vector3();
        this.targetPos  = new THREE.Vector3();
        this.yaw        = Math.random() * Math.PI * 2;

        // AI State Machine
        this.state      = 'patrol';  // patrol | chase | attack | cover | dead
        this.stateTimer = 0;
        this.patrolPoints = this._genPatrolPoints();
        this.patrolIndex  = 0;
        this.lastShotTime = 0;
        this.reactionTimer= 0;
        this.coverTimer   = 0;
        this.lastSeenPlayer = null;
        this.isAlert      = false;

        // Build mesh
        this.group = new THREE.Group();
        this._buildMesh(models);
        this.group.position.copy(this.position);
        scene.add(this.group);
    }

    _buildMesh(models) {
        // Character model
        const charModel = models?.get('character');
        if (charModel) {
            const clone = charModel.clone();
            clone.scale.setScalar(1.0);
            clone.traverse(n => {
                if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
            });
            this.group.add(clone);
        } else {
            // Fallback capsule
            const geo = new THREE.CapsuleGeometry(0.38, 1.3, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff2222 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = 0.65;
            mesh.castShadow = true;
            this.group.add(mesh);
        }

        // Red indicator dot
        const dotGeo = new THREE.SphereGeometry(0.14, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.dot = new THREE.Mesh(dotGeo, dotMat);
        this.dot.position.y = 2.5;
        this.group.add(this.dot);

        // Name sprite
        const canvas  = document.createElement('canvas');
        canvas.width  = 256; canvas.height = 64;
        const ctx     = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(180,0,0,0.7)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fff';
        ctx.font      = 'bold 26px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('[BOT] ' + this.name, 128, 42);
        const tex     = new THREE.CanvasTexture(canvas);
        const sprite  = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.scale.set(2.2, 0.55, 1);
        sprite.position.y = 3.1;
        this.group.add(sprite);
    }

    _genPatrolPoints() {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            pts.push(new THREE.Vector3(
                (Math.random() - 0.5) * 80,
                0,
                (Math.random() - 0.5) * 80
            ));
        }
        return pts;
    }

    takeDamage(dmg) {
        if (!this.isAlive) return;
        this.health -= dmg;
        if (this.health <= 0) {
            this.health = 0;
            this.isAlive = false;
            this.state = 'dead';
            this.group.visible = false;
        } else {
            this.state = 'cover';
            this.coverTimer = 1.5;
            this.isAlert = true;
        }
        return this.health <= 0;
    }

    update(dt, playerPos, onBotShoot) {
        if (!this.isAlive) return;

        this.stateTimer -= dt;

        const distToPlayer = this.position.distanceTo(playerPos);
        const canSeePlayer = distToPlayer < this.settings.viewRange;

        // State transitions
        if (canSeePlayer && this.state === 'patrol') {
            this.state      = 'chase';
            this.isAlert    = true;
            this.stateTimer = 0.5;
        }
        if (!canSeePlayer && (this.state === 'attack' || this.state === 'chase')) {
            if (this.stateTimer <= 0) {
                this.state      = 'patrol';
                this.stateTimer = 3;
            }
        }

        // State machine
        switch (this.state) {

            case 'patrol':
                this._doPatrol(dt);
                break;

            case 'chase':
                this._doChase(dt, playerPos);
                if (distToPlayer < 15) {
                    this.state      = 'attack';
                    this.stateTimer = 2;
                }
                break;

            case 'attack':
                this._doAttack(dt, playerPos, onBotShoot);
                if (distToPlayer > 20) {
                    this.state = 'chase';
                }
                break;

            case 'cover':
                this._doCover(dt);
                this.coverTimer -= dt;
                if (this.coverTimer <= 0) {
                    this.state = canSeePlayer ? 'attack' : 'patrol';
                }
                break;
        }

        // Apply position
        this.group.position.copy(this.position);
        this.group.rotation.y = this.yaw;

        // Dot faces camera (cosmetic)
        if (this.dot) this.dot.rotation.y = -this.group.rotation.y;
    }

    _doPatrol(dt) {
        const target = this.patrolPoints[this.patrolIndex];
        const dist   = this.position.distanceTo(target);

        if (dist < 2) {
            this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
            this.stateTimer  = 1 + Math.random() * 2; // pause
            return;
        }

        if (this.stateTimer > 0) return; // pausing

        this._moveToward(target, this.settings.speed * 0.6, dt);
    }

    _doChase(dt, playerPos) {
        this._moveToward(playerPos, this.settings.speed, dt);
    }

    _doAttack(dt, playerPos, onBotShoot) {
        // Strafe slightly while shooting
        const strafeAngle = this.yaw + Math.PI / 2;
        const strafe = new THREE.Vector3(
            Math.sin(strafeAngle) * Math.sin(Date.now() * 0.002),
            0,
            Math.cos(strafeAngle) * Math.sin(Date.now() * 0.002)
        );

        const toPlayer = playerPos.clone().sub(this.position).normalize();
        const move = toPlayer.multiplyScalar(0.5).add(strafe).normalize();
        this.position.addScaledVector(move, this.settings.speed * 0.4 * dt);
        this.position.x = Math.max(-58, Math.min(58, this.position.x));
        this.position.z = Math.max(-58, Math.min(58, this.position.z));

        // Face player
        const dx = playerPos.x - this.position.x;
        const dz = playerPos.z - this.position.z;
        this.yaw = Math.atan2(dx, dz);

        // Shoot with reaction time + accuracy
        const now = Date.now();
        if (now - this.lastShotTime > this.settings.shootInterval) {
            this.lastShotTime = now;

            // Accuracy check
            if (Math.random() < this.settings.accuracy) {
                onBotShoot?.(this, playerPos);
            }
        }
    }

    _doCover(dt) {
        // Move to a random nearby point
        if (!this._coverTarget || this.position.distanceTo(this._coverTarget) < 2) {
            this._coverTarget = new THREE.Vector3(
                this.position.x + (Math.random() - 0.5) * 20,
                0,
                this.position.z + (Math.random() - 0.5) * 20
            );
            this._coverTarget.x = Math.max(-55, Math.min(55, this._coverTarget.x));
            this._coverTarget.z = Math.max(-55, Math.min(55, this._coverTarget.z));
        }
        this._moveToward(this._coverTarget, this.settings.speed * 1.2, dt);
    }

    _moveToward(target, speed, dt) {
        const dir = new THREE.Vector3(
            target.x - this.position.x,
            0,
            target.z - this.position.z
        );
        const dist = dir.length();
        if (dist < 0.5) return;
        dir.normalize();

        this.yaw = Math.atan2(dir.x, dir.z);
        this.position.addScaledVector(dir, Math.min(speed * dt, dist));
        this.position.x = Math.max(-58, Math.min(58, this.position.x));
        this.position.z = Math.max(-58, Math.min(58, this.position.z));
    }

    getPosition() { return this.position.clone(); }

    dispose() {
        this.scene.remove(this.group);
    }
}

// ═══════════════════════════════════════
// AI MANAGER
// ═══════════════════════════════════════
export class AIManager {
    constructor(scene, models) {
        this.scene    = scene;
        this.models   = models;
        this.bots     = [];
        this.enabled  = false;
    }

    spawnBots(count, difficulty = 'medium') {
        this.enabled = true;
        this.bots.forEach(b => b.dispose());
        this.bots = [];

        const radius = 20;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const pos = {
                x: Math.cos(angle) * radius + (Math.random() - 0.5) * 10,
                y: 0,
                z: Math.sin(angle) * radius + (Math.random() - 0.5) * 10
            };
            this.bots.push(new Bot(i, pos, difficulty, this.scene, this.models));
        }
        console.log(`🤖 Spawned ${count} bots (${difficulty})`);
        return this.bots;
    }

    update(dt, playerPos, onBotShoot) {
        if (!this.enabled) return;
        this.bots.forEach(bot => {
            if (bot.isAlive) bot.update(dt, playerPos, onBotShoot);
        });
    }

    hitBot(botId, damage) {
        const bot = this.bots.find(b => b.id === botId);
        if (!bot) return false;
        return bot.takeDamage(damage);
    }

    getAliveCount() {
        return this.bots.filter(b => b.isAlive).length;
    }

    getBotData() {
        return this.bots.map(b => ({
            id:       b.id,
            name:     b.name,
            position: { x: b.position.x, y: b.position.y, z: b.position.z },
            health:   b.health,
            isAlive:  b.isAlive,
            isBot:    true,
            team:     null
        }));
    }

    dispose() {
        this.bots.forEach(b => b.dispose());
        this.bots = [];
    }
}
