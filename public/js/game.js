// game.js - AZOX World Battle Arena - FIXED (unpkg CDN + collision)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AIManager } from './ai.js';
import { MapGenerator } from './map_generator.js';

const MODEL_BASE = 'https://pub-d62c5438a9d849a8927a0de7c5b97de6.r2.dev/';

const MODELS = {
    ENVIRONMENTS: [
        { name: 'hangar',     file: 'free_fire_old_hangar_3d_model.glb' },
        { name: 'warehouse',  file: 'abandoned_warehouse.glb' },
        { name: 'warehouse2', file: 'destroyed_warehouse_in_kaarina_finland.glb' },
        { name: 'trench',     file: 'trench_set.glb' }
    ],
    BARRIERS: [
        { name: 'barrier_wood', file: 'barrier.glb' },
        { name: 'damaged_wall', file: 'damaged_wall.glb' },
        { name: 'jersey',       file: 'jersey_barrier.glb' },
        { name: 'wall_door',    file: 'wall_door_-_19mb.glb' },
        { name: 'barrier',      file: 'trench_set.glb' }
    ],
    CHARACTER: { name: 'character', file: 'character_type_tactical_man_1.glb' },
    WEAPONS: [
        { name: 'pistol', file: '9_mm.glb' },
        { name: 'ak',     file: 'ak-47_kalashnikov.glb' },
        { name: 'm4',     file: 'm4_carbine_rifle.glb' },
        { name: 'bkc',    file: 'm240b_machine_gun.glb' },
        { name: 'sniper', file: 'low-poly_dragunov_svd.glb' }
    ]
};

const WEAPON_STATS = {
    pistol: { name:'Pistol',       damage:1, fireRate:400,  ammo:12,  reload:1500, zoom:1,   spread:0.04 },
    ak:     { name:'AK-47',        damage:1, fireRate:150,  ammo:30,  reload:2500, zoom:1.5, spread:0.06 },
    m4:     { name:'M4 Carbine',   damage:1, fireRate:100,  ammo:30,  reload:2000, zoom:1.5, spread:0.03 },
    bkc:    { name:'BKC (M240B)',  damage:2, fireRate:70,   ammo:100, reload:4000, zoom:1,   spread:0.08 },
    sniper: { name:'Sniper (SVD)', damage:3, fireRate:1500, ammo:5,   reload:3500, zoom:6,   spread:0.005 }
};

class AZOXGame {
    constructor() {
        this.scene         = new THREE.Scene();
        this.clock         = new THREE.Clock();
        this.loader        = new GLTFLoader();
        this.models        = new Map();
        this.renderer      = null;
        this.camera        = null;
        this.socket        = window.gameSocket;
        this.remotePlayers = new Map();
        this.bullets       = [];
        this.collidables   = [];
        this.gameRunning   = false;
        this.gameMode      = null;
        this.mapTheme      = 'snow';
        this.elapsedTime   = 0;
        this.isScoped      = false;
        this.normalFOV     = 75;
        this.aiManager     = null;
        this.mapGenerator  = null;
        this.isMobile      = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.keys          = {};
        this.mouse         = { dx:0, dy:0, locked:false };
        this.joystick      = { moveX:0, moveZ:0, lookX:0, lookY:0 };
        this.mobileBtn     = { shoot:false, sprint:false, crouch:false, scope:false };
        this.raycaster     = new THREE.Raycaster();
        this._lastSendTime = 0;

        this.localPlayer = {
            id: null, name: 'Player', health: 3, maxHealth: 3,
            kills: 0, score: 0, team: null,
            position: new THREE.Vector3(0, 2, 0),
            yaw: 0, pitch: 0,
            isAlive: true, isCrouching: false, isSprinting: false,
            currentWeapon: 'pistol',
            weapons: ['pistol'],
            ammo: { pistol:12, ak:30, m4:30, bkc:100, sniper:5 },
            isReloading: false,
            lastFireTime: 0
        };

        this._initRenderer();
        this._initCamera();
        this._initLights();
        this._initControls();
        this._initSocketListeners();
        this._startLoadingScreen();
    }

    _initRenderer() {
        const canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference:'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace  = THREE.SRGBColorSpace;
        this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    _initCamera() {
        this.camera = new THREE.PerspectiveCamera(this.normalFOV, window.innerWidth/window.innerHeight, 0.05, 500);
        this.camera.position.set(0, 2, 0);
    }

    _initLights() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.dirLight.position.set(30, 60, 30);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.set(2048, 2048);
        this.dirLight.shadow.camera.near   = 0.5;
        this.dirLight.shadow.camera.far    = 300;
        this.dirLight.shadow.camera.left   = -80;
        this.dirLight.shadow.camera.right  = 80;
        this.dirLight.shadow.camera.top    = 80;
        this.dirLight.shadow.camera.bottom = -80;
        this.scene.add(this.dirLight);
    }

    _initControls() {
        document.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (!this.gameRunning) return;
            const wMap = { Digit1:'pistol', Digit2:'ak', Digit3:'m4', Digit4:'bkc', Digit5:'sniper' };
            if (wMap[e.code] && this.localPlayer.weapons.includes(wMap[e.code])) this._switchWeapon(wMap[e.code]);
            if (e.code === 'KeyR') this._reload();
            if (e.code === 'KeyF') this._toggleScope(true);
        });
        document.addEventListener('keyup', e => {
            this.keys[e.code] = false;
            if (e.code === 'KeyF') this._toggleScope(false);
        });
        document.addEventListener('mousemove', e => {
            if (this.mouse.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
        });
        document.addEventListener('mousedown', e => {
            if (!this.gameRunning) return;
            if (e.button === 0) this._tryShoot();
            if (e.button === 2) this._toggleScope(true);
        });
        document.addEventListener('mouseup', e => { if (e.button === 2) this._toggleScope(false); });
        document.addEventListener('contextmenu', e => e.preventDefault());
        const canvas = document.getElementById('game-canvas');
        canvas.addEventListener('click', () => { if (this.gameRunning && !this.isMobile) canvas.requestPointerLock(); });
        document.addEventListener('pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === canvas; });
    }

    _startLoadingScreen() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'flex';
        this._loadAllModels();
    }

    async _loadAllModels() {
        const allModels = [
            ...MODELS.ENVIRONMENTS,
            ...MODELS.BARRIERS,
            MODELS.CHARACTER,
            ...MODELS.WEAPONS
        ];

        let loaded = 0;
        const total = allModels.length;
        const bar = document.getElementById('loading-bar-fill');
        const txt = document.getElementById('loading-text');

        const loadOne = (m) => new Promise(resolve => {
            this.loader.load(
                MODEL_BASE + m.file,
                gltf => {
                    gltf.scene.traverse(node => {
                        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
                    });
                    this.models.set(m.name, gltf.scene);
                    loaded++;
                    const pct = Math.round((loaded / total) * 100);
                    if (bar) bar.style.width = pct + '%';
                    if (txt) txt.textContent = 'Loading ' + m.name + '... ' + pct + '%';
                    resolve();
                },
                null,
                err => {
                    console.warn('Skipped:', m.file, err.message);
                    this.models.set(m.name, new THREE.Group());
                    loaded++;
                    const pct = Math.round((loaded / total) * 100);
                    if (bar) bar.style.width = pct + '%';
                    if (txt) txt.textContent = 'Skipped ' + m.name + '... ' + pct + '%';
                    resolve();
                }
            );
        });

        // Load 3 at a time, max 25s timeout
        const loadAll = async () => {
            for (let i = 0; i < allModels.length; i += 3) {
                await Promise.all(allModels.slice(i, i + 3).map(loadOne));
            }
        };
        await Promise.race([loadAll(), new Promise(r => setTimeout(r, 25000))]);

        console.log('Models loaded:', [...this.models.keys()]);

        this.aiManager    = new AIManager(this.scene, this.models);
        this.mapGenerator = new MapGenerator(this.scene, this.models);

        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';

        this._animate();
        console.log('AZOX Ready');
    }

    buildMap(theme = 'snow') {
        this.mapTheme    = theme;
        this.collidables = this.mapGenerator ? this.mapGenerator.build(theme) : [];
        const themes = {
            snow:    { ambient:0xaaccff, dir:0xffffff },
            desert:  { ambient:0xffddaa, dir:0xffeebb },
            natural: { ambient:0x88cc88, dir:0xeeffee }
        };
        const t = themes[theme] || themes.snow;
        this.ambientLight.color.set(t.ambient);
        this.dirLight.color.set(t.dir);
        if (window.uiManager) {
            const names = { snow:'Snow Field', desert:'Desert Outpost', natural:'Forest Zone' };
            window.uiManager.showAnnouncement(names[theme] || theme, '#ffcc00', 3000);
        }
    }

    setPlayerId(id) { this.localPlayer.id = id; }

    spawnLocalPlayer(position, team) {
        this.localPlayer.position.set(position.x, position.y, position.z);
        this.localPlayer.health        = 3;
        this.localPlayer.isAlive       = true;
        this.localPlayer.team          = team;
        this.localPlayer.kills         = 0;
        this.localPlayer.score         = 0;
        this.localPlayer.currentWeapon = 'pistol';
        this.localPlayer.weapons       = ['pistol'];
        this.localPlayer.ammo          = { pistol:12, ak:30, m4:30, bkc:100, sniper:5 };
        this.localPlayer.yaw           = 0;
        this.localPlayer.pitch         = 0;
        this.camera.position.copy(this.localPlayer.position);
        this.camera.position.y += 1.6;
        if (window.uiManager) {
            window.uiManager.updateHealth(3, 3);
            window.uiManager.updateWeapon('Pistol', '12 / inf');
            window.uiManager.updateKillScore(0);
        }
    }

    addRemotePlayer(data) {
        if (data.id === this.localPlayer.id) return;
        if (this.remotePlayers.has(data.id)) return;
        const group = new THREE.Group();
        const charModel = this.models.get('character');
        if (charModel) {
            const clone = charModel.clone();
            clone.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            group.add(clone);
        } else {
            const geo = new THREE.CapsuleGeometry(0.4, 1.4, 4, 8);
            group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:0xff4444 })));
        }
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 8, 8),
            new THREE.MeshBasicMaterial({ color: (!data.team || data.team !== this.localPlayer.team) ? 0xff0000 : 0x00ff00 })
        );
        dot.position.y = 2.4;
        group.add(dot);

        // Name tag
        const nc = document.createElement('canvas');
        nc.width = 256; nc.height = 64;
        const ctx = nc.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(data.name || data.id.substring(0,6), 128, 42);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(nc), transparent: true }));
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 3.0;
        group.add(sprite);

        group.position.set(data.position?.x||0, data.position?.y||0, data.position?.z||0);
        this.scene.add(group);
        this.remotePlayers.set(data.id, {
            mesh: group, dot, data: { ...data },
            targetPos: new THREE.Vector3(data.position?.x||0, data.position?.y||0, data.position?.z||0),
            targetRot: new THREE.Quaternion()
        });
    }

    updateRemotePlayer(id, position, rotation) {
        const rp = this.remotePlayers.get(id);
        if (!rp) return;
        rp.targetPos.set(position.x, position.y, position.z);
        rp.targetRot.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    removeRemotePlayer(id) {
        const rp = this.remotePlayers.get(id);
        if (rp) { this.scene.remove(rp.mesh); this.remotePlayers.delete(id); }
    }

    _switchWeapon(name) {
        if (!this.localPlayer.weapons.includes(name) || this.localPlayer.isReloading) return;
        this.localPlayer.currentWeapon = name;
        const s = WEAPON_STATS[name];
        if (window.uiManager) window.uiManager.updateWeapon(s.name, this.localPlayer.ammo[name] + ' / inf');
        this.socket?.emit('weaponSwitch', { weapon: name });
        document.querySelectorAll('.wslot').forEach(sl => sl.classList.toggle('active', sl.dataset.w === name));
    }

    _tryShoot() {
        if (!this.gameRunning || !this.localPlayer.isAlive) return;
        const now = Date.now();
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];
        if (now - this.localPlayer.lastFireTime < stats.fireRate) return;
        if (this.localPlayer.ammo[weapon] <= 0) { this._reload(); return; }
        if (this.localPlayer.isReloading) return;

        this.localPlayer.lastFireTime = now;
        this.localPlayer.ammo[weapon]--;
        this._spawnMuzzleFlash();

        const spread = this.isScoped ? stats.spread * 0.2 : stats.spread;
        const rayDir = new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            -1
        );
        rayDir.transformDirection(this.camera.matrixWorld).normalize();
        this.raycaster.set(this.camera.position, rayDir);

        // Wall collision check — stop bullet if hits wall first
        let wallDist = Infinity;
        for (const box of this.collidables) {
            const hit = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, hit)) {
                const d = this.camera.position.distanceTo(hit);
                if (d < wallDist) wallDist = d;
            }
        }

        let hitPlayerId = null, minDist = Infinity;
        this.remotePlayers.forEach((rp, id) => {
            if (!rp.data.isAlive) return;
            const box = new THREE.Box3().setFromObject(rp.mesh);
            box.expandByScalar(0.3);
            const intersect = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, intersect)) {
                const dist = this.camera.position.distanceTo(intersect);
                if (dist < minDist && dist < wallDist) { minDist = dist; hitPlayerId = id; }
            }
        });

        this._spawnBulletTrail(this.camera.position.clone(), rayDir);
        this.socket?.emit('playerShoot', {
            position:  { x:this.camera.position.x, y:this.camera.position.y, z:this.camera.position.z },
            direction: { x:rayDir.x, y:rayDir.y, z:rayDir.z },
            weapon, hitPlayerId
        });

        if (this.aiManager?.enabled) this._checkBotHits(wallDist);
        if (window.uiManager) window.uiManager.updateWeapon(stats.name, this.localPlayer.ammo[weapon] + ' / inf');
        if (this.localPlayer.ammo[weapon] === 0) this._reload();
    }

    _reload() {
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];
        if (this.localPlayer.isReloading || this.localPlayer.ammo[weapon] === stats.ammo) return;
        this.localPlayer.isReloading = true;
        if (window.uiManager) window.uiManager.updateWeapon(stats.name, 'Reloading...');
        setTimeout(() => {
            this.localPlayer.ammo[weapon] = stats.ammo;
            this.localPlayer.isReloading  = false;
            if (window.uiManager) window.uiManager.updateWeapon(stats.name, stats.ammo + ' / inf');
        }, stats.reload);
    }

    _toggleScope(on) {
        if (!this.gameRunning) return;
        this.isScoped = on;
        const zoom = WEAPON_STATS[this.localPlayer.currentWeapon].zoom;
        const targetFOV = on ? (this.normalFOV / zoom) : this.normalFOV;
        const step = () => {
            const diff = targetFOV - this.camera.fov;
            if (Math.abs(diff) < 0.5) { this.camera.fov = targetFOV; this.camera.updateProjectionMatrix(); return; }
            this.camera.fov += diff * 0.2;
            this.camera.updateProjectionMatrix();
            requestAnimationFrame(step);
        };
        step();
        const so = document.getElementById('scope-overlay');
        if (so) so.style.display = (on && this.localPlayer.currentWeapon === 'sniper') ? 'block' : 'none';
    }

    _spawnMuzzleFlash() {
        const flash = new THREE.PointLight(0xffaa00, 8, 4);
        flash.position.copy(this.camera.position);
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 60);
    }

    _spawnBulletTrail(from, dir) {
        const to  = from.clone().addScaledVector(dir, 20);
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const mat = new THREE.LineBasicMaterial({ color:0xffff88, transparent:true, opacity:0.8 });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.bullets.push({ mesh:line, life:0.1 });
    }

    _showHitFlash() {
        const flash = document.getElementById('hit-flash');
        if (!flash) return;
        flash.style.opacity = '0.5';
        setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    _updateMovement(dt) {
        if (!this.gameRunning || !this.localPlayer.isAlive) return;

        if (this.mouse.locked) {
            this.localPlayer.yaw   -= this.mouse.dx * 0.002;
            this.localPlayer.pitch -= this.mouse.dy * 0.002;
            this.mouse.dx = 0; this.mouse.dy = 0;
        }
        if (this.isMobile) {
            this.localPlayer.yaw   -= this.joystick.lookX * dt * 2;
            this.localPlayer.pitch -= this.joystick.lookY * dt * 2;
        }
        this.localPlayer.pitch = Math.max(-1.4, Math.min(1.4, this.localPlayer.pitch));
        this.localPlayer.isSprinting = this.keys['ShiftLeft'] || this.mobileBtn.sprint;
        this.localPlayer.isCrouching = this.keys['ControlLeft'] || this.mobileBtn.crouch;

        let speed = 7 * dt;
        if (this.localPlayer.isSprinting) speed *= 1.7;
        if (this.localPlayer.isCrouching) speed *= 0.5;

        let mx = 0, mz = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    mz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  mz += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  mx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
        if (this.isMobile) { mx += this.joystick.moveX; mz += this.joystick.moveZ; }

        if (mx !== 0 || mz !== 0) {
            const fwd   = new THREE.Vector3(-Math.sin(this.localPlayer.yaw), 0, -Math.cos(this.localPlayer.yaw));
            const right = new THREE.Vector3(Math.cos(this.localPlayer.yaw),  0, -Math.sin(this.localPlayer.yaw));
            const move  = new THREE.Vector3();
            move.addScaledVector(fwd,  -mz * speed);
            move.addScaledVector(right, mx * speed);

            const newPos = this.localPlayer.position.clone().add(move);
            newPos.x = Math.max(-58, Math.min(58, newPos.x));
            newPos.z = Math.max(-58, Math.min(58, newPos.z));

            // Collision detection with walls/barriers
            const playerBox = new THREE.Box3(
                new THREE.Vector3(newPos.x - 0.4, newPos.y,       newPos.z - 0.4),
                new THREE.Vector3(newPos.x + 0.4, newPos.y + 1.8, newPos.z + 0.4)
            );
            let blocked = false;
            for (const col of this.collidables) {
                if (playerBox.intersectsBox(col)) { blocked = true; break; }
            }
            if (!blocked) this.localPlayer.position.copy(newPos);
        }

        const eyeH = this.localPlayer.isCrouching ? 1.0 : 1.6;
        const camT  = this.localPlayer.position.clone();
        camT.y += eyeH;
        this.camera.position.lerp(camT, 0.25);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.localPlayer.yaw;
        this.camera.rotation.x = this.localPlayer.pitch;

        if (Date.now() - this._lastSendTime > 50) {
            this._lastSendTime = Date.now();
            this.socket?.emit('playerMove', {
                position: { x:this.localPlayer.position.x, y:this.localPlayer.position.y, z:this.localPlayer.position.z },
                rotation: { x:this.camera.quaternion.x, y:this.camera.quaternion.y, z:this.camera.quaternion.z, w:this.camera.quaternion.w }
            });
        }
    }

    _updateBullets(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.life -= dt;
            if (b.vel) b.mesh.position.addScaledVector(b.vel, dt);
            if (b.mesh.material) b.mesh.material.opacity = Math.max(0, b.life * 3);
            if (b.life <= 0) {
                this.scene.remove(b.mesh);
                if (b.mesh.geometry) b.mesh.geometry.dispose();
                if (b.mesh.material) b.mesh.material.dispose();
                this.bullets.splice(i, 1);
            }
        }
    }

    _updateRemotePlayers() {
        this.remotePlayers.forEach(rp => {
            rp.mesh.position.lerp(rp.targetPos, 0.2);
            rp.mesh.quaternion.slerp(rp.targetRot, 0.2);
            if (rp.dot) rp.dot.lookAt(this.camera.position);
        });
    }

    _updateRadar() {
        if (!window.uiManager) return;
        const enemies = [];
        this.remotePlayers.forEach(rp => {
            if (!rp.data.isAlive) return;
            const isEnemy = !rp.data.team || rp.data.team !== this.localPlayer.team;
            enemies.push({ x:rp.mesh.position.x, z:rp.mesh.position.z, team: isEnemy ? 'enemy' : 'ally' });
        });
        window.uiManager.updateRadar({ x:this.localPlayer.position.x, z:this.localPlayer.position.z }, enemies);
    }

    _initSocketListeners() {
        const s = this.socket;
        if (!s) return;

        s.on('gameStarted', data => {
            this.gameRunning = true;
            this.gameMode    = data.mode;
            this.buildMap(data.config?.map || 'snow');
            data.players.forEach(p => {
                if (p.id === s.id) { this.localPlayer.id = s.id; this.spawnLocalPlayer(p.position, p.team); }
                else this.addRemotePlayer(p);
            });
            if (window.uiManager) window.uiManager.setHudVisibility(true);
        });

        s.on('playerMoved',   data => { if (data.id !== s.id) this.updateRemotePlayer(data.id, data.position, data.rotation); });
        s.on('playerLeft',    data => this.removeRemotePlayer(data.id || data));
        s.on('playerJoined',  player => this.addRemotePlayer(player));

        s.on('playerShot', data => {
            if (data.id !== s.id) {
                const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
                const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
                this._spawnBulletTrail(pos, dir);
            }
        });

        s.on('playerDamaged', data => {
            this.localPlayer.health = data.health;
            this._showHitFlash();
            if (window.uiManager) window.uiManager.updateHealth(data.health, 3);
            if (data.health <= 0) this._onLocalDeath();
        });

        s.on('playerEliminated', data => {
            if (data.eliminatedId === s.id) {
                this._onLocalDeath();
            } else {
                const rp = this.remotePlayers.get(data.eliminatedId);
                if (rp) { rp.data.isAlive = false; rp.mesh.visible = false; }
                if (data.killerId === s.id) {
                    this.localPlayer.kills++;
                    this.localPlayer.score += 4;
                    if (window.uiManager) {
                        window.uiManager.updateKillScore(this.localPlayer.kills);
                        window.uiManager.addKillFeedItem('You', data.killerName || '?', data.weapon);
                    }
                }
            }
        });

        s.on('playerHealthUpdate', data => {
            const rp = this.remotePlayers.get(data.id);
            if (rp) rp.data.health = data.health;
        });

        s.on('timerUpdate', data => {
            this.elapsedTime = data.elapsed;
            const m   = String(Math.floor(data.elapsed / 60)).padStart(2,'0');
            const sec = String(data.elapsed % 60).padStart(2,'0');
            if (window.uiManager) window.uiManager.updateTimer(m + ':' + sec);
        });

        s.on('gameOver', data => { this.gameRunning = false; this._showGameOver(data); });
    }

    _onLocalDeath() {
        this.localPlayer.isAlive = false;
        this.localPlayer.health  = 0;
        if (window.uiManager) window.uiManager.updateHealth(0, 3);
        const dead = document.getElementById('dead-overlay');
        if (dead) dead.style.display = 'flex';
    }

    _showGameOver(data) {
        const overlay = document.getElementById('gameover-overlay');
        if (!overlay) return;
        const title  = document.getElementById('gameover-title');
        const scores = document.getElementById('gameover-scores');
        if (title) title.textContent = data.winnerId === this.socket?.id ? 'YOU WIN!' : 'GAME OVER';
        if (scores && data.players) {
            scores.innerHTML = data.players
                .sort((a,b) => b.score - a.score)
                .map((p,i) => '<div class="score-row">' + (i+1) + '. ' + p.name + ' - ' + p.score + ' pts | ' + p.kills + ' kills</div>')
                .join('');
        }
        overlay.style.display = 'flex';
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this._updateMovement(dt);
        this._updateBullets(dt);
        this._updateRemotePlayers(dt);
        if (this.gameRunning) {
            this._updateRadar();
            if (this.aiManager?.enabled) {
                this.aiManager.update(dt, this.localPlayer.position, bot => this._onBotShoot(bot));
                this.aiManager.bots.forEach(bot => {
                    const rp = this.remotePlayers.get('bot_' + bot.id);
                    if (rp) { rp.targetPos.copy(bot.position); rp.data.isAlive = bot.isAlive; }
                });
            }
            const weapon = this.localPlayer.currentWeapon;
            if ((this.keys['MouseLeft'] || this.mobileBtn.shoot) &&
                (weapon === 'bkc' || weapon === 'ak' || weapon === 'm4')) this._tryShoot();
        }
        this.renderer.render(this.scene, this.camera);
    }

    spawnAIBots(count, difficulty) {
        if (!this.aiManager) return;
        const bots = this.aiManager.spawnBots(count, difficulty);
        bots.forEach(bot => {
            this.remotePlayers.set('bot_' + bot.id, {
                mesh: bot.group, dot: bot.dot,
                data: { id:'bot_'+bot.id, isAlive:true, team:null, name:bot.name },
                targetPos: bot.position.clone(), targetRot: new THREE.Quaternion()
            });
        });
        if (window.uiManager) window.uiManager.showAnnouncement(count + ' BOTS INCOMING', '#ff2233', 2500);
    }

    _onBotShoot(bot) {
        this._showHitFlash();
        this.localPlayer.health = Math.max(0, this.localPlayer.health - 1);
        if (window.uiManager) window.uiManager.updateHealth(this.localPlayer.health, 3);
        if (this.localPlayer.health <= 0) this._onLocalDeath();
    }

    _checkBotHits(wallDist = Infinity) {
        if (!this.aiManager) return;
        this.aiManager.bots.forEach(bot => {
            if (!bot.isAlive) return;
            const box = new THREE.Box3().setFromObject(bot.group).expandByScalar(0.3);
            const hit = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, hit)) {
                const dist = this.camera.position.distanceTo(hit);
                if (dist > wallDist) return; // wall blocks the shot
                const dead = bot.takeDamage(1);
                if (dead) {
                    this.localPlayer.kills++;
                    this.localPlayer.score += 4;
                    if (window.uiManager) {
                        window.uiManager.updateKillScore(this.localPlayer.kills);
                        window.uiManager.addKillFeedItem('You', bot.name, this.localPlayer.currentWeapon);
                    }
                    const rp = this.remotePlayers.get('bot_' + bot.id);
                    if (rp) rp.data.isAlive = false;
                    if (this.aiManager.getAliveCount() === 0) {
                        setTimeout(() => this._showGameOver({
                            winnerId: this.socket?.id,
                            players: [{ name:'You', score:this.localPlayer.score, kills:this.localPlayer.kills, id:this.socket?.id }]
                        }), 1500);
                    }
                }
            }
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const boot = () => {
        if (!window.gameSocket) { setTimeout(boot, 100); return; }
        window.gameEngine = new AZOXGame();
    };
    boot();
});
