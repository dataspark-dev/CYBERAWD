/* Control Catch - falling-bubble reflex game (console/facilitator screen).
   Standalone: no team scoring, no server sync - the phone-synced version (app.py's /join/<code>
   embedded page) is a separate, independent playthrough per participant with its own personal
   score. This console version exists so a facilitator can run/demo the exact same mechanic on
   the shared screen. Bubbles are plain DOM buttons animated via a CSS transition on `top`
   (same DOM+CSS approach as every other module here - no canvas). */
(function () {
  const TIMER_SECONDS = 75;
  const CC_SPAWN_START_MS = 1400;
  const CC_SPAWN_MIN_MS = 650;
  const CC_FALL_START_MS = 4800;
  const CC_FALL_MIN_MS = 2600;
  const CC_DURATION_MS = TIMER_SECONDS * 1000;
  // Decorative palette only (see console.css's .cc-c1..c6 + the comment above them) - picked
  // at random per bubble, with zero relationship to bubble.good, so color never hints at the
  // right answer. Pop-outcome color (green/red) is separate and handled entirely by CSS via
  // the .cc-pop-good/.cc-pop-bad classes added in popBubble below.
  const CC_COLOR_CLASSES = ['cc-c1', 'cc-c2', 'cc-c3', 'cc-c4', 'cc-c5', 'cc-c6'];
  // Matches console.css's cc-burst-good/cc-burst-bad animation durations (280ms/320ms) so the
  // pop animation is visible before the element is removed from the DOM.
  const CC_POP_REMOVE_MS = 340;

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

  function freezeBubbleAt(el) {
    const rect = el.getBoundingClientRect();
    const arenaRect = els.arena.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.top = (rect.top - arenaRect.top) + 'px';
  }

  function popBubble(el, bubble) {
    if (gameOver) return;
    if (el.dataset.resolved === '1') return;
    el.dataset.resolved = '1';
    freezeBubbleAt(el);
    void el.offsetHeight; // force the transition:none above to apply before the keyframe animation below starts
    // Outcome color/animation is CSS-driven (see console.css's cc-burst-good/cc-burst-bad)  - 
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
    spawnTimer = setTimeout(spawnLoop, 400);
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
