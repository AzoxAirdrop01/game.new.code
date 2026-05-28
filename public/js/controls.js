// controls.js - Mobile Virtual Joystick + Button Controls
// Runs as ES module, patches window.gameEngine after it loads

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function waitForEngine(cb, tries = 0) {
    if (window.gameEngine) { cb(window.gameEngine); return; }
    if (tries > 100) return;
    setTimeout(() => waitForEngine(cb, tries + 1), 100);
}

// ═══════════════════════════════════════
// DESKTOP: show/hide mobile controls
// ═══════════════════════════════════════
if (!isMobile) {
    // Desktop — nothing to do for joystick
    document.getElementById('mobile-controls')?.classList.add('hidden');
} else {
    // Show mobile controls when game starts
    document.addEventListener('azoxGameStarted', () => {
        document.getElementById('mobile-controls')?.classList.remove('hidden');
    });
}

// ═══════════════════════════════════════
// JOYSTICK FACTORY
// ═══════════════════════════════════════
function createJoystick(zoneId, baseId, knobId, onMove) {
    const zone = document.getElementById(zoneId);
    const base = document.getElementById(baseId);
    const knob = document.getElementById(knobId);
    if (!zone || !base || !knob) return;

    const RADIUS = 40; // max knob travel in px
    let active = false;
    let touchId = null;
    let originX = 0, originY = 0;

    function getBaseCenter() {
        const r = base.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function moveKnob(tx, ty) {
        const c = getBaseCenter();
        let dx = tx - c.x;
        let dy = ty - c.y;
        const dist = Math.hypot(dx, dy);

        if (dist > RADIUS) {
            dx = (dx / dist) * RADIUS;
            dy = (dy / dist) * RADIUS;
        }

        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / RADIUS, dy / RADIUS); // normalized -1..1
    }

    function reset() {
        active = false;
        touchId = null;
        knob.style.transform = 'translate(0,0)';
        onMove(0, 0);
    }

    zone.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        if (active) return;
        active = true;
        touchId = t.identifier;
        moveKnob(t.clientX, t.clientY);
    }, { passive: false });

    zone.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier === touchId) {
                moveKnob(t.clientX, t.clientY);
                break;
            }
        }
    }, { passive: false });

    zone.addEventListener('touchend', e => {
        for (const t of e.changedTouches) {
            if (t.identifier === touchId) { reset(); break; }
        }
    });

    zone.addEventListener('touchcancel', reset);
}

// ═══════════════════════════════════════
// INIT JOYSTICKS
// ═══════════════════════════════════════
waitForEngine(engine => {

    // Move joystick (left) → engine.joystick.moveX / moveZ
    createJoystick(
        'joystick-move-zone',
        'joystick-move-base',
        'joystick-move-knob',
        (x, y) => {
            engine.joystick.moveX = x;
            engine.joystick.moveZ = y;
        }
    );

    // Look joystick (right) → engine.joystick.lookX / lookY
    createJoystick(
        'joystick-look-zone',
        'joystick-look-base',
        'joystick-look-knob',
        (x, y) => {
            engine.joystick.lookX = x;
            engine.joystick.lookY = y;
        }
    );

    // ── BUTTONS ──────────────────────────

    function holdBtn(id, onDown, onUp) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); onDown(); }, { passive: false });
        el.addEventListener('touchend',   e => { e.preventDefault(); onUp();   }, { passive: false });
        el.addEventListener('touchcancel',e => { e.preventDefault(); onUp();   }, { passive: false });
    }

    function tapBtn(id, onTap) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); onTap(); }, { passive: false });
    }

    // Fire — hold to shoot repeatedly
    let fireInterval = null;
    holdBtn('btn-fire',
        () => {
            engine._tryShoot();
            fireInterval = setInterval(() => engine._tryShoot(), 80);
            engine.mobileBtn.shoot = true;
        },
        () => {
            clearInterval(fireInterval);
            engine.mobileBtn.shoot = false;
        }
    );

    // Sprint
    holdBtn('btn-sprint',
        () => { engine.mobileBtn.sprint = true;  engine.localPlayer.isSprinting = true;  },
        () => { engine.mobileBtn.sprint = false; engine.localPlayer.isSprinting = false; }
    );

    // Crouch
    holdBtn('btn-crouch',
        () => { engine.mobileBtn.crouch = true;  engine.localPlayer.isCrouching = true;  },
        () => { engine.mobileBtn.crouch = false; engine.localPlayer.isCrouching = false; }
    );

    // Scope
    holdBtn('btn-scope',
        () => engine._toggleScope(true),
        () => engine._toggleScope(false)
    );

    // Reload
    tapBtn('btn-reload', () => engine._reload());

    // Weapon switch — cycle through owned weapons
    tapBtn('btn-switch', () => {
        const weapons = engine.localPlayer.weapons;
        const cur = engine.localPlayer.currentWeapon;
        const idx = weapons.indexOf(cur);
        const next = weapons[(idx + 1) % weapons.length];
        engine._switchWeapon(next);
    });

    console.log('🕹️ Mobile controls initialized');
});

// ═══════════════════════════════════════
// WEAPON SLOT UI SYNC
// ═══════════════════════════════════════
waitForEngine(engine => {
    // Update active slot visual when weapon changes
    const origSwitch = engine._switchWeapon.bind(engine);
    engine._switchWeapon = function(name) {
        origSwitch(name);
        document.querySelectorAll('.wslot').forEach(s => {
            s.classList.toggle('active', s.dataset.w === name);
        });
    };
});

// ═══════════════════════════════════════
// HEALTH PIP SYNC
// ═══════════════════════════════════════
window.addEventListener('azoxHealthChanged', e => {
    const hp = e.detail.health;
    for (let i = 1; i <= 3; i++) {
        const pip = document.getElementById(`pip-${i}`);
        if (pip) pip.classList.toggle('empty', i > hp);
    }
});

// ═══════════════════════════════════════
// PLAY AGAIN BUTTON
// ═══════════════════════════════════════
document.getElementById('btn-play-again')?.addEventListener('click', () => {
    location.reload();
});
