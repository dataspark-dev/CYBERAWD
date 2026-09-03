/* ============================================================
   LIVE EVENT — shared utilities
   Generic, reusable helpers with no shared state:
   keyboard-shortcut navigation, reusable countdown timer,
   fullscreen toggle, and HTML escaping.
   ============================================================ */

const LiveEvent = (() => {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------------- Keyboard navigation ----------------
  let keyHandlers = {};
  function onAction(map) {
    keyHandlers = map || {};
  }

  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function resolveHome() {
    return document.body.dataset.home || 'index.html';
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault();
          (keyHandlers.advance || keyHandlers.next)?.();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          keyHandlers.reveal?.();
          break;
        case 'ArrowRight':
          e.preventDefault();
          (keyHandlers.next || keyHandlers.advance)?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          keyHandlers.prev?.();
          break;
        case 'ArrowUp':
          keyHandlers.up?.();
          break;
        case 'ArrowDown':
          keyHandlers.down?.();
          break;
        case 'Escape':
          if (keyHandlers.escape) {
            keyHandlers.escape();
          } else {
            window.location.href = resolveHome();
          }
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        default:
          break;
      }
    });
  }

  // ---------------- Shared countdown timer ----------------
  // createTimer(el, seconds, { onExpire, onTick }) -> { start, stop, reset, isRunning }
  function createTimer(el, totalSeconds, opts) {
    opts = opts || {};
    let remaining = totalSeconds;
    let intervalId = null;
    let expired = false;

    function render() {
      el.classList.remove('amber', 'red', 'expired');
      if (remaining <= 5 && remaining > 0) el.classList.add('red');
      else if (remaining <= 10 && remaining > 0) el.classList.add('amber');
      if (expired) el.classList.add('expired');
      const digits = el.querySelector('.lt-digits');
      if (digits) digits.textContent = String(Math.max(remaining, 0)).padStart(2, '0');
    }

    function beep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
        osc.onended = () => ctx.close();
      } catch (e) {
        // Web Audio unavailable — silently skip the beep.
      }
    }

    function tick() {
      remaining -= 1;
      render();
      opts.onTick?.(remaining);
      if (remaining <= 0) {
        stop();
        expired = true;
        render();
        if (!opts.silent) beep();
        opts.onExpire?.();
      }
    }

    function start() {
      stop();
      expired = false;
      render();
      intervalId = setInterval(tick, 1000);
    }

    function stop() {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    }

    function reset(newSeconds) {
      stop();
      remaining = typeof newSeconds === 'number' ? newSeconds : totalSeconds;
      expired = false;
      render();
    }

    render();

    return {
      start,
      stop,
      reset,
      isRunning: () => intervalId !== null,
      remaining: () => remaining
    };
  }

  // Mirrors the fade-out used when leaving a page (see index.html's
  // `.le-shell.leaving`) so every page — home or module — fades in on
  // arrival instead of snapping into view.
  function initEntrance() {
    const shell = document.querySelector('.le-shell');
    if (!shell) return;
    shell.classList.add('entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => shell.classList.remove('entering'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initKeyboard();
    initEntrance();
  });

  return {
    onAction,
    createTimer,
    toggleFullscreen,
    escapeHtml
  };
})();
