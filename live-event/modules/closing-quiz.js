/* Rapid Fire — persona-tagged scenario questions at pace.
   Quiz questions and STOP-VERIFY-REPORT prompts are merged into one
   continuous, timed sequence — same visual/timer treatment for both, though
   SVR steps get a longer countdown since they reveal a full sentence, not a
   single highlighted choice.
   Deliberately high-energy: tight per-step timer with the most pronounced
   urgency styling in the app (see .qz-urgent-timer), a quickening tick in the
   final seconds, and hard, instant cuts between items — no lingering.
   Contrast Decision Room's slow, ambient, non-urgent per-case clock.
   Self-contained: no scoring, no leaderboard, restarts at beginning when finished. */
(function () {
  const QUIZ_TIMER_SECONDS = 15;
  const SVR_TIMER_SECONDS = 20;
  let data = null;
  let steps = [];
  let index = 0;
  let revealed = false;
  let done = false;
  let timer = null;

  const stageEl = document.getElementById('stage');
  const itemCounter = document.getElementById('itemCounter');
  const personaEl = document.getElementById('stepPersona');
  const subtitleEl = document.getElementById('quizSubtitle');

  function letterFor(i) {
    return String.fromCharCode(65 + i);
  }

  function buildSteps() {
    steps = [
      ...data.questions.map((q) => ({ ...q, type: 'quiz' })),
      ...data.stopVerifyReportPrompts.map((s) => ({ ...s, type: 'svr' }))
    ];
  }

  function renderDots() {
    return steps.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function timerSecondsFor(step) {
    return step.type === 'svr' ? SVR_TIMER_SECONDS : QUIZ_TIMER_SECONDS;
  }

  // A short, quickening tick in the final seconds — pace/energy only, and
  // unique to Rapid Fire (Decision Room's timer stays silent and calm).
  // One shared, lazily-created AudioContext for the whole page: each tick
  // just schedules a new independent oscillator on it (the standard Web
  // Audio pattern for one-shot sounds), so ticks can never "stack" or leak
  // contexts even if items are clicked through far faster than a timer's
  // final 5 seconds — natural ticks from one timer are always 1s apart,
  // long clear of each blip's own 120ms length, and every step/reveal stops
  // its timer before the next one starts, so at most one timer is ever live.
  // The 300ms guard below is a second, independent safety net: the shared
  // setInterval-based timer can rarely double-fire a couple of ms apart
  // (observed under test, unrelated to clicking speed), and this keeps that
  // from ever producing two audible, overlapping blips.
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
      // Web Audio unavailable — silently skip the tick.
    }
  }

  function startTimer(step) {
    const el = document.getElementById('timer');
    if (!el) return;
    if (timer) timer.stop();
    timer = LiveEvent.createTimer(el, timerSecondsFor(step), {
      onExpire: reveal,
      onTick: tickSound
    });
    timer.start();
  }

  function renderQuizStep(step) {
    const isLast = index === steps.length - 1;
    const choicesHtml = step.choices.map((choice, i) => `
      <div class="qz-choice" data-idx="${i}">
        <span class="qz-letter">${letterFor(i)}</span>
        <span>${LiveEvent.escapeHtml(choice)}</span>
      </div>`).join('');

    stageEl.innerHTML = `
      <div class="qz-question">${LiveEvent.escapeHtml(step.question)}</div>
      <div class="qz-choices">${choicesHtml}</div>
      <div class="qz-explanation" id="explanationBox">${LiveEvent.escapeHtml(step.explanation)}</div>
      <div class="le-timer qz-urgent-timer" id="timer">
        <div class="lt-digits">${QUIZ_TIMER_SECONDS}</div>
        <div class="lt-label">Seconds</div>
      </div>
      <div class="le-btn-row" style="margin-top:26px;">
        <button class="le-btn amber lg" id="revealBtn" type="button"><i class="fa-solid fa-eye"></i> Reveal (R)</button>
        <button class="le-btn primary lg" id="nextBtn" type="button"><i class="fa-solid fa-forward"></i> ${isLast ? 'Finish' : 'Next Step'}</button>
      </div>
      <div class="le-progress-dots qz-dots">${renderDots()}</div>
    `;
    document.getElementById('revealBtn').addEventListener('click', reveal);
    document.getElementById('nextBtn').addEventListener('click', next);
    startTimer(step);
  }

  function renderSvrStep(step) {
    const isLast = index === steps.length - 1;
    stageEl.innerHTML = `
      <div class="svr-scenario-card">
        <div class="svr-scenario-text">${LiveEvent.escapeHtml(step.scenario)}</div>
        <div class="svr-response" id="explanationBox">${LiveEvent.escapeHtml(step.idealResponse)}</div>
      </div>
      <div class="le-timer qz-urgent-timer" id="timer">
        <div class="lt-digits">${SVR_TIMER_SECONDS}</div>
        <div class="lt-label">Seconds</div>
      </div>
      <div class="le-btn-row" style="margin-top:26px;">
        <button class="le-btn amber lg" id="revealBtn" type="button"><i class="fa-solid fa-eye"></i> Reveal (R)</button>
        <button class="le-btn primary lg" id="nextBtn" type="button"><i class="fa-solid fa-forward"></i> ${isLast ? 'Finish' : 'Next Step'}</button>
      </div>
      <div class="le-progress-dots qz-dots">${renderDots()}</div>
    `;
    document.getElementById('revealBtn').addEventListener('click', reveal);
    document.getElementById('nextBtn').addEventListener('click', next);
    startTimer(step);
  }

  function renderStep() {
    const step = steps[index];
    if (!step) return;
    revealed = false;
    itemCounter.textContent = `Step ${index + 1} of ${steps.length}`;
    if (personaEl) {
      personaEl.textContent = step.persona;
      // Retrigger the flash animation every step — a quick badge pop, not a
      // calmly-persisting header (that's Decision Room's treatment).
      personaEl.classList.remove('flash');
      void personaEl.offsetWidth;
      personaEl.classList.add('flash');
    }
    if (step.type === 'quiz') renderQuizStep(step);
    else renderSvrStep(step);
  }

  function reveal() {
    if (done || revealed) return;
    revealed = true;
    if (timer) timer.stop();

    const step = steps[index];
    if (step.type === 'quiz') {
      const correctChoice = stageEl.querySelector(`.qz-choice[data-idx="${step.correctIndex}"]`);
      if (correctChoice) correctChoice.classList.add('correct');
    }
    const box = document.getElementById('explanationBox');
    if (box) box.classList.add('show');
    const revealBtn = document.getElementById('revealBtn');
    if (revealBtn) revealBtn.disabled = true;
  }

  function renderFinal() {
    if (timer) timer.stop();
    itemCounter.textContent = 'Complete';
    if (personaEl) personaEl.textContent = '';
    stageEl.innerHTML = `
      <div class="qz-final-board">
        <div class="fb-eyebrow">Round Complete</div>
        <h1>Rapid Fire — Wrap-Up</h1>
        <p style="font-size:18px;color:var(--body-text);max-width:700px;margin:12px auto 0;">
          Whatever the situation — a call, a text, an email, a Teams message — the move is always the same:
        </p>
        <p class="lr-cta" style="margin-top:18px;">STOP before you act. VERIFY through a channel you already trust. REPORT it either way.</p>
      </div>
      <div class="qz-final-actions">
        <a class="le-btn primary lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>
      </div>
    `;
  }

  function next() {
    if (done) return;
    if (index < steps.length - 1) {
      index += 1;
      renderStep();
    } else {
      done = true;
      renderFinal();
    }
  }

  function prev() {
    if (done) {
      done = false;
      index = steps.length - 1;
      renderStep();
      return;
    }
    if (index > 0) {
      index -= 1;
      renderStep();
    }
  }

  LiveEvent.onAction({ advance: next, next, prev, reveal });

  fetch('../content/closing-quiz.json')
    .then((r) => r.json())
    .then((json) => {
      data = json;
      buildSteps();
      if (subtitleEl) subtitleEl.textContent = data.subtitle || '';
      renderStep();
    })
    .catch((err) => {
      stageEl.innerHTML = '<p style="color:#fff;">Failed to load content/closing-quiz.json</p>';
      console.error(err);
    });
})();
