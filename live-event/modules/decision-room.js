/* Decision Room - one scenario, one decision, one debrief, per case - 10 cases.
   Every case is the same shape: read the scenario, pick one option (its outcome - good or
   consequence - and feedback show inline the instant you pick), read the debrief, move on.
   Earlier revisions of this module had cases with up to 3 sequential decisions and two
   different timer paces (a slow ambient one for long cases, a brisk urgent one for short
   cases folded in from a since-retired "Rapid Fire" module) - simplified here for live
   facilitation: 34 items across 16 cases was too much to navigate live via the admin item
   picker, so every case is now flattened to its single most essential decision and only the
   10 strongest/most distinct cases survive (see content/decision-room.json).
   One consistent timer for all 10: the brisk, urgent clock (tick in the final seconds,
   reveals the good option without attributing a choice you didn't make if it runs out) - a
   single decision doesn't carry the old 90s ambient/silent pace the way three did, and this
   module's whole point now is quick live navigation.
   Self-contained: no scoring, no leaderboard, standalone endpoint like every other module. */
(function () {
  const TIMER_SECONDS = 20;
  let cases = [];
  let caseIndex = 0;
  let chosenId = null;      // this case's chosen option id, or null
  let expiredNoPick = false; // this case's timer ran out with nothing chosen
  let done = false;
  let timer = null;

  const els = {
    counter: document.getElementById('itemCounter'),
    phaseLabel: document.getElementById('phaseLabel'),
    persona: document.getElementById('casePersona'),
    title: document.getElementById('caseTitle'),
    scenario: document.getElementById('caseScenario'),
    stage: document.getElementById('decisionStage'),
    timerEl: document.getElementById('timer'),
    btnRow: document.getElementById('btnRow'),
    nextBtn: document.getElementById('nextBtn'),
    dots: document.getElementById('progressDots'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  function letterFor(i) {
    return String.fromCharCode(65 + i);
  }

  function currentCase() {
    return cases[caseIndex];
  }

  function renderDots() {
    els.dots.innerHTML = cases.map((_, i) => {
      const cls = i === caseIndex ? 'dot current' : (i < caseIndex ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function updateNextButton() {
    const isLastCase = caseIndex === cases.length - 1;
    els.nextBtn.disabled = !chosenId && !expiredNoPick;
    els.nextBtn.innerHTML = isLastCase
      ? '<i class="fa-solid fa-flag-checkered"></i> Finish'
      : '<i class="fa-solid fa-forward"></i> Next Case';
  }

  // One screen per case: prompt + options always visible; once answered (or the timer expires
  // without a pick), the chosen option's own outcome/feedback AND the case debrief both show
  // inline below it - no separate "see debrief" step to page through.
  function renderCase() {
    const c = currentCase();
    const decision = c.decisions[0];
    const answered = chosenId || expiredNoPick;
    // On timeout, treat the good option as "revealed" (selected+good styling, its own
    // feedback shown) without it being chosenId - so nothing is attributed to a pick that
    // was never made.
    const revealedOpt = chosenId
      ? decision.options.find((o) => o.id === chosenId)
      : (expiredNoPick ? decision.options.find((o) => o.outcome === 'good') : null);

    els.phaseLabel.textContent = answered ? 'Answered' : 'Decide';

    const optionsHtml = decision.options.map((opt, i) => {
      const isRevealed = revealedOpt && revealedOpt.id === opt.id;
      const cls = isRevealed ? ` selected ${opt.outcome}` : '';
      return `
        <button class="dr-option${cls}" data-id="${opt.id}" type="button" ${answered ? 'disabled' : ''}>
          <span class="dr-opt-letter">${letterFor(i)}</span>
          <span class="dr-opt-text">${LiveEvent.escapeHtml(opt.text)}</span>
        </button>`;
    }).join('');

    const feedbackHtml = revealedOpt
      ? `<div class="dr-feedback show ${revealedOpt.outcome}">${LiveEvent.escapeHtml(revealedOpt.feedback)}</div>`
      : '';

    const debriefHtml = answered
      ? `<div class="dr-debrief-panel">
          <div class="ff-r-row">
            <i class="fa-solid fa-lightbulb"></i>
            <div>
              <div class="ff-r-label">Debrief</div>
              <div class="ff-r-text">${LiveEvent.escapeHtml(c.debrief)}</div>
            </div>
          </div>
        </div>`
      : '';

    els.stage.innerHTML = `
      <div class="dr-scene">
        <div class="dr-prompt">${LiveEvent.escapeHtml(decision.prompt)}</div>
        <div class="dr-options">${optionsHtml}</div>
        ${feedbackHtml}
      </div>
      ${debriefHtml}
    `;

    Array.from(els.stage.querySelectorAll('.dr-option')).forEach((btn) => {
      btn.addEventListener('click', () => selectOption(btn.dataset.id));
    });

    updateNextButton();
    renderDots();
  }

  function selectOption(optId) {
    if (done || chosenId || expiredNoPick) return;
    chosenId = optId;
    if (timer) timer.stop();
    renderCase();
  }

  // Timer expiry: reveal which option was good WITHOUT attributing a choice that was never
  // made (chosenId stays null) - keeps the room moving without pretending someone answered.
  function revealGoodOptionOnTimeout() {
    if (done || chosenId) return;
    expiredNoPick = true;
    renderCase();
  }

  // A short, quickening tick in the final seconds - pace/energy, plays on every case now that
  // there's only one consistent timer. One shared, lazily-created AudioContext for the whole
  // page: each tick just schedules a new independent oscillator on it, so ticks can never
  // "stack" - every case's timer is stopped before the next one starts, so at most one timer
  // is ever live.
  let tickAudioCtx = null;
  let lastTickAt = 0;
  function tickSound(remaining) {
    if (remaining <= 0 || remaining > 5) return;
    const now = performance.now();
    if (now - lastTickAt < 300) return;
    lastTickAt = now;
    try {
      if (!tickAudioCtx) tickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = tickAudioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 600 + (5 - remaining) * 70;
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      // Web Audio unavailable - silently skip the tick.
    }
  }

  function startTimer() {
    if (timer) timer.stop();
    timer = LiveEvent.createTimer(els.timerEl, TIMER_SECONDS, {
      onExpire: revealGoodOptionOnTimeout,
      onTick: tickSound
    });
    timer.start();
  }

  function startCase() {
    const c = currentCase();
    if (!c) return;
    chosenId = null;
    expiredNoPick = false;

    els.counter.textContent = `Case ${caseIndex + 1} of ${cases.length}`;
    els.persona.textContent = c.persona;
    els.title.textContent = c.title;
    els.scenario.textContent = c.scenario;

    renderCase();
    startTimer();
  }

  function renderFinal() {
    if (timer) timer.stop();
    els.phaseLabel.textContent = 'Complete';
    els.counter.textContent = 'Complete';
    els.persona.textContent = '';
    els.title.textContent = 'Decision Room Complete';
    els.scenario.textContent = '';
    els.stage.innerHTML = `
      <div class="qz-final-board">
        <div class="fb-eyebrow">Round Complete</div>
        <h1>All ${cases.length} Cases Worked Through</h1>
        <p style="font-size:18px;color:var(--body-text);max-width:700px;margin:12px auto 0;">
          Different situation every time, same instinct needed:
        </p>
        <p class="lr-cta" style="margin-top:18px;">STOP before you act. VERIFY through a channel you already trust. REPORT it either way.</p>
        <div class="le-remember-card">
          <i class="fa-solid fa-thumbtack"></i>
          <div>
            <div class="le-remember-eyebrow">Remember This</div>
            <div class="le-remember-text">${LiveEvent.escapeHtml(rememberThisText)}</div>
          </div>
        </div>
      </div>
    `;
    els.btnRow.innerHTML = '<a class="le-btn primary lg" href="clue-quest.html"><i class="fa-solid fa-forward"></i> Up Next: Cyber Clue Quest - Recall</a><a class="le-btn ghost lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>';
    els.dots.innerHTML = '';
  }

  function next() {
    if (done) return;
    if (!chosenId && !expiredNoPick) return;
    if (caseIndex < cases.length - 1) {
      caseIndex += 1;
      startCase();
    } else {
      done = true;
      renderFinal();
    }
  }

  function prev() {
    if (done) {
      done = false;
      caseIndex = cases.length - 1;
      startCase();
      return;
    }
    if (caseIndex > 0) {
      caseIndex -= 1;
      startCase();
    }
  }

  // Brief framing screen before the cases start - see console.css's
  // "UNDERSTANDING LAYER" section. One screen, no timer, dismissed by Start.
  function beginActivity() {
    if (!contentData) return;
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    startCase();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    beginActivity();
  }

  if (els.introStartBtn) els.introStartBtn.addEventListener('click', dismissIntro);

  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    next: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    prev: () => { if (introDismissed) prev(); }
  });

  // Lightweight local shortcut for calling out an option live - 1-4 picks option A-D.
  // Self-contained to this page; doesn't touch shared keyboard nav.
  document.addEventListener('keydown', (e) => {
    if (!introDismissed || done || chosenId || expiredNoPick) return;
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx === -1) return;
    const decision = currentCase().decisions[0];
    if (!decision || idx >= decision.options.length) return;
    selectOption(decision.options[idx].id);
  });

  fetch('../content/decision-room.json')
    .then((r) => r.json())
    .then((json) => {
      cases = json.cases;
      rememberThisText = json.rememberThis || '';
      if (els.introText) els.introText.textContent = json.whyThisMatters || '';
      contentData = json;
      if (introDismissed) beginActivity();
    })
    .catch((err) => {
      els.stage.innerHTML = '<p style="color:#fff;">Couldn\'t load this activity\'s content - check your connection or refresh.</p>';
      console.error(err);
    });
})();
