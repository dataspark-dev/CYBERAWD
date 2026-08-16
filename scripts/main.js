/* ============================================================
   SYNERGY CYBER SECURITY AWARENESS MONTH — SHARED INTERACTIONS
   Refactored into a named object for clarity, with robust reset
   and debouncing logic.
   ============================================================ */

const SynergyUI = {
  // ---- Deferred content expansion ----
  expandTemplate(el) {
    const tpl = el.querySelector('template');
    if (!tpl) return;
    el.appendChild(tpl.content.cloneNode(true));
    tpl.remove();
  },

  // ---- Shared detail popup (see .info-modal-backdrop in main.css) ----
  // One lazily-created instance per slide, reused by every trigger.
  _infoModal: null,

  _ensureInfoModal() {
    if (this._infoModal) return this._infoModal;
    const backdrop = document.createElement('div');
    backdrop.className = 'info-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="info-modal">
        <button class="info-modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        <div class="info-modal-head">
          <div class="info-modal-icon"><i class="fa-solid fa-circle-info"></i></div>
          <h3></h3>
        </div>
        <div class="info-modal-body"></div>
      </div>`;
    (document.querySelector('.slide') || document.body).appendChild(backdrop);
    backdrop.querySelector('.info-modal-close').addEventListener('click', () => this.closeInfoModal());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeInfoModal();
    });
    this._infoModal = backdrop;
    this.onEntranceReset(() => this.closeInfoModal());
    return backdrop;
  },

  openInfoModal({ icon, title, body }) {
    const backdrop = this._ensureInfoModal();
    backdrop.querySelector('.info-modal-icon i').className = icon || 'fa-solid fa-circle-info';
    backdrop.querySelector('.info-modal-head h3').textContent = title || '';
    backdrop.querySelector('.info-modal-body').innerHTML = body || '';
    backdrop.classList.add('open');
  },

  closeInfoModal() {
    if (this._infoModal) this._infoModal.classList.remove('open');
  },

  // Reads data-icon/data-title/data-body off the clicked element — lets any
  // card/icon trigger the popup from a plain onclick without inline JS objects.
  openInfoModalFromEl(el) {
    this.openInfoModal({
      icon: el.dataset.icon,
      title: el.dataset.title,
      body: el.dataset.body,
    });
  },

  // ---- Segmented Toggle ----
  initToggleSwitches() {
    // Sets --opt-count from the actual number of options, so the indicator
    // width formula in main.css scales to any toggle-switch, not just 2-option ones.
    document.querySelectorAll('.toggle-switch').forEach(sw => {
      const count = sw.querySelectorAll('.toggle-opt').length;
      if (count) sw.style.setProperty('--opt-count', count);
    });
  },

  toggleSwitch(el, index) {
    const sw = el.closest('.toggle-switch');
    if (!sw) return;
    this.applySwitchState(sw, index);
  },

  applySwitchState(sw, index) {
    const group = sw.closest('.toggle-group') || sw.parentElement;
    sw.dataset.active = index;
    const opts = sw.querySelectorAll('.toggle-opt');
    opts.forEach((o, i) => o.classList.toggle('active', i === index));
    const indicator = sw.querySelector('.toggle-indicator');
    if (indicator) indicator.style.transform = `translateX(${index * 100}%)`;
    const panes = group.querySelectorAll('.toggle-pane');
    panes.forEach(p => {
      const isTarget = parseInt(p.dataset.pane, 10) === index;
      if (isTarget) this.expandTemplate(p);
      p.classList.toggle('active', isTarget);
    });
  },

  // ---- Hotspot reveal ----
  revealHotspot(el) {
    const wasOpen = el.classList.contains('open');
    el.parentElement.querySelectorAll('.hotspot.open').forEach(h => h.classList.remove('open'));
    if (!wasOpen) el.classList.add('open');
  },

  // ---- Glossary term ----
  toggleGlossary(el) {
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.glossary-term.open').forEach(t => t.classList.remove('open'));
    if (!wasOpen) el.classList.add('open');
  },

  // ---- Info expand ----
  // Container list intentionally includes .flow-branch so the flow-scene
  // "learn more" buttons share this same toggle/reset logic instead of a
  // slide-local reimplementation. data-label-more/data-label-done let a
  // caller override the default "Why?" wording (e.g. "Learn more").
  toggleInfoExpand(btn) {
    const panel = btn.closest('.callout-bar, .info-box, .fact-box, .figure-note, .flow-branch')?.querySelector('.info-expand-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (!btn.children.length) {
      const moreLabel = btn.dataset.labelMore || 'Why? ▼';
      const doneLabel = btn.dataset.labelDone || 'Hide why ▲';
      btn.textContent = isOpen ? doneLabel : moreLabel;
    }
  },

  // ---- Drag comparison slider ----
  _dragState: null,

  startDrag(evt, handle) {
    const container = handle.closest('.compare-slider');
    if (container.dataset.locked === '1') return;
    this._dragState = { container, handle };
    handle.setPointerCapture && handle.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  },

  moveDrag(evt) {
    if (!this._dragState) return;
    const rect = this._dragState.container.getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((evt.clientX - rect.left) / rect.width) * 100));
    this._dragState.handle.style.left = pct + '%';
    const before = this._dragState.container.querySelector('.compare-before');
    if (before) before.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  },

  endDrag() {
    this._dragState = null;
  },

  // ---- Data‑flow replay ----
  replayFlow(btn) {
    const scene = btn.closest('.flow-scene') || document;
    const dots = scene.querySelectorAll('.flow-dot, .flow-reveal');
    dots.forEach(d => {
      d.style.animation = 'none';
      void d.offsetWidth; // force reflow
      d.style.animation = '';
    });
  },

  // ---- Attack-flow simulation sequencer ----
  // Drives any "node -> track -> node" diagram (deepfake morph, AI data-paste
  // flow) as a single run-once sequence instead of an ambient infinite loop:
  // walks the row's children in DOM order, so a slide only needs to mark its
  // existing track/node elements with data-flow="track"/"node" — no per-slide
  // step list to hand-author. Any .flow-branch siblings reveal right after
  // the final node arrives.
  cancelFlowSequence(scene) {
    (scene._flowTimers || []).forEach(id => clearTimeout(id));
    scene._flowTimers = [];
    scene.querySelectorAll('.flow-dot.running, .morph-dot.running').forEach(dot => {
      dot.classList.remove('running');
    });
    scene.querySelectorAll('[data-flow="node"]').forEach(node => {
      node.classList.remove('reached');
      const icon = node.querySelector('.fn-icon');
      if (icon) icon.classList.remove('reached');
    });
    scene.querySelectorAll('.flow-branch').forEach(b => b.classList.remove('visible'));
  },

  runFlowSequence(btn) {
    const scene = btn.closest('.flow-scene, .morph-diagram-wrap');
    const row = scene && scene.querySelector('.flow-row, .morph-row');
    if (!scene || !row) return;
    this.cancelFlowSequence(scene);

    const timers = scene._flowTimers = [];
    const schedule = (delay, fn) => timers.push(setTimeout(fn, delay));
    let t = 0;

    [...row.children].forEach(el => {
      if (el.dataset.flow === 'track') {
        const dot = el.querySelector('.flow-dot, .morph-dot');
        const travelMs = parseInt(el.dataset.travelMs, 10) || 1100;
        el.style.setProperty('--travel-ms', travelMs + 'ms');
        schedule(t, () => { if (dot) dot.classList.add('running'); });
        t += travelMs;
      } else if (el.dataset.flow === 'node') {
        const target = el.querySelector('.fn-icon') || el;
        schedule(t, () => target.classList.add('reached'));
        t += 300;
      }
    });

    scene.querySelectorAll('.flow-branch').forEach((b, i) => {
      schedule(t + i * 150, () => b.classList.add('visible'));
    });
  },

  // ---- Screen‑lock demo ----
  startLockDemo(btn) {
    const demo = btn.closest('.lock-demo');
    const seconds = parseInt(demo.dataset.seconds, 10) || 5;
    const ring = demo.querySelector('.lock-ring');
    const num = demo.querySelector('.lock-ring-num');
    const overlay = demo.querySelector('.lock-overlay');
    if (demo._lockTimer) clearInterval(demo._lockTimer);
    overlay.classList.remove('show');
    ring.classList.remove('locked');
    ring.classList.add('running');
    ring.style.setProperty('--dur', seconds + 's');
    let remaining = seconds;
    num.textContent = remaining;
    btn.disabled = true;
    btn.textContent = 'Watching for idle...';
    demo._lockTimer = setInterval(() => {
      remaining--;
      num.textContent = Math.max(remaining, 0);
      if (remaining <= 0) {
        clearInterval(demo._lockTimer);
        ring.classList.remove('running');
        ring.classList.add('locked');
        overlay.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Replay Simulation';
      }
    }, 1000);
  },

  resetLockDemos() {
    document.querySelectorAll('.lock-demo').forEach(demo => {
      if (demo._lockTimer) clearInterval(demo._lockTimer);
      const seconds = parseInt(demo.dataset.seconds, 10) || 5;
      const ring = demo.querySelector('.lock-ring');
      const num = demo.querySelector('.lock-ring-num');
      const overlay = demo.querySelector('.lock-overlay');
      const btn = demo.querySelector('.lock-demo-body button, button');
      if (ring) ring.classList.remove('running', 'locked');
      if (num) num.textContent = seconds;
      if (overlay) overlay.classList.remove('show');
      if (btn) { btn.disabled = false; btn.textContent = 'Simulate Idle Desk'; }
    });
  },

  // ---- 3D flip card ----
  flipCard(el) {
    const card = el.closest('.flip-card');
    const back = card?.querySelector('.flip-card-back');
    if (back) this.expandTemplate(back);
    if (card) card.classList.toggle('flipped');
  },

  // ---- Verdict reveal ----
  revealVerdict(btn) {
    const card = btn.closest('.scenario-card');
    const verdict = card?.querySelector('.verdict');
    if (verdict) verdict.classList.add('show');
    btn.style.display = 'none';
  },

  // ---- Spot‑the‑fake ----
  spotPick(el) {
    const group = el.closest('.spot-grid');
    if (!group || group.dataset.answered === 'true') return;
    group.dataset.answered = 'true';
    const pickedFake = el.dataset.fake === 'true';
    const threatLabel = group.dataset.threatLabel || 'fake';

    const cards = group.querySelectorAll('.spot-card');
    cards.forEach(c => {
      const isFake = c.dataset.fake === 'true';
      c.classList.add('revealed', isFake ? 'is-fake' : 'is-real');
      c.style.cursor = 'default';
      const result = c.querySelector('.spot-result');
      if (result) result.classList.add('show');
    });
    el.classList.add(pickedFake ? 'picked-correct' : 'picked-wrong');

    const msg = group.parentElement?.querySelector('.spot-outcome');
    if (msg) {
      msg.classList.add('show');
      msg.textContent = pickedFake
        ? `✓ Correct — that was the ${threatLabel}. Notice the tells now highlighted on each card.`
        : `✗ That one was authentic. The other card was the ${threatLabel} — review the highlighted tells below.`;
      msg.style.color = pickedFake ? '#166534' : '#991b1b';
      msg.style.background = pickedFake ? '#f0fdf4' : '#fef2f2';
      msg.style.borderColor = pickedFake ? '#bbf7d0' : '#fecaca';
    }
  },

  resetSpotGrids() {
    document.querySelectorAll('.spot-grid[data-answered="true"]').forEach(group => {
      group.dataset.answered = 'false';
      group.querySelectorAll('.spot-card').forEach(c => {
        c.classList.remove('revealed', 'is-fake', 'is-real', 'is-correct', 'is-wrong', 'picked-correct', 'picked-wrong');
        c.style.cursor = '';
        const result = c.querySelector('.spot-result');
        if (result) result.classList.remove('show');
      });
      const msg = group.parentElement?.querySelector('.spot-outcome');
      if (msg) { msg.classList.remove('show'); msg.textContent = ''; }
    });
  },

  // ---- Toggleable checklist ----
  toggleChecklistItem(el) {
    const nowChecked = el.classList.toggle('checked');
    const checkIcon = el.querySelector('.cl-check');
    if (checkIcon) {
      checkIcon.classList.toggle('fa-circle', !nowChecked);
      checkIcon.classList.toggle('fa-circle-check', nowChecked);
    }
    const grid = el.closest('.checklist-grid');
    if (!grid) return;
    const items = grid.querySelectorAll('.cl-item.toggleable');
    const checked = grid.querySelectorAll('.cl-item.toggleable.checked').length;
    const pct = items.length ? Math.round((checked / items.length) * 100) : 0;
    const wrap = grid.closest('.section-block') || grid.parentElement;
    const bar = wrap?.querySelector('.progress-fill');
    const pctLabel = wrap?.querySelector('.progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (pctLabel) pctLabel.textContent = pct + '%';
  },

  // ---- Count‑up animation ----
  initCountUp() {
    document.querySelectorAll('.count-up').forEach(el => {
      const target = parseFloat(el.dataset.target);
      if (isNaN(target)) return;
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      const duration = parseInt(el.dataset.duration, 10) || 1400;
      const isDecimal = target % 1 !== 0;
      let start = null;
      const step = (ts) => {
        if (!start) start = ts;
        const progress = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = target * eased;
        el.textContent = prefix + (isDecimal ? value.toFixed(1) : Math.round(value)) + suffix;
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  },

  // ---- Entrance-reset registry ----
  // Bespoke per-slide widgets (a one-off modal, a custom accordion, etc.) register
  // a reset callback here instead of adding their own postMessage listener, so
  // playEntranceAnimations() stays the single trigger point for "slide just became active".
  _entranceCallbacks: [],

  onEntranceReset(fn) {
    if (typeof fn === 'function') this._entranceCallbacks.push(fn);
  },

  // ---- Entrance (re)play ----
  _lastEntranceTime: 0,

  playEntranceAnimations() {
    const now = Date.now();
    if (now - this._lastEntranceTime < 250) return;
    this._lastEntranceTime = now;

    // Reset all interactive states
    document.querySelectorAll('.glossary-term.open').forEach(t => t.classList.remove('open'));
    document.querySelectorAll('.hotspot.open').forEach(h => h.classList.remove('open'));
    document.querySelectorAll('.visual-tile.open').forEach(t => t.classList.remove('open'));
    document.querySelectorAll('.flip-card.flipped').forEach(c => c.classList.remove('flipped'));
    document.querySelectorAll('.toggle-switch').forEach(sw => {
      if (sw.dataset.active !== '0') this.applySwitchState(sw, 0);
    });
    document.querySelectorAll('.verdict.show').forEach(v => {
      v.classList.remove('show');
      const card = v.closest('.scenario-card');
      const btn = card?.querySelector('.reveal-btn');
      if (btn) btn.style.display = '';
    });
    document.querySelectorAll('.compare-slider').forEach(container => {
      if (container.dataset.locked === '1') return;
      const handle = container.querySelector('.compare-handle');
      const before = container.querySelector('.compare-before');
      if (handle) handle.style.left = '50%';
      if (before) before.style.clipPath = 'inset(0 50% 0 0)';
    });
    document.querySelectorAll('.info-expand-panel.open').forEach(p => {
      p.classList.remove('open');
      const btn = p.previousElementSibling;
      if (btn?.classList.contains('info-expand-btn') && !btn.children.length) {
        btn.textContent = btn.dataset.labelMore || 'Why? ▼';
      }
    });
    this.resetSpotGrids();
    this.resetRevealChains();
    this.resetLockDemos();
    this.initToggleSwitches();

    // Re‑run stagger animations (assigning --stagger-i lets any number of
    // children stagger at a uniform cadence, not just the first 8)
    document.querySelectorAll('.reveal-stagger').forEach(stagger => {
      [...stagger.children].forEach((child, i) => {
        child.style.setProperty('--stagger-i', i);
        child.style.animation = 'none';
        void child.offsetWidth;
        child.style.animation = '';
      });
    });
    document.querySelectorAll('.op-title').forEach(title => {
      title.style.animation = 'none';
      void title.offsetWidth;
      title.style.animation = '';
    });
    this.initCountUp();

    // Let any registered per-slide widgets (bespoke modals/accordions) reset themselves
    this._entranceCallbacks.forEach(fn => {
      try { fn(); } catch (err) { /* one bad widget shouldn't block the rest */ }
    });
  },

  // ---- Click‑through chain build ----
  revealNextPoint(zone) {
    const next = zone.querySelector('.reveal-point:not(.shown)');
    if (next) next.classList.add('shown');
    return !!next;
  },

  advanceRevealChain(btn) {
    const zone = document.getElementById(btn.dataset.zone);
    if (!zone) return;
    if (btn.dataset.state === 'done') {
      this.resetRevealChain(zone, btn);
      return;
    }
    const hasMore = this.revealNextPoint(zone);
    if (!hasMore) {
      btn.dataset.state = 'done';
      if (btn.dataset.labelDone) btn.innerHTML = btn.dataset.labelDone;
    }
  },

  resetRevealChain(zone, btn) {
    zone.querySelectorAll('.reveal-point').forEach((p, i) => {
      if (i > 0) p.classList.remove('shown');
    });
    if (btn) {
      btn.dataset.state = '';
      if (btn.dataset.labelMore) btn.innerHTML = btn.dataset.labelMore;
    }
  },

  resetRevealChains() {
    document.querySelectorAll('.reveal-click-zone').forEach(zone => {
      const midBuild = zone.querySelector('.reveal-point.shown:not(:first-child)');
      if (!midBuild) return;
      const btn = document.querySelector(`.reveal-btn[data-zone="${zone.id}"]`);
      if (btn) this.resetRevealChain(zone, btn);
    });
  }
};

// ---- Expose functions to HTML onclick attributes ----
window.toggleSwitch = (el, i) => SynergyUI.toggleSwitch(el, i);
window.revealHotspot = el => SynergyUI.revealHotspot(el);
window.toggleGlossary = el => SynergyUI.toggleGlossary(el);
window.toggleInfoExpand = btn => SynergyUI.toggleInfoExpand(btn);
window.startDrag = (evt, handle) => SynergyUI.startDrag(evt, handle);
window.replayFlow = btn => SynergyUI.replayFlow(btn);
window.runFlowSequence = btn => SynergyUI.runFlowSequence(btn);
window.startLockDemo = btn => SynergyUI.startLockDemo(btn);
window.flipCard = el => SynergyUI.flipCard(el);
window.revealVerdict = btn => SynergyUI.revealVerdict(btn);
window.spotPick = el => SynergyUI.spotPick(el);
window.toggleChecklistItem = el => SynergyUI.toggleChecklistItem(el);
window.advanceRevealChain = btn => SynergyUI.advanceRevealChain(btn);
window.openInfoModal = data => SynergyUI.openInfoModal(data);
window.openInfoModalFromEl = el => SynergyUI.openInfoModalFromEl(el);
window.closeInfoModal = () => SynergyUI.closeInfoModal();

// ---- Global drag event handlers ----
window.addEventListener('pointermove', (evt) => SynergyUI.moveDrag(evt));
window.addEventListener('pointerup', () => SynergyUI.endDrag());
window.addEventListener('pointercancel', () => SynergyUI.endDrag());

// ---- Slide activation message ----
window.addEventListener('message', (e) => {
  if (e.data?.type === 'slide-activate') SynergyUI.playEntranceAnimations();
  if (e.data?.type === 'close-modal') SynergyUI.closeInfoModal();
});

// ---- DOM ready ----
document.addEventListener('DOMContentLoaded', () => SynergyUI.playEntranceAnimations());

// ---- Keyboard activation for div‑based controls ----
// Every custom clickable widget in the deck (hotspot, flip-card, spot-card,
// stat-open, j-node, close-chip, visual-tile, ...) is marked role="button"
// tabindex="0" — activating on that attribute means new widgets get keyboard
// support for free, with no per-slide keydown handler required.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = document.activeElement;
  if (el?.matches('[role="button"], .info-expand-btn')) {
    e.preventDefault();
    el.click();
  }
});

// ---- Escape closes the shared detail popup ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') SynergyUI.closeInfoModal();
});