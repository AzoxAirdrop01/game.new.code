// game.js - AZOX World Battle Arena - PERFECT INTEGRATION WITH AI & MAP
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
    pistol: { name:'Pistol',       damage:1, fireRate:400,  ammo:12,  reload:1500, zoom:1,   spread:0.04,  pos: [0.15, -0.2, -0.4], scale: 0.08 },
    ak:     { name:'AK-47',        damage:1, fireRate:150,  ammo:30,  reload:2500, zoom:1.5, spread:0.06,  pos: [0.2, -0.25, -0.5], scale: 0.8 },
    m4:     { name:'M4 Carbine',   damage:1, fireRate:100,  ammo:30,  reload:2000, zoom:1.5, spread:0.03,  pos: [0.2, -0.25, -0.5], scale: 0.8 },
    bkc:    { name:'BKC (M240B)',  damage:2, fireRate:70,   ammo:100, reload:4000, zoom:1,   spread:0.08,  pos: [0.22, -0.3, -0.6], scale: 0.7 },
    sniper: { name:'Sniper (SVD)', damage:3, fireRate:1500, ammo:5,   reload:3500, zoom:6,   spread:0.005, pos: [0.2, -0.2, -0.6],  scale: 1.0 }
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
        this.currentWeaponMesh = null;
        this.audioCtx      = null;
        this.isScoped      = false;
        this.normalFOV     = 75;
        this.aiManager     = null;
        this.mapGenerator  = null;
        this.isMobile      = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.keys          = {};
        this.mouse         = { dx:0, dy:0, locked:false };
        this.raycaster     = new THREE.Raycaster();
        this._lastSendTime = 0;

        this.localPlayer = {
            id: null, name: 'Player', health: 3, maxHealth: 3,
            kills: 0, score: 0,
            position: new THREE.Vector3(0, 0, 0),
            yaw: 0, pitch: 0,
            isAlive: true, isCrouching: false, isSprinting: false,
            currentWeapon: 'pistol',
            weapons: ['pistol', 'ak', 'm4', 'bkc', 'sniper'],
            ammo: { pistol:12, ak:30, m4:30, bkc:100, sniper:5 },
            isReloading: false,
            lastFireTime: 0
        };

        this._initRenderer();
        this._initCamera();
        this._initLights();
        this._initControls();
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
        
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    _initCamera() {
        this.camera = new THREE.PerspectiveCamera(this.normalFOV, window.innerWidth/window.innerHeight, 0.05, 500);
        this.camera.position.set(0, 1.6, 0);
        this.scene.add(this.camera); // Essential for attaching weapon models directly to view
    }

    _initLights() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
        this.dirLight.position.set(30, 60, 30);
        this.scene.add(this.dirLight);
    }

    _initControls() {
        document.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            this._initAudio();
            
            const wMap = { Digit1:'pistol', Digit2:'ak', Digit3:'m4', Digit4:'bkc', Digit5:'sniper' };
            if (wMap[e.code] && this.localPlayer.weapons.includes(wMap[e.code])) this._switchWeapon(wMap[e.code]);
            if (e.code === 'KeyR') this._reload();
        });

        document.addEventListener('keyup', e => { this.keys[e.code] = false; });
        
        document.addEventListener('mousemove', e => {
            if (this.mouse.locked || this.isMobile) {
                const sensitivity = 0.0025;
                this.localPlayer.yaw   -= e.movementX * sensitivity;
                this.localPlayer.pitch -= e.movementY * sensitivity;
                this.localPlayer.pitch = Math.max(-1.4, Math.min(1.4, this.localPlayer.pitch));
            }
        });

        document.addEventListener('mousedown', e => {
            this._initAudio();
            if (e.button === 0 && this.gameRunning) this._tryShoot();
        });

        const canvas = document.getElementById('game-canvas');
        canvas.addEventListener('click', () => { if (!this.isMobile) canvas.requestPointerLock(); });
        document.addEventListener('pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === canvas; });
        
        // Listen for mobile overlay touches directly via UI hooks
        setTimeout(() => {
            const fireBtn = document.getElementById('fire-button') || document.querySelector('.fire-btn');
            if (fireBtn) fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this._initAudio(); this._tryShoot(); });
        }, 1200);
    }

    _initAudio() {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    _playShootSound() {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(380, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, this.audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.12);
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.12);
    }

    _startLoadingScreen() {
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

        const loadOne = (m) => new Promise(resolve => {
            this.loader.load(
                MODEL_BASE + m.file,
                gltf => {
                    gltf.scene.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
                    this.models.set(m.name, gltf.scene);
                    loaded++;
                    resolve();
                },
                null,
                err => {
                    this.models.set(m.name, new THREE.Group());
                    loaded++;
                    resolve();
                }
            );
        });

        for (let i = 0; i < allModels.length; i += 3) {
            await Promise.all(allModels.slice(i, i + 3).map(loadOne));
        }

        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';

        this.aiManager    = new AIManager(this.scene, this.models);
        this.mapGenerator = new MapGenerator(this.scene, this.models);

        // Build default stable match map layout
        this.buildMap('snow');
        this._switchWeapon('pistol');
        
        this.gameRunning = true;
        this.clock.getDelta();
        this._animate();
    }

    buildMap(theme = 'snow') {
        if (!this.mapGenerator) return;
        this.collidables = this.mapGenerator.build(theme);
    }

    _switchWeapon(name) {
        this.localPlayer.currentWeapon = name;
        if (this.currentWeaponMesh) this.camera.remove(this.currentWeaponMesh);

        const weaponModel = this.models.get(name);
        if (weaponModel) {
            this.currentWeaponMesh = weaponModel.clone();
            const cfg = WEAPON_STATS[name];
            this.currentWeaponMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            this.currentWeaponMesh.rotation.set(0, Math.PI, 0); // Orient weapon forward
            this.currentWeaponMesh.scale.setScalar(cfg.scale);
            this.camera.add(this.currentWeaponMesh);
        }

        const stats = WEAPON_STATS[name];
        if (window.uiManager) window.uiManager.updateWeapon(stats.name, this.localPlayer.ammo[name] + ' / inf');
    }

    _tryShoot() {
        if (!this.localPlayer.isAlive) return;
        const now = Date.now();
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];
        if (now - this.localPlayer.lastFireTime < stats.fireRate) return;
        if (this.localPlayer.ammo[weapon] <= 0) { this._reload(); return; }

        this.localPlayer.lastFireTime = now;
        this.localPlayer.ammo[weapon]--;

        this._playShootSound();
        this._spawnMuzzleFlash();

        const rayDir = new THREE.Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld).normalize();
        this.raycaster.set(this.camera.position, rayDir);

        // Track collisions with custom procedural walls from map_generator
        let wallDist = Infinity;
        for (const box of this.collidables) {
            const hit = new THREE.Vector3();
            if (this.raycaster.ray.intersectBox(box, hit)) {
                const d = this.camera.position.distanceTo(hit);
                if (d < wallDist) wallDist = d;
            }
        }

        this._spawnBulletTrail(this.camera.position.clone().add(rayDir), rayDir);

        if (this.aiManager?.enabled) this._checkBotHits(wallDist);
        if (window.uiManager) window.uiManager.updateWeapon(stats.name, this.localPlayer.ammo[weapon] + ' / inf');
    }

    _reload() {
        const weapon = this.localPlayer.currentWeapon;
        const stats  = WEAPON_STATS[weapon];
        if (this.localPlayer.isReloading) return;
        this.localPlayer.isReloading = true;
        if (window.uiManager) window.uiManager.updateWeapon(stats.name, 'Reloading...');
        setTimeout(() => {
            this.localPlayer.ammo[weapon] = stats.ammo;
            this.localPlayer.isReloading  = false;
            if (window.uiManager) window.uiManager.updateWeapon(stats.name, stats.ammo + ' / inf');
        }, stats.reload);
    }

    _spawnMuzzleFlash() {
        const flash = new THREE.PointLight(0xffaa00, 4, 3);
        flash.position.copy(this.camera.position).add(new THREE.Vector3(0, -0.1, -0.4).applyQuaternion(this.camera.quaternion));
        this.scene.add(flash);
        setTimeout(() => this.scene.remove(flash), 50);
    }

    _spawnBulletTrail(from, dir) {
        const to  = from.clone().addScaledVector(dir, 35);
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color:0xffaa44, transparent:true, opacity:0.8 }));
        this.scene.add(line);
        this.bullets.push({ mesh:line, life:0.08 });
    }

    _updateMovement(dt) {
        if (!this.localPlayer.isAlive) return;

        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.localPlayer.yaw;
        this.camera.rotation.x = this.localPlayer.pitch;

        let speed = 7.5 * dt;
        if (this.keys['ShiftLeft']) speed *= 1.5;

        let mx = 0, mz = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    mz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  mz += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  mx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;

        // Support touch joystick values directly from the active overlay
        if (window.uiManager && window.uiManager.joystickValues) {
            mx += window.uiManager.joystickValues.x;
            mz += window.uiManager.joystickValues.y;
        }

        if (mx !== 0 || mz !== 0) {
            const fwd   = new THREE.Vector3(-Math.sin(this.localPlayer.yaw), 0, -Math.cos(this.localPlayer.yaw));
            const right = new THREE.Vector3(Math.cos(this.localPlayer.yaw),  0, -Math.sin(this.localPlayer.yaw));
            const move  = new THREE.Vector3().addScaledVector(fwd, -mz).addScaledVector(right, mx).normalize().multiplyScalar(speed);

            const nextPos = this.localPlayer.position.clone().add(move);

            // Bounding box validation against collidables
            const pBox = new THREE.Box3(
                new THREE.Vector3(nextPos.x - 0.4, 0, nextPos.z - 0.4),
                new THREE.Vector3(nextPos.x + 0.4, 1.8, nextPos.z + 0.4)
            );

            let blocked = false;
            for (const col of this.collidables) {
                if (pBox.intersectsBox(col)) { blocked = true; break; }
            }
            if (!blocked) this.localPlayer.position.copy(nextPos);
        }

        this.camera.position.copy(this.localPlayer.position);
        this.camera.position.y += 1.6;
    }

    _updateBullets(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i]; b.life -= dt;
            if (b.mesh.material) b.mesh.material.opacity = Math.max(0, b.life * 12);
            if (b.life <= 0) {
                this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
                this.bullets.splice(i, 1);
            }
        }
    }

    _checkBotHits(wallDist) {
        if (!this.aiManager) return;
        this.aiManager.bots.forEach(bot => {
            if (!bot.isAlive) return;
            const box = new THREE.Box3().setFromObject(bot.group).expandByScalar(0.2);
            if (this.raycaster.ray.intersectsBox(box)) {
                const dist = this.camera.position.distanceTo(bot.position);
                if (dist < wallDist) {
                    bot.takeDamage(1);
                    if (window.uiManager && !bot.isAlive) {
                        window.uiManager.addKillFeedItem('You', bot.name, this.localPlayer.currentWeapon);
                    }
                }
            }
        });
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        const dt = Math.min(this.clock.getDelta(), 0.04);
        
        this._updateMovement(dt);
        this._updateBullets(dt);
        
        if (this.gameRunning && this.aiManager?.enabled) {
            this.aiManager.update(dt, this.localPlayer.position, () => {});
        }
        
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameEngine = new AZOXGame();
});
