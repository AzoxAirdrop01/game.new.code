// map_generator.js - AZOX Dense Map Generator
import * as THREE from 'https://cdn.skypack.dev/three@0.150.1';

export const MAP_THEMES = {
    snow: {
        sky:      0xc8dff0,
        fog:      0xc8dff0,
        fogNear:  40,
        fogFar:   160,
        ground:   0xe0eef5,
        ambient:  0xaaccff,
        dir:      0xffffff,
        groundR:  0.85,
        name:     'Snow Field'
    },
    desert: {
        sky:      0xe8c87a,
        fog:      0xdeb887,
        fogNear:  50,
        fogFar:   180,
        ground:   0xc8a450,
        ambient:  0xffddaa,
        dir:      0xffeebb,
        groundR:  0.95,
        name:     'Desert Outpost'
    },
    natural: {
        sky:      0x4a7c59,
        fog:      0x3d6e50,
        fogNear:  25,
        fogFar:   110,
        ground:   0x2d5e30,
        ambient:  0x88cc88,
        dir:      0xeeffee,
        groundR:  0.9,
        name:     'Forest Zone'
    }
};

// Barrier placements — dense coverage
const BARRIER_ZONES = [
    // Centre intense zone
    { cx:0,   cz:0,   count:16, radius:22, scale:[0.9,1.2] },
    // North base
    { cx:0,   cz:-40, count:10, radius:14, scale:[1.0,1.3] },
    // South base
    { cx:0,   cz:40,  count:10, radius:14, scale:[1.0,1.3] },
    // East wing
    { cx:40,  cz:0,   count:10, radius:14, scale:[1.0,1.3] },
    // West wing
    { cx:-40, cz:0,   count:10, radius:14, scale:[1.0,1.3] },
    // NE corner
    { cx:35,  cz:-35, count:7,  radius:10, scale:[0.8,1.1] },
    // NW corner
    { cx:-35, cz:-35, count:7,  radius:10, scale:[0.8,1.1] },
    // SE corner
    { cx:35,  cz:35,  count:7,  radius:10, scale:[0.8,1.1] },
    // SW corner
    { cx:-35, cz:35,  count:7,  radius:10, scale:[0.8,1.1] },
    // Mid corridors
    { cx:20,  cz:0,   count:5,  radius:6,  scale:[1.0,1.0] },
    { cx:-20, cz:0,   count:5,  radius:6,  scale:[1.0,1.0] },
    { cx:0,   cz:20,  count:5,  radius:6,  scale:[1.0,1.0] },
    { cx:0,   cz:-20, count:5,  radius:6,  scale:[1.0,1.0] },
];

const BARRIER_NAMES = [
    'barrier_wood','damaged_wall','jersey','wall_door','barrier'
];

const ENV_MAP = {
    snow:    'hangar',
    desert:  'warehouse',
    natural: 'trench'
};

export class MapGenerator {
    constructor(scene, models) {
        this.scene      = scene;
        this.models     = models;
        this.mapObjects = [];
        this.collidables= [];
    }

    build(theme = 'snow') {
        this._clear();

        const cfg = MAP_THEMES[theme] || MAP_THEMES.snow;

        // ── Sky / Fog ──────────────────
        this.scene.background = new THREE.Color(cfg.sky);
        this.scene.fog = new THREE.Fog(cfg.fog, cfg.fogNear, cfg.fogFar);

        // ── Ground ─────────────────────
        this._buildGround(cfg);

        // ── Main Environment ───────────
        const envName = ENV_MAP[theme] || 'hangar';
        const envScale = theme === 'snow' ? 0.022 : (theme === 'desert' ? 0.016 : 0.018);
        this._placeModel(envName, new THREE.Vector3(0, 0, 0), 0, envScale);

        // ── Barriers ───────────────────
        BARRIER_ZONES.forEach(zone => this._populateZone(zone));

        // ── Extra walls along edges ────
        this._buildEdgeWalls();

        // ── Invisible boundary ─────────
        this._buildBoundary();

        console.log(`🗺️ Map "${cfg.name}" built | Objects: ${this.mapObjects.length}`);
        return this.collidables;
    }

    _buildGround(cfg) {
        const geo  = new THREE.PlaneGeometry(300, 300, 1, 1);
        const mat  = new THREE.MeshStandardMaterial({
            color:     cfg.ground,
            roughness: cfg.groundR,
            metalness: 0.0
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x   = -Math.PI / 2;
        mesh.receiveShadow = true;
        mesh.userData.isMap = true;
        this.scene.add(mesh);
        this.mapObjects.push(mesh);

        // Snow/sand overlay particles (cosmetic)
        if (cfg === MAP_THEMES.snow) this._addGroundDetail(0xffffff, 0.95);
        if (cfg === MAP_THEMES.desert) this._addGroundDetail(0xd4a552, 0.7);
    }

    _addGroundDetail(color, opacity) {
        const geo = new THREE.PlaneGeometry(300, 300, 1, 1);
        const mat = new THREE.MeshStandardMaterial({
            color, transparent: true, opacity,
            roughness: 1, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x  = -Math.PI / 2;
        mesh.position.y  = 0.01;
        mesh.userData.isMap = true;
        this.scene.add(mesh);
        this.mapObjects.push(mesh);
    }

    _populateZone(zone) {
        const barriers = BARRIER_NAMES;
        for (let i = 0; i < zone.count; i++) {
            const name  = barriers[Math.floor(Math.random() * barriers.length)];
            const angle = (i / zone.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
            const dist  = zone.radius * (0.35 + Math.random() * 0.65);
            const x = zone.cx + Math.cos(angle) * dist;
            const z = zone.cz + Math.sin(angle) * dist;
            const rotY = Math.random() * Math.PI * 2;
            const [sMin, sMax] = zone.scale;
            const scale = sMin + Math.random() * (sMax - sMin);
            this._placeModel(name, new THREE.Vector3(x, 0, z), rotY, scale);
        }
    }

    _buildEdgeWalls() {
        // Decorative wall segments along field edges
        const positions = [
            // North row
            { x:-30, z:-55 }, { x:-10, z:-55 }, { x:10, z:-55 }, { x:30, z:-55 },
            // South row
            { x:-30, z:55  }, { x:-10, z:55  }, { x:10, z:55  }, { x:30, z:55  },
            // East column
            { x:55,  z:-30 }, { x:55,  z:-10 }, { x:55, z:10  }, { x:55, z:30  },
            // West column
            { x:-55, z:-30 }, { x:-55, z:-10 }, { x:-55,z:10  }, { x:-55,z:30  },
        ];

        const wallModels = ['damaged_wall','wall_door','jersey'];
        positions.forEach(p => {
            const name = wallModels[Math.floor(Math.random() * wallModels.length)];
            const rotY = Math.round(Math.random() * 3) * (Math.PI / 2);
            this._placeModel(name, new THREE.Vector3(p.x, 0, p.z), rotY, 1.1);
        });
    }

    _buildBoundary() {
        // 4 invisible walls at map edges
        const walls = [
            { pos: [0,5,-62], size:[130,12,1] },
            { pos: [0,5, 62], size:[130,12,1] },
            { pos: [-62,5,0], size:[1,12,130] },
            { pos: [ 62,5,0], size:[1,12,130] },
        ];
        walls.forEach(w => {
            const geo  = new THREE.BoxGeometry(...w.size);
            const mat  = new THREE.MeshStandardMaterial({ visible: false });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(...w.pos);
            mesh.userData.isMap = true;
            this.scene.add(mesh);
            this.mapObjects.push(mesh);
            this.collidables.push(new THREE.Box3().setFromObject(mesh));
        });
    }

    _placeModel(name, position, rotY = 0, scale = 1) {
        const original = this.models.get(name);
        if (!original) return null;

        const clone = original.clone();
        clone.position.copy(position);
        clone.rotation.y  = rotY;
        clone.scale.setScalar(scale);
        clone.userData.isMap = true;

        clone.traverse(node => {
            if (node.isMesh) {
                node.castShadow    = true;
                node.receiveShadow = true;
            }
        });

        this.scene.add(clone);
        this.mapObjects.push(clone);

        const box = new THREE.Box3().setFromObject(clone);
        if (!box.isEmpty()) this.collidables.push(box);

        return clone;
    }

    _clear() {
        this.mapObjects.forEach(obj => this.scene.remove(obj));
        this.mapObjects  = [];
        this.collidables = [];
    }
}
