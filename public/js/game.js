// game.js - AZOX World Battle Arena - Main Game Engine
import * as THREE from 'https://cdn.skypack.dev/three@0.150.1';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.150.1/examples/jsm/loaders/GLTFLoader.js';
import { AIManager } from './ai.js';
import { MapGenerator } from './map_generator.js';

// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const MODEL_BASE = './models/';

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
        { name: 'pistol',  file: '9_mm.glb' },
        { name: 'ak',      file: 'ak-47_kalashnikov.glb' },
        { name: 'm4',      file: 'm4_carbine_rifle.glb' },
        { name: 'bkc',     file: 'm240b_machine_gun.glb' },
        { name: 'sniper',  file: 'low-poly_dragunov_svd.glb' }
    ]
};

const WEAPON_STATS = {
    pistol: { name:'Pistol',        damage:1, fireRate:400,  ammo:12,  reload:1500, zoom:1,   isSniper:false, spread:0.04 },
    ak:     { name:'AK-47',         damage:1, fireRate:150,  ammo:30,  reload:2500, zoom:1.5, isSniper:false, spread:0.06 },
    m4:     { name:'M4 Carbine',    damage:1, fireRate:100,  ammo:30,  reload:2000, zoom:1.5, isSniper:false, spread:0.03 },
    bkc:    { name:'BKC (M240B)',   damage:2, fireRate:70,   ammo:100, reload:4000, zoom:1,   isSniper:false, spread:0.08 },
    sniper: { name:'Sniper (SVD)',  damage:3, fireRate:1500, ammo:5,   reload:3500, zoom:6,   isSniper:true,  spread:0.005 }
};

const MAP_THEMES = {
    snow:    { sky:0xc8dff0, fog:0xc8dff0, fogNear:40, fogFar:150, ground:0xe8f4f8, ambient:0xaaccff, dir:0xffffff },
    desert:  { sky:0xe8c87a, fog:0xdeb887, fogNear:50, fogFar:180, ground:0xc8a855, ambient:0xffddaa, dir:0xffeebb },
    natural: { sky:0x4a7c59, fog:0x5a8a69, fogNear:30, fogFar:120, ground:0x3a6b3a, ambient:0x88cc88, dir:0xffffff }
};

// ═══════════════════════════════════════
// GAME CLASS
// ═══════════════════════════════════════
class AZOXGame {
    constructor() {
        this.scene       = new THREE.Scene();
        this.clock       = new THREE.Clock();
        this.loader      = new GLTFLoader();
        this.models      = new Map();
        this.renderer    = null;
        this.camera      = null;
        this.socket      = window.gameSocket;

        // Player state
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

        // Remote players
        this.remotePlayers = new Map(); // id -> { mesh, nameTag, healthDot, data }

        // Input
        this.keys       = {};
        this.mouse      = { dx:0, dy:0, locked:false };
        this.isMobile   = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.joystick   = { moveX:0, moveZ:0, lookX:0, lookY:0 };
        this.mobileBtn  = { shoot:false, sprint:false, crouch:false, scope:false };

        // Game state
        this.gameRunning  = false;
        this.gameMode     = null;
        this.roomCode     = null;
        this.mapTheme     = 'snow';
        this.elapsedTime  = 0;

        // Shooting
        this.raycaster    = new THREE.Raycaster();
        this.bullets      = [];
        this.muzzleFlashTimeout = null;

        // Collidable objects for simple collision
        this.collidables  = [];
        this.groundY      = 0;

        // Crosshair / scope
        this.isScoped     = false;
        this.normalFOV    = 75;
        this.scopedFOV    = 20;

        // AI & Map subsystems (initialized after models load)
        this.aiManager    = null;
        this.mapGenerator = null;

        this._initRenderer();
        this._initCamera();
        this._initLights();
        this._initControls();
        this._initSocketListeners();
        this._startLoadingScreen();
    }

    // ─────────────────────────────────────
    // INIT
    // ─────────────────────────────────────
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
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far  = 300;
        this.dirLight.shadow.camera.left = -80;
        this.dirLight.shadow.camera.right = 80;
        this.dirLight.shadow.camera.top  = 80;
        this.dirLight.shadow.camera.bottom = -80;
        this.scene.add(this.dirLight);
    }

    _initControls() {
        // Keyboard
        document.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (!this.gameRunning) return;

            // Weapon switch
            const wMap = {Digit1:'pistol',Digit2:'ak',Digit3:'m4',Digit4:'bkc',Digit5:'sniper'};
            if (wMap[e.code] && this.localPlayer.weapons.includes(wMap[e.code])) {
                this._switchWeapon(wMap[e.code]);
            }
            if (e.code === 'KeyR') this._reload();
            if (e.code === 'KeyF') this._toggleScope(true);
        });

        document.addEventListener('keyup', e => {
            this.keys[e.code] = false;
            if (e.code === 'KeyF') this._toggleScope(false);
        });

        // Mouse
        document.addEventListener('mousemove', e => {
            if (this.mouse.locked) {
                this.mouse.dx += e.movementX;
                this.mouse.dy += e.movementY;
            }
        });

        document.addEventListener('mousedown', e => {
            if (!this.gameRunning) return;
            if (e.button === 0) this._tryShoot();
            if (e.button === 2) this._toggleScope(true);
        });

        document.addEventListener('mouseup', e => {
            if (e.button === 2) this._toggleScope(false);
        });

        document.addEventListener('contextmenu', e => e.preventDefault());

        // Pointer Lock
        const canvas = document.getElementById('game-canvas');
        canvas.addEventListener('click', () => {
            if (this.gameRunning && !this.isMobile) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.mouse.locked = document.pointerLockElement === canvas;
        });
    }

    // ─────────────────────────────────────
    // LOADING
    // ─────────────────────────────────────
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
        const bar   = document.getElementById('loading-bar-fill');
        const txt   = document.getElementById('loading-text');

        const loadOne = (m) => new Promise(resolve => {
            this.loader.load(
                MODEL_BASE + m.file,
                gltf => {
                    // Enable shadows on all meshes
                    gltf.scene.traverse(node => {
                        if (node.isMesh) {
                            node.castShadow    = true;
                            node.receiveShadow = true;
                            if (node.material) {
                                node.material.envMapIntensity = 0.5;
                            }
                        }
                    });
                    this.models.set(m.name, gltf.scene);
                    loaded++;
                    const pct = Math.round((loaded / total) * 100);
                    if (bar) bar.style.width = pct + '%';
                    if (txt) txt.textContent = `Loading ${m.name}... ${pct}%`;
                    resolve();
                },
                null,
                err => {
                    console.warn(`⚠️ Could not load ${m.file}:`, err.message);
                    // Use empty group as placeholder so game doesn't crash
                    this.models.set(m.name, new THREE.Group());
                    loaded++;
                    const pct = Math.round((loaded / total) * 100);
                    if (bar) bar.style.width = pct + '%';
                    resolve();
                }
            );
        });

        // Load in parallel with 20s timeout
const loadAll = async () => {
    for (let i = 0; i < allModels.length; i += 5) {
        await Promise.all(allModels.slice(i, i+5).map(loadOne));
    }
};
await Promise.race([
    loadAll(),
    new Promise(r => setTimeout(r, 20000))
]);

await Promise.race([loadPromise, timeoutPromise]);
        

        console.log('✅ All models loaded:', [...this.models.keys()]);

        // Initialize subsystems
        this.aiManager    = new AIManager(this.scene, this.models);
        this.mapGenerator = new MapGenerator(this.scene, this.models);

        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';

        // Start render loop
        this._animate();
        console.log('🎮 AZOX Game Engine Ready');
    }

    // ─────────────────────────────────────
    // MAP GENERATION (delegates to MapGenerator)
    // ─────────────────────────────────────
    buildMap(theme = 'snow') {
        this.mapTheme  = theme;
        this.collidables = this.mapGenerator
            ? this.mapGenerator.build(theme)
            : [];

        // Sync lights to theme
        const themes = {
            snow:    { ambient: 0xaaccff, dir: 0xffffff },
            desert:  { ambient: 0xffddaa, dir: 0xffeebb },
            natural: { ambient: 0x88cc88, dir: 0xeeffee }
        };
        const t = themes[theme] || themes.snow;
        this.ambientLight.color.set(t.ambient);
        this.dirLight.color.set(t.dir);

        if (window.uiManager) {
            const names = { snow:'❄️ Snow Field', desert:'🏜️ Desert Outpost', natural:'🌿 Forest Zone' };
            window.uiManager.showAnnouncement(names[theme] || theme, '#ffcc00', 3000);
        }

        console.log(`🗺️ Map built: ${theme}`);
    }

    // ─────────────────────────────────────
    // PLAYER MANAGEMENT
    // ─────────────────────────────────────
    spawnLocalPlayer(position, team) {
        this.localPlayer.position.set(position.x, position.y, position.z);
        this.localPlayer.health    = 3;
        this.localPlayer.isAlive   = true;
        this.localPlayer.team      = team;
        this.localPlayer.kills     = 0;
        this.localPlayer.score     = 0;
        this.localPlayer.currentWeapon = 'pistol';
        this.localPlayer.weapons   = ['pistol'];
        this.localPlayer.ammo      = { pistol:12, ak:30, m4:30, bkc:100, sniper:5 };
        this.localPlayer.yaw       = 0;
        this.localPlayer.pitch     = 0;

        this.camera.position.copy(this.localPlayer.position);
        this.camera.position.y += 1.6;

        if (window.uiManager) {
            window.uiManager.updateHealth(3, 3);
            window.uiManager.updateWeapon('Pistol', '12 / ∞');
            window.uiManager.updateKillScore(0);
        }
    }

    addRemotePlayer(data) {
        if (data.id === this.localPlayer.id) return;
        if (this.remotePlayers.has(data.id)) return;

        const group = new THREE.Group();

        // Character model
        const charModel = this.models.get('character');
        if (charModel) {
            const clone = charModel.clone();
            clone.scale.setScalar(1.0);
            clone.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            group.add(clone);
        } else {
            // Fallback capsule
            const geo = new THREE.CapsuleGeometry(0.4, 1.4, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: data.team ? 0x4488ff : 0xff4444 });
            group.add(new THREE.Mesh(geo, mat));
        }

        // Floating dot indicator
        const dotGeo = new THREE.SphereGeometry(0.12, 8, 8);
        const isEnemy = !data.team || data.team !== this.localPlayer.team;
        const dotMat = new THREE.MeshBasicMaterial({ color: isEnemy ? 0xff0000 : 0x00ff00 });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.y = 2.4;
        group.add(dot);

        // Name tag (sprite)
        const canvas = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle   = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle   = '#ffffff';
        ctx.font        = 'bold 28px Arial';
        ctx.textAlign   = 'center';
        ctx.fillText(data.name || data.id.substring(0,6), 128, 42);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 3.0;
        group.add(sprite);

        // Position
        group.position.set(
            data.position?.x || 0,
            data.position?.y || 0,
            data.position?.z || 0
        );

        this.scene.add(group);
        this.remotePlayers.set(data.id, {
            mesh: group,
            dot,
            data: { ...data },
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
        if (rp) {
            this.scene.remove(rp.mesh);
            this.remotePlayers.delete(id);
        }
    }

    // ─────────────────────────────────────
    // WEAPON SYSTEM
    // ─────────────────────────────────────
    _switchWeapon(weaponName) {
        if (!this.localPlayer.weapons.includes(weaponName)) return;
        if (this.localPlayer.isReloading) return;
        this.localPlayer.currentWeapon = weaponName;
        const stats = WEAPON_STATS[weaponName];
        if (window.uiManager) {
            window.uiManager.updateWeapon(
                stats.name,
                `${this.localPlayer.ammo[weaponName]} / ∞`
            );
        }
        this.socket?.emit('weaponSwitch', { weapon: weaponName });
    }

    _tryShoot() {
        if (!this.gameRunning || !this.localPlayer.isAlive) return;

        const now    = Date.now();
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];

        if (now - this.localPlayer.lastFireTime < stats.fireRate) return;
        if (this.localPlayer.ammo[weapon] <= 0) { this._reload(); return; }
        if (this.localPlayer.isReloading) return;

        this.localPlayer.lastFireTime = now;
        this.localPlayer.ammo[weapon]--;

        // Muzzle flash
        this._spawnMuzzleFlash();

        // Raycast hit detection
        const spread = this.isScoped ? stats.spread * 0.2 : stats.spread;
        const dir = new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            -1
        ).normalize();

        this.camera.localToWorld(dir.clone());

        // Build ray from camera center
        const rayDir = new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            -1
        );
        rayDir.transformDirection(this.camera.matrixWorld).normalize();

        this.raycaster.set(this.camera.position, rayDir);

        // Check remote players
        let hitPlayerId = null;
        let minDist = Infinity;

        this.remotePlayers.forEach((rp, id) => {
            if (!rp.data.isAlive) return;
            const box = new THREE.Box3().setFromObject(rp.mesh);
            box.expandByScalar(0.3);
            const intersect = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, intersect)) {
                const dist = this.camera.position.distanceTo(intersect);
                if (dist < minDist) { minDist = dist; hitPlayerId = id; }
            }
        });

        // Spawn visual bullet
        this._spawnBulletTrail(this.camera.position.clone(), rayDir);

        // Emit to server
        this.socket?.emit('playerShoot', {
            position:    { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
            direction:   { x: rayDir.x, y: rayDir.y, z: rayDir.z },
            weapon,
            hitPlayerId
        });

        // Check bot hits (VS Computer)
        if (this.aiManager?.enabled) this._checkBotHits();

        // Update ammo HUD
        if (window.uiManager) {
            window.uiManager.updateWeapon(
                stats.name,
                `${this.localPlayer.ammo[weapon]} / ∞`
            );
        }

        // Auto-reload
        if (this.localPlayer.ammo[weapon] === 0) this._reload();
    }

    _reload() {
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];
        if (this.localPlayer.isReloading) return;
        if (this.localPlayer.ammo[weapon] === stats.ammo) return;

        this.localPlayer.isReloading = true;
        if (window.uiManager) {
            window.uiManager.updateWeapon(stats.name, 'Reloading...');
        }

        setTimeout(() => {
            this.localPlayer.ammo[weapon] = stats.ammo;
            this.localPlayer.isReloading  = false;
            if (window.uiManager) {
                window.uiManager.updateWeapon(stats.name, `${stats.ammo} / ∞`);
            }
        }, stats.reload);
    }

    _toggleScope(on) {
        if (!this.gameRunning) return;
        const weapon = this.localPlayer.currentWeapon;
        const zoom   = WEAPON_STATS[weapon].zoom;

        this.isScoped = on;
        const targetFOV = on ? (this.normalFOV / zoom) : this.normalFOV;

        // Smooth FOV transition
        const step = () => {
            const diff = targetFOV - this.camera.fov;
            if (Math.abs(diff) < 0.5) { this.camera.fov = targetFOV; this.camera.updateProjectionMatrix(); return; }
            this.camera.fov += diff * 0.2;
            this.camera.updateProjectionMatrix();
            requestAnimationFrame(step);
        };
        step();

        const scopeOverlay = document.getElementById('scope-overlay');
        if (scopeOverlay) scopeOverlay.style.display = (on && weapon === 'sniper') ? 'block' : 'none';
    }

    // ─────────────────────────────────────
    // EFFECTS
    // ─────────────────────────────────────
    _spawnMuzzleFlash() {
        const flash = new THREE.PointLight(0xffaa00, 8, 4);
        flash.position.copy(this.camera.position);
        flash.position.add(new THREE.Vector3(0.3, -0.2, -0.8).applyQuaternion(this.camera.quaternion));
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 60);
    }

    _spawnBulletTrail(from, dir) {
        const len = 20;
        const to  = from.clone().addScaledVector(dir, len);
        const mid = from.clone().lerp(to, 0.5);
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const mat = new THREE.LineBasicMaterial({ color:0xffff88, transparent:true, opacity:0.8 });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.bullets.push({ mesh:line, life:0.1 });
    }

    _spawnHitEffect(position) {
        for (let i = 0; i < 8; i++) {
            const geo = new THREE.SphereGeometry(0.04, 4, 4);
            const mat = new THREE.MeshBasicMaterial({ color:0xff3300 });
            const p   = new THREE.Mesh(geo, mat);
            p.position.copy(position);
            const vel = new THREE.Vector3(
                (Math.random()-0.5)*4,
                Math.random()*3,
                (Math.random()-0.5)*4
            );
            this.scene.add(p);
            this.bullets.push({ mesh:p, vel, life:0.4 });
        }
    }

    _showHitFlash() {
        const flash = document.getElementById('hit-flash');
        if (!flash) return;
        flash.style.opacity = '0.5';
        setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    // ─────────────────────────────────────
    // MOVEMENT & PHYSICS
    // ─────────────────────────────────────
    _updateMovement(dt) {
        if (!this.gameRunning || !this.localPlayer.isAlive) return;

        // Look (mouse)
        const sens = 0.002;
        if (this.mouse.locked) {
            this.localPlayer.yaw   -= this.mouse.dx * sens;
            this.localPlayer.pitch -= this.mouse.dy * sens;
            this.mouse.dx = 0;
            this.mouse.dy = 0;
        }

        // Mobile look from right joystick
        if (this.isMobile) {
            this.localPlayer.yaw   -= this.joystick.lookX * dt * 2;
            this.localPlayer.pitch -= this.joystick.lookY * dt * 2;
        }

        this.localPlayer.pitch = Math.max(-1.4, Math.min(1.4, this.localPlayer.pitch));

        // Speed
        let speed = 7 * dt;
        if (this.localPlayer.isSprinting) speed *= 1.7;
        if (this.localPlayer.isCrouching) speed *= 0.5;

        // WASD input
        let mx = 0, mz = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    mz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  mz += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  mx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;

        // Mobile joystick
        if (this.isMobile) {
            mx += this.joystick.moveX;
            mz += this.joystick.moveZ;
        }

        this.localPlayer.isSprinting = this.keys['ShiftLeft'] || this.mobileBtn.sprint;
        this.localPlayer.isCrouching = this.keys['ControlLeft'] || this.mobileBtn.crouch;

        // Move
        if (mx !== 0 || mz !== 0) {
            const fwd   = new THREE.Vector3(-Math.sin(this.localPlayer.yaw), 0, -Math.cos(this.localPlayer.yaw));
            const right = new THREE.Vector3(Math.cos(this.localPlayer.yaw), 0, -Math.sin(this.localPlayer.yaw));

            const move = new THREE.Vector3();
            move.addScaledVector(fwd,   -mz * speed);
            move.addScaledVector(right,  mx * speed);

            const newPos = this.localPlayer.position.clone().add(move);

            // Simple boundary check
            newPos.x = Math.max(-58, Math.min(58, newPos.x));
            newPos.z = Math.max(-58, Math.min(58, newPos.z));

            this.localPlayer.position.copy(newPos);
        }

        // Crouch height
        const eyeHeight = this.localPlayer.isCrouching ? 1.0 : 1.6;
        const camTarget = this.localPlayer.position.clone();
        camTarget.y += eyeHeight;

        // Smooth camera
        this.camera.position.lerp(camTarget, 0.25);

        // Apply rotation
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.localPlayer.yaw;
        this.camera.rotation.x = this.localPlayer.pitch;

        // Send to server (throttled every 50ms)
        if (!this._lastSendTime || Date.now() - this._lastSendTime > 50) {
            this._lastSendTime = Date.now();
            this.socket?.emit('playerMove', {
                position: {
                    x: this.localPlayer.position.x,
                    y: this.localPlayer.position.y,
                    z: this.localPlayer.position.z
                },
                rotation: {
                    x: this.camera.quaternion.x,
                    y: this.camera.quaternion.y,
                    z: this.camera.quaternion.z,
                    w: this.camera.quaternion.w
                }
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

    _updateRemotePlayers(dt) {
        this.remotePlayers.forEach(rp => {
            // Smooth interpolation
            rp.mesh.position.lerp(rp.targetPos, 0.2);
            rp.mesh.quaternion.slerp(rp.targetRot, 0.2);

            // Dot always faces camera
            if (rp.dot) {
                rp.dot.lookAt(this.camera.position);
            }
        });
    }

    // ─────────────────────────────────────
    // RADAR
    // ─────────────────────────────────────
    _updateRadar() {
        if (!window.uiManager) return;
        const enemies = [];
        this.remotePlayers.forEach(rp => {
            if (!rp.data.isAlive) return;
            const isEnemy = !rp.data.team || rp.data.team !== this.localPlayer.team;
            enemies.push({
                x: rp.mesh.position.x,
                z: rp.mesh.position.z,
                team: isEnemy ? 'enemy' : 'ally'
            });
        });
        window.uiManager.updateRadar(
            { x: this.localPlayer.position.x, z: this.localPlayer.position.z },
            enemies
        );
    }

    // ─────────────────────────────────────
    // SOCKET LISTENERS
    // ─────────────────────────────────────
    _initSocketListeners() {
        const s = this.socket;
        if (!s) return;

        s.on('gameStarted', (data) => {
            this.gameRunning = true;
            this.gameMode    = data.mode;
            this.buildMap(data.config?.map || 'snow');

            // Add all players
            data.players.forEach(p => {
                if (p.id === s.id) {
                    this.localPlayer.id = s.id;
                    this.spawnLocalPlayer(p.position, p.team);
                } else {
                    this.addRemotePlayer(p);
                }
            });

            if (window.uiManager) window.uiManager.setHudVisibility(true);
        });

        s.on('playerMoved', data => {
            if (data.id !== s.id) this.updateRemotePlayer(data.id, data.position, data.rotation);
        });

        s.on('playerLeft', data => {
            this.removeRemotePlayer(data.id || data);
        });

        s.on('playerJoined', player => {
            this.addRemotePlayer(player);
        });

        s.on('playerShot', data => {
            // Visual effect for remote player shooting
            if (data.id !== s.id) {
                const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
                const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
                this._spawnBulletTrail(pos, dir);
            }
        });

        s.on('playerDamaged', data => {
            // We were hit
            this.localPlayer.health = data.health;
            this._showHitFlash();
            if (window.uiManager) window.uiManager.updateHealth(data.health, 3);
            if (data.health <= 0) this._onLocalDeath();
        });

        s.on('playerEliminated', data => {
            if (data.eliminatedId === s.id) {
                this._onLocalDeath();
            } else {
                // Show kill feed
                const rp = this.remotePlayers.get(data.eliminatedId);
                if (rp) {
                    rp.data.isAlive = false;
                    rp.mesh.visible = false;
                }
                if (data.killerId === s.id) {
                    this.localPlayer.kills++;
                    this.localPlayer.score += 4;
                    if (window.uiManager) window.uiManager.updateKillScore(this.localPlayer.kills);
                    this._showKillFeed(data.killerName, data.weapon);
                }
            }
        });

        s.on('playerHealthUpdate', data => {
            const rp = this.remotePlayers.get(data.id);
            if (rp) rp.data.health = data.health;
        });

        s.on('timerUpdate', data => {
            this.elapsedTime = data.elapsed;
            const m = String(Math.floor(data.elapsed / 60)).padStart(2,'0');
            const sec = String(data.elapsed % 60).padStart(2,'0');
            if (window.uiManager) window.uiManager.updateTimer(`${m}:${sec}`);
        });

        s.on('gameOver', data => {
            this.gameRunning = false;
            this._showGameOver(data);
        });
    }

    _onLocalDeath() {
        this.localPlayer.isAlive = false;
        this.localPlayer.health  = 0;
        if (window.uiManager) window.uiManager.updateHealth(0, 3);

        const deadOverlay = document.getElementById('dead-overlay');
        if (deadOverlay) deadOverlay.style.display = 'flex';
    }

    _showKillFeed(killerName, weapon) {
        const feed = document.getElementById('kill-feed');
        if (!feed) return;
        const el = document.createElement('div');
        el.className = 'kill-feed-item';
        el.textContent = `🎯 You eliminated ${killerName} with ${weapon}`;
        feed.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    _showGameOver(data) {
        const overlay = document.getElementById('gameover-overlay');
        if (!overlay) return;
        const title = document.getElementById('gameover-title');
        const scores = document.getElementById('gameover-scores');

        if (title) {
            if (data.winnerId === this.socket?.id) title.textContent = '🏆 YOU WIN!';
            else if (data.winningTeam && data.winningTeam === this.localPlayer.team) title.textContent = '🏆 YOUR TEAM WINS!';
            else title.textContent = '💀 GAME OVER';
        }

        if (scores && data.players) {
            const sorted = data.players.sort((a,b) => b.score - a.score);
            scores.innerHTML = sorted.map((p,i) =>
                `<div class="score-row">${i+1}. ${p.name} — ${p.score} pts | ${p.kills} kills</div>`
            ).join('');
        }

        overlay.style.display = 'flex';
    }

    // ─────────────────────────────────────
    // GAME LOOP
    // ─────────────────────────────────────
    _animate() {
        requestAnimationFrame(() => this._animate());

        const dt = Math.min(this.clock.getDelta(), 0.05); // cap at 50ms

        this._updateMovement(dt);
        this._updateBullets(dt);
        this._updateRemotePlayers(dt);

        if (this.gameRunning) {
            this._updateRadar();

            // AI update
            if (this.aiManager?.enabled) {
                this.aiManager.update(
                    dt,
                    this.localPlayer.position,
                    (bot, playerPos) => this._onBotShoot(bot, playerPos)
                );
                // Sync bot positions to remotePlayers for radar
                this.aiManager.bots.forEach(bot => {
                    const rp = this.remotePlayers.get('bot_' + bot.id);
                    if (rp) {
                        rp.targetPos.copy(bot.position);
                        rp.data.isAlive = bot.isAlive;
                    }
                });
            }

            // Auto-fire for held weapons
            const weapon = this.localPlayer.currentWeapon;
            if ((this.keys['MouseLeft'] || this.mobileBtn.shoot) &&
                (weapon === 'bkc' || weapon === 'ak' || weapon === 'm4')) {
                this._tryShoot();
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    // ─────────────────────────────────────
    // AI BOTS (VS Computer)
    // ─────────────────────────────────────
    spawnAIBots(count, difficulty) {
        if (!this.aiManager) return;
        const bots = this.aiManager.spawnBots(count, difficulty);

        // Register bots as remote-player-like entities for radar
        bots.forEach(bot => {
            this.remotePlayers.set('bot_' + bot.id, {
                mesh:      bot.group,
                dot:       bot.dot,
                data:      { id: 'bot_'+bot.id, isAlive: true, team: null, name: bot.name },
                targetPos: bot.position.clone(),
                targetRot: new THREE.Quaternion()
            });
        });

        if (window.uiManager) {
            window.uiManager.showAnnouncement(
                `${count} BOTS INCOMING`, '#ff2233', 2500
            );
        }
    }

    _onBotShoot(bot, playerPos) {
        // Bot hits player
        this._showHitFlash();
        this.localPlayer.health = Math.max(0, this.localPlayer.health - 1);
        if (window.uiManager) window.uiManager.updateHealth(this.localPlayer.health, 3);
        if (this.localPlayer.health <= 0) this._onLocalDeath();
    }

    _checkBotHits() {
        if (!this.aiManager) return;
        // Check if any bot is hit by raycaster after shooting
        // (called from _tryShoot when we fire)
        this.aiManager.bots.forEach(bot => {
            if (!bot.isAlive) return;
            const box = new THREE.Box3().setFromObject(bot.group).expandByScalar(0.3);
            const hit = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, hit)) {
                const dead = bot.takeDamage(1);
                if (dead) {
                    this.localPlayer.kills++;
                    this.localPlayer.score += 4;
                    if (window.uiManager) {
                        window.uiManager.updateKillScore(this.localPlayer.kills);
                        window.uiManager.addKillFeedItem('You', bot.name, this.localPlayer.currentWeapon);
                    }
                    // Sync radar
                    const key = 'bot_' + bot.id;
                    const rp = this.remotePlayers.get(key);
                    if (rp) rp.data.isAlive = false;

                    // Check if all bots dead
                    if (this.aiManager.getAliveCount() === 0) {
                        setTimeout(() => this._showGameOver({
                            winnerId: this.socket?.id,
                            players: [{ name:'You', score: this.localPlayer.score,
                                kills: this.localPlayer.kills, id: this.socket?.id }]
                        }), 1500);
                    }
                }
            }
        });
    }
        this.gameRunning = true;
        this.buildMap(config.map || 'snow');
    }

    startGame(config) {
        this.gameRunning = true;
        this.buildMap(config.map || 'snow');
    }
}

// ═══════════════════════════════════════
// BOOT
// ═══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    // Wait for socket to be ready
    const boot = () => {
        if (!window.gameSocket) { setTimeout(boot, 100); return; }
        window.gameEngine = new AZOXGame();
    };
    boot();
});
