/* Control Catch - falling-bubble reflex game (console/facilitator screen).
   Standalone: no team scoring, no server sync - the phone-synced version (app.py's /join/<code>
   embedded page) is a separate, independent playthrough per participant with its own personal
   score. This console version exists so a facilitator can run/demo the exact same mechanic on
   the shared screen. Bubbles are plain DOM buttons animated via a CSS transition on `top`
   (same DOM+CSS approach as every other module here - no canvas).
   Slower, calmer pace than the original cut: longer spawn/fall timing and a longer round (see
   the timing constants below) so early bubbles are comfortably readable/tappable and even the
   late-round pace stays fair on a touchscreen, not frantic. */
(function () {
  const TIMER_SECONDS = 90;
  const CC_SPAWN_START_MS = 1800;
  const CC_SPAWN_MIN_MS = 900;
  const CC_FALL_START_MS = 6000;
  const CC_FALL_MIN_MS = 3500;
  const CC_DURATION_MS = TIMER_SECONDS * 1000;
  // Decorative palette only (see console.css's .cc-c1..c6 + the comment above them) - picked
  // at random per bubble, with zero relationship to bubble.good, so color never hints at the
  // right answer. Pop-outcome color (green/red) is separate and handled entirely by CSS via
  // the .cc-pop-good/.cc-pop-bad classes added in popBubble below.
  const CC_COLOR_CLASSES = ['cc-c1', 'cc-c2', 'cc-c3', 'cc-c4', 'cc-c5', 'cc-c6'];
  // Matches console.css's cc-burst-good/cc-burst-bad animation durations (280ms/320ms) so the
  // pop animation is visible before the element is removed from the DOM.
  const CC_POP_REMOVE_MS = 340;
  const CC_RING_REMOVE_MS = 280;

  let bubblePool = [];
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  let timer = null;
  let bubbles = [];      // [{el, bubble}]
  let score = 0;
  let badPops = 0;
  let lives = 3;
  let gameOver = false;
  let startTs = 0;
  let spawnTimer = null;

  const els = {
    scoreVal: document.getElementById('ccScoreVal'),
    livesVal: document.getElementById('ccLivesVal'),
    hint: document.getElementById('ccHint'),
    arena: document.getElementById('ccArena'),
    gameOverWrap: document.getElementById('ccGameOverWrap'),
    gameOverStats: document.getElementById('ccGameOverStats'),
    rememberCard: document.getElementById('rememberCard'),
    rememberText: document.getElementById('rememberText'),
    restartBtn: document.getElementById('restartBtn'),
    upNextRow: document.getElementById('upNextRow'),
    timerEl: document.getElementById('timer'),
    muteBtn: document.getElementById('ccMuteBtn'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };

  function elapsedMs() { return startTs ? (Date.now() - startTs) : 0; }
  function rampProgress(elapsed) { return Math.max(0, Math.min(1, elapsed / CC_DURATION_MS)); }
  function spawnIntervalFor(elapsed) { const t = rampProgress(elapsed); return CC_SPAWN_START_MS - t * (CC_SPAWN_START_MS - CC_SPAWN_MIN_MS); }
  function fallDurationFor(elapsed) { const t = rampProgress(elapsed); return CC_FALL_START_MS - t * (CC_FALL_START_MS - CC_FALL_MIN_MS); }
  function formatClock(ms) {
    const s = Math.max(0, ms);
    const mins = Math.floor(s / 60000), secs = Math.floor((s % 60000) / 1000);
    return mins + ':' + String(secs).padStart(2, '0');
  }

  function updateHud() {
    if (els.scoreVal) els.scoreVal.textContent = String(score);
    if (els.livesVal) els.livesVal.textContent = '❤'.repeat(lives) + '🖤'.repeat(Math.max(0, 3 - lives));
  }

  // --- Audio: background music + SFX, scoped entirely to this module. Off by default; a
  // participant/facilitator opts in with the mute button, which is the same gesture that (on
  // first tap) creates and unlocks the shared AudioContext - so this never attempts to
  // autoplay on page load, only ever starts from a genuine tap. Nothing here is shared with
  // any other module's own audio (e.g. decision-room's tick sound has its own separate
  // AudioContext in its own closure) and everything stops when the round ends. */
  let audioCtx = null;
  let musicGain = null;
  let sfxGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let soundOn = false;
  try { soundOn = localStorage.getItem('cc_sound_on') === '1'; } catch (e) {}
  // A short, gentle major-pentatonic loop - upbeat but not distracting, deliberately simple
  // (single triangle voice, soft envelope) rather than a busy multi-track arrangement.
  const CC_MUSIC_NOTES = [392.00, 440.00, 523.25, 659.25, 523.25, 440.00, 392.00, 329.63];

  function ensureAudioCtx() {
    if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      musicGain.gain.value = soundOn ? 0.16 : 0;
      musicGain.connect(audioCtx.destination);
      sfxGain = audioCtx.createGain();
      sfxGain.gain.value = soundOn ? 0.4 : 0;
      sfxGain.connect(audioCtx.destination);
    } catch (e) {
      audioCtx = null;
    }
  }

  function musicTick() {
    if (!audioCtx) return;
    const freq = CC_MUSIC_NOTES[musicStep % CC_MUSIC_NOTES.length];
    musicStep++;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g).connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  function startMusic() {
    if (musicTimer || !audioCtx) return;
    musicTick();
    musicTimer = setInterval(musicTick, 430);
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function playPopSound(good) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g).connect(sfxGain);
    // start() must be called before stop() - scheduling stop() first throws InvalidStateError
    // and (since this runs before popBubble's score/class/life-loss logic) silently swallows
    // every pop's gameplay effect, not just its sound. Always start() then stop() per branch.
    if (good) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(760, t);
      osc.frequency.exponentialRampToValueAtTime(1180, t + 0.09);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(105, t + 0.16);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  }

  function updateMuteBtn() {
    if (!els.muteBtn) return;
    els.muteBtn.classList.toggle('cc-sound-on', soundOn);
    els.muteBtn.innerHTML = soundOn ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
    els.muteBtn.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Unmute sound');
  }

  function setSoundOn(on) {
    soundOn = on;
    try { localStorage.setItem('cc_sound_on', on ? '1' : '0'); } catch (e) {}
    if (musicGain) musicGain.gain.value = on ? 0.16 : 0;
    if (sfxGain) sfxGain.gain.value = on ? 0.4 : 0;
    updateMuteBtn();
  }

  if (els.muteBtn) {
    updateMuteBtn();
    els.muteBtn.addEventListener('click', () => {
      ensureAudioCtx();
      setSoundOn(!soundOn);
    });
  }

  function freezeBubbleAt(el) {
    const rect = el.getBoundingClientRect();
    const arenaRect = els.arena.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.top = (rect.top - arenaRect.top) + 'px';
  }

  // Small ring burst at the bubble's own center - see console.css's .cc-burst-ring.
  function spawnBurstRing(el, good) {
    if (!els.arena) return;
    const rect = el.getBoundingClientRect();
    const arenaRect = els.arena.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'cc-burst-ring ' + (good ? 'cc-ring-good' : 'cc-ring-bad');
    ring.style.left = (rect.left - arenaRect.left + rect.width / 2) + 'px';
    ring.style.top = (rect.top - arenaRect.top + rect.height / 2) + 'px';
    els.arena.appendChild(ring);
    setTimeout(() => ring.remove(), CC_RING_REMOVE_MS);
  }

  function popBubble(el, bubble) {
    if (gameOver) return;
    if (el.dataset.resolved === '1') return;
    el.dataset.resolved = '1';
    freezeBubbleAt(el);
    void el.offsetHeight; // force the transition:none above to apply before the keyframe animation below starts
    spawnBurstRing(el, bubble.good);
    playPopSound(bubble.good);
    // Outcome color/animation is CSS-driven (see console.css's cc-burst-good/cc-burst-bad) -
    // no inline transform/opacity here, just add the class and let the keyframes take over.
    if (bubble.good) {
      score++;
      el.classList.add('cc-pop-good');
    } else {
      badPops++;
      lives = Math.max(0, lives - 1);
      el.classList.add('cc-pop-bad');
    }
    updateHud();
    setTimeout(() => { el.remove(); bubbles = bubbles.filter(b => b.el !== el); }, CC_POP_REMOVE_MS);
    if (lives <= 0) endGame();
  }

  function spawnBubble() {
    if (gameOver || !els.arena || !bubblePool.length) return;
    const bubble = bubblePool[Math.floor(Math.random() * bubblePool.length)];
    const el = document.createElement('button');
    el.type = 'button';
    // Decorative color is random and independent of bubble.good - see CC_COLOR_CLASSES above.
    const colorClass = CC_COLOR_CLASSES[Math.floor(Math.random() * CC_COLOR_CLASSES.length)];
    el.className = 'cc-bubble ' + colorClass;
    el.textContent = bubble.text;
    el.style.left = (10 + Math.random() * 80) + '%';
    el.style.top = '-15%';
    el.dataset.resolved = '0';
    els.arena.appendChild(el);
    const fallMs = fallDurationFor(elapsedMs());
    el.addEventListener('click', () => popBubble(el, bubble));
    el.addEventListener('transitionend', (e) => {
      if (e.propertyName !== 'top') return;
      if (el.dataset.resolved === '1') return;
      el.dataset.resolved = '1';
      el.remove();
      bubbles = bubbles.filter(b => b.el !== el);
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transitionDuration = fallMs + 'ms';
        el.style.top = '104%';
      });
    });
    bubbles.push({ el, bubble });
  }

  function spawnLoop() {
    if (gameOver) return;
    spawnBubble();
    const elapsed = elapsedMs();
    if (elapsed >= CC_DURATION_MS) { endGame(); return; }
    spawnTimer = setTimeout(spawnLoop, spawnIntervalFor(elapsed));
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    if (spawnTimer) clearTimeout(spawnTimer);
    if (timer) timer.stop();
    stopMusic();
    bubbles.forEach(({ el }) => {
      if (el.dataset.resolved === '1') return;
      freezeBubbleAt(el);
      el.style.pointerEvents = 'none';
      el.style.opacity = '0.4';
    });
    const survivedMs = Math.min(elapsedMs(), CC_DURATION_MS);
    if (els.gameOverStats) {
      els.gameOverStats.textContent = score + ' good caught · ' + badPops + ' bad popped · ' + lives + '/3 lives left · survived ' + formatClock(survivedMs);
    }
    if (els.gameOverWrap) els.gameOverWrap.classList.remove('le-hidden');
    if (els.hint) els.hint.classList.add('le-hidden');
    if (rememberThisText && els.rememberCard) {
      els.rememberText.textContent = rememberThisText;
      els.rememberCard.classList.remove('le-hidden');
      if (els.upNextRow) els.upNextRow.classList.remove('le-hidden');
    }
  }

  function startRound() {
    if (spawnTimer) clearTimeout(spawnTimer);
    els.arena.innerHTML = '';
    bubbles = [];
    score = 0; badPops = 0; lives = 3; gameOver = false;
    if (els.gameOverWrap) els.gameOverWrap.classList.add('le-hidden');
    if (els.hint) els.hint.classList.remove('le-hidden');
    if (els.rememberCard) els.rememberCard.classList.add('le-hidden');
    if (els.upNextRow) els.upNextRow.classList.add('le-hidden');
    updateHud();
    startTs = Date.now();
    if (timer) timer.stop();
    timer = LiveEvent.createTimer(els.timerEl, TIMER_SECONDS, { onExpire: endGame });
    timer.start();
    spawnTimer = setTimeout(spawnLoop, 500);
    // Start (or resume) music here too - Restart is also a genuine tap, so this stays inside a
    // real user gesture the same way the initial Start button is.
    ensureAudioCtx();
    startMusic();
  }

  function beginActivity() {
    if (!contentData) return;
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    startRound();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    // Audio must start from this exact tap (or the Restart tap above) - never on page load or
    // a timer - to respect mobile browsers' autoplay restrictions.
    ensureAudioCtx();
    beginActivity();
  }

  if (els.introStartBtn) els.introStartBtn.addEventListener('click', dismissIntro);
  if (els.restartBtn) els.restartBtn.addEventListener('click', startRound);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) { dismissIntro(); return; } },
    reveal: () => { if (introDismissed) startRound(); }
  });

  fetch('../content/control-catch.json')
    .then((r) => r.json())
    .then((data) => {
      bubblePool = data.bubbles || [];
      rememberThisText = data.rememberThis || '';
      if (els.introText) els.introText.textContent = data.whyThisMatters || '';
      contentData = data;
      if (introDismissed) beginActivity();
    })
    .catch((err) => {
      if (els.hint) els.hint.textContent = "Could not load this activity. Check your connection and refresh.";
      console.error(err);
    });
})();
