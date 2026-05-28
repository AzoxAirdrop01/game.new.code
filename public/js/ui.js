// ui.js - AZOX UIManager (HUD: Radar, Health, Weapon, Timer, Kill Feed)
class UIManager {
    constructor() {
        this.radarCanvas  = document.getElementById('radar-canvas');
        this.radarCtx     = this.radarCanvas?.getContext('2d');
        this.radarRange   = 60;  // world units visible on radar
        this.radarSize    = 130;

        this.healthEl     = document.getElementById('health-text');
        this.weaponEl     = document.getElementById('weapon-name');
        this.ammoEl       = document.getElementById('ammo-count');
        this.timerEl      = document.getElementById('game-timer');
        this.killEl       = document.getElementById('kill-score');
        this.teamEl       = document.getElementById('team-scores');
        this.feedEl       = document.getElementById('kill-feed');

        console.log('UIManager ready');
    }

    // ─── HEALTH ──────────────────────────
    updateHealth(hp, maxHp = 3) {
        // Update pips
        for (let i = 1; i <= maxHp; i++) {
            const pip = document.getElementById('pip-' + i);
            if (pip) pip.classList.toggle('empty', i > hp);
        }
        // Update text
        if (this.healthEl) this.healthEl.textContent = `${hp} / ${maxHp}`;

        // Dispatch event for controls.js
        document.dispatchEvent(new CustomEvent('azoxHealthChanged', { detail: { health: hp } }));

        // Red vignette if low
        const flash = document.getElementById('hit-flash');
        if (flash && hp <= 1 && hp > 0) {
            flash.style.opacity = '0.15';
        } else if (flash && hp > 1) {
            flash.style.opacity = '0';
        }
    }

    // ─── WEAPON ──────────────────────────
    updateWeapon(name, ammo) {
        if (this.weaponEl) this.weaponEl.textContent = name;
        if (this.ammoEl)   this.ammoEl.textContent   = ammo;
    }

    // ─── TIMER ───────────────────────────
    updateTimer(timeStr) {
        if (this.timerEl) this.timerEl.textContent = timeStr;
    }

    // ─── KILL SCORE ──────────────────────
    updateKillScore(kills) {
        if (this.killEl) this.killEl.textContent = `KILLS: ${kills}`;
    }

    // ─── TEAM SCORES ─────────────────────
    updateTeamScores(scores) {
        if (!this.teamEl) return;
        const entries = Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([team, pts]) => `<span style="color:#ffcc00">Team ${team}</span>: ${pts}`)
            .join(' | ');
        this.teamEl.innerHTML = entries;
    }

    // ─── HUD VISIBILITY ──────────────────
    setHudVisibility(visible) {
        const ids = ['hud-radar','hud-health','hud-weapon','hud-stats'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (visible) el.classList.remove('hidden');
            else         el.classList.add('hidden');
        });
    }

    // ─── KILL FEED ───────────────────────
    addKillFeedItem(killerName, victimName, weapon) {
        if (!this.feedEl) return;
        const el = document.createElement('div');
        el.className = 'kill-feed-item';
        el.innerHTML = `
            <span style="color:#ff8888">${killerName}</span>
            <span style="color:#888"> ☠ </span>
            <span style="color:#fff">${victimName}</span>
            <span style="color:#ffcc00;font-size:.65rem"> [${weapon}]</span>
        `;
        this.feedEl.appendChild(el);

        // Keep only last 5 items
        while (this.feedEl.children.length > 5) {
            this.feedEl.removeChild(this.feedEl.firstChild);
        }
        setTimeout(() => el.remove(), 3500);
    }

    // ─── RADAR ───────────────────────────
    updateRadar(localPos, entities) {
        const ctx = this.radarCtx;
        if (!ctx) return;

        const s    = this.radarSize;
        const half = s / 2;
        const r    = this.radarRange;

        // Clear
        ctx.clearRect(0, 0, s, s);

        // Background circle
        ctx.beginPath();
        ctx.arc(half, half, half - 1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();

        // Grid rings
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth   = 1;
        [0.33, 0.66, 1.0].forEach(f => {
            ctx.beginPath();
            ctx.arc(half, half, (half - 2) * f, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Cross lines
        ctx.beginPath();
        ctx.moveTo(half, 2); ctx.lineTo(half, s - 2);
        ctx.moveTo(2, half); ctx.lineTo(s - 2, half);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();

        // Clip to circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(half, half, half - 2, 0, Math.PI * 2);
        ctx.clip();

        // Entities (enemies/allies)
        entities.forEach(e => {
            const dx = e.x - localPos.x;
            const dz = e.z - localPos.z;

            const dist = Math.hypot(dx, dz);
            if (dist > r) return; // out of range

            // Map world pos to radar canvas
            const px = half + (dx / r) * (half - 6);
            const pz = half + (dz / r) * (half - 6);

            const isEnemy = e.team === 'enemy';

            // Dot
            ctx.beginPath();
            ctx.arc(px, pz, isEnemy ? 4 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle   = isEnemy ? '#ff3333' : '#00ff88';
            ctx.shadowColor = isEnemy ? '#ff0000' : '#00ff44';
            ctx.shadowBlur  = 6;
            ctx.fill();
            ctx.shadowBlur  = 0;
        });

        ctx.restore();

        // Local player dot (center)
        ctx.beginPath();
        ctx.arc(half, half, 4, 0, Math.PI * 2);
        ctx.fillStyle   = '#ffffff';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur  = 8;
        ctx.fill();
        ctx.shadowBlur  = 0;

        // Radar sweep (optional cosmetic)
        this._drawSweep(ctx, half, s);
    }

    _drawSweep(ctx, half, s) {
        const now     = Date.now() / 1000;
        const angle   = (now % 3) / 3 * Math.PI * 2 - Math.PI / 2;

        const grad = ctx.createConicalGradient
            ? null  // not widely supported
            : null;

        // Simple line sweep
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(
            half + Math.cos(angle) * (half - 2),
            half + Math.sin(angle) * (half - 2)
        );
        ctx.strokeStyle = 'rgba(0,255,136,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // ─── DAMAGE INDICATOR ────────────────
    showDamageIndicator(fromX, fromZ, localX, localZ) {
        // Shows directional arrow of where damage came from
        const indicator = document.getElementById('damage-dir');
        if (!indicator) return;

        const dx  = fromX - localX;
        const dz  = fromZ - localZ;
        const ang = Math.atan2(dx, dz) * (180 / Math.PI);

        indicator.style.transform = `translate(-50%, -50%) rotate(${ang}deg)`;
        indicator.style.opacity   = '1';
        setTimeout(() => { indicator.style.opacity = '0'; }, 800);
    }

    // ─── WEAPON SLOT HIGHLIGHT ───────────
    highlightWeaponSlot(weaponName) {
        document.querySelectorAll('.wslot').forEach(s => {
            s.classList.toggle('active', s.dataset.w === weaponName);
        });
    }

    // ─── ANNOUNCEMENT BANNER ─────────────
    showAnnouncement(text, color = '#ffcc00', duration = 2500) {
        let el = document.getElementById('announcement');
        if (!el) {
            el = document.createElement('div');
            el.id = 'announcement';
            el.style.cssText = `
                position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);
                font-size:1.6rem;font-weight:900;letter-spacing:4px;
                text-align:center;pointer-events:none;z-index:500;
                text-shadow:0 0 20px currentColor;
                transition:opacity .3s;font-family:Courier New,monospace;
            `;
            document.getElementById('game-container')?.appendChild(el);
        }
        el.textContent  = text;
        el.style.color  = color;
        el.style.opacity = '1';
        clearTimeout(el._timeout);
        el._timeout = setTimeout(() => { el.style.opacity = '0'; }, duration);
    }
}

// Export as global singleton
window.uiManager = new UIManager();
