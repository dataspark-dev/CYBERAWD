/* Decision Room - branching-decision cases with clickable options.
   Each case presents a scenario, then 0-3 decision points in a row; picking an option shows
   its outcome inline (good vs. consequence) and always continues to the next decision, the
   case debrief, or straight to the next case - nothing is a dead end.

   Two paces, chosen per case rather than for the whole activity - this module merges what used
   to be two separate activities (Decision Room's own 6 long cases, and Closing Quiz/"Rapid
   Fire"'s 10 quick calls folded in as short cases, see content/decision-room.json):
     - LONG cases (3 decisions): one calm, ambient, SILENT clock per case (not per decision, not
       urgency-styled - .dr-calm-timer) since this is a discuss-as-a-room activity, not a race.
     - SHORT cases (1 decision, or 0 decisions + a debrief-only reveal): a tight, urgent per-case
       clock (.qz-urgent-timer) with a quickening tick in the final seconds, matching Rapid
       Fire's old high-energy pacing. A short 1-decision case whose timer runs out reveals the
       good option (without attributing a choice that was never made) so the room keeps moving  - 
       long cases never auto-reveal; Next stays gated on an actual pick there.
   Self-contained: no scoring, no leaderboard, standalone endpoint like every other reworked
   module. */
(function () {
  const CASE_TIMER_SECONDS = 90;  // long cases - one ambient clock per case, silent
  const QUIZ_TIMER_SECONDS = 15;  // short 1-decision cases (ex Rapid Fire quiz questions)
  const SVR_TIMER_SECONDS = 20;   // short 0-decision debrief-only cases (ex Rapid Fire SVR prompts)
  let cases = [];
  let caseIndex = 0;
  let decisionIndex = 0;
  let selections = []; // chosen option id per decision, for the current case
  let expiredNoPick = false; // current decision's brisk timer ran out with nothing chosen
  let phase = 'decision'; // 'decision' | 'debrief'
  let done = false;
  let timer = null;

  const els = {
    counter: document.getElementById('itemCounter'),
    phaseLabel: document.getElementById('phaseLabel'),
    persona: document.getElementById('casePersona'),
    title: document.getElementById('caseTitle'),
    scenario: document.getElementById('caseScenario'),
    stage: document.getElementById('decisionStage'),
    path: document.getElementById('casePath'),
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

  function isShortCase(c) {
    return c.decisions.length !== 3;
  }

  function renderDots() {
    els.dots.innerHTML = cases.map((_, i) => {
      const cls = i === caseIndex ? 'dot current' : (i < caseIndex ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  // The within-case "path" - connected nodes for this case's own decisions (0-3 of them), so
  // the narrative arc is visible, not just an overall count. A 0-decision short case simply
  // renders no nodes at all.
  function renderPath() {
    if (!els.path) return;
    const c = currentCase();
    const allDone = phase === 'debrief';
    const parts = [];
    c.decisions.forEach((_, i) => {
      const cls = allDone || i < decisionIndex ? 'done' : (i === decisionIndex ? 'current' : '');
      parts.push(`<div class="dr-path-node ${cls}">${i + 1}</div>`);
      if (i < c.decisions.length - 1) {
        const lineDone = allDone || i < decisionIndex ? 'done' : '';
        parts.push(`<div class="dr-path-line ${lineDone}"></div>`);
      }
    });
    els.path.innerHTML = parts.join('');
  }

  function updateNextButton() {
    const c = currentCase();
    if (phase === 'debrief') {
      const isLastCase = caseIndex === cases.length - 1;
      els.nextBtn.disabled = false;
      els.nextBtn.innerHTML = isLastCase
        ? '<i class="fa-solid fa-flag-checkered"></i> Finish'
        : '<i class="fa-solid fa-forward"></i> Next Case';
      return;
    }
    const isLastDecision = decisionIndex === c.decisions.length - 1;
    els.nextBtn.disabled = !selections[decisionIndex] && !expiredNoPick;
    if (isLastDecision && !c.debrief) {
      // Short 1-decision case with no debrief of its own - Next goes straight to the next
      // case (or Finish), so the button should say that, not "See Debrief".
      const isLastCase = caseIndex === cases.length - 1;
      els.nextBtn.innerHTML = isLastCase
        ? '<i class="fa-solid fa-flag-checkered"></i> Finish'
        : '<i class="fa-solid fa-forward"></i> Next Case';
    } else {
      els.nextBtn.innerHTML = isLastDecision
        ? '<i class="fa-solid fa-forward"></i> See Debrief'
        : '<i class="fa-solid fa-forward"></i> Next Decision';
    }
  }

  function renderDecisionStep() {
    const c = currentCase();
    const decision = c.decisions[decisionIndex];
    const chosenId = selections[decisionIndex];
    const chosenOpt = decision.options.find((o) => o.id === chosenId);

    els.phaseLabel.textContent = `Decision ${decisionIndex + 1} of ${c.decisions.length}`;

    const optionsHtml = decision.options.map((opt, i) => {
      const isChosen = chosenId === opt.id;
      const outcomeClass = isChosen ? ` ${opt.outcome}` : '';
      return `
        <button class="dr-option${isChosen ? ' selected' : ''}${outcomeClass}" data-id="${opt.id}" type="button" ${chosenId ? 'disabled' : ''}>
          <span class="dr-opt-letter">${letterFor(i)}</span>
          <span class="dr-opt-text">${LiveEvent.escapeHtml(opt.text)}</span>
        </button>`;
    }).join('');

    els.stage.innerHTML = `
      <div class="dr-scene">
        <div class="dr-prompt">${LiveEvent.escapeHtml(decision.prompt)}</div>
        <div class="dr-options">${optionsHtml}</div>
        <div class="dr-feedback${chosenOpt ? ` show ${chosenOpt.outcome}` : ''}" id="feedbackBox">${chosenOpt ? LiveEvent.escapeHtml(chosenOpt.feedback) : ''}</div>
      </div>
    `;

    Array.from(els.stage.querySelectorAll('.dr-option')).forEach((btn) => {
      btn.addEventListener('click', () => selectOption(btn.dataset.id));
    });

    updateNextButton();
    renderDots();
    renderPath();
  }

  function selectOption(optId) {
    if (done || phase !== 'decision' || selections[decisionIndex] || expiredNoPick) return;
    selections[decisionIndex] = optId;
    renderDecisionStep();
  }

  // Brisk-timer expiry on a short 1-decision case: reveal which option was good WITHOUT
  // attributing a choice that was never made (selections[decisionIndex] stays unset) - same
  // "keep moving, no lingering" spirit as Rapid Fire's old auto-reveal, just layered onto
  // Decision Room's own pick-and-see-outcome interaction instead of a separate correct/
  // incorrect model. Reuses the exact existing .dr-option.selected.good / .dr-feedback.good
  // styling (see console.css) rather than inventing a new visual state.
  function revealGoodOptionOnTimeout() {
    if (done || phase !== 'decision') return;
    const c = currentCase();
    const decision = c.decisions[decisionIndex];
    if (!decision || selections[decisionIndex]) return;
    expiredNoPick = true;
    const goodOpt = decision.options.find((o) => o.outcome === 'good');
    Array.from(els.stage.querySelectorAll('.dr-option')).forEach((btn) => {
      btn.disabled = true;
      if (goodOpt && btn.dataset.id === goodOpt.id) btn.classList.add('selected', 'good');
    });
    if (goodOpt) {
      const feedbackBox = document.getElementById('feedbackBox');
      if (feedbackBox) {
        feedbackBox.textContent = goodOpt.feedback;
        feedbackBox.className = 'dr-feedback show good';
      }
    }
    updateNextButton();
  }

  function renderDebrief() {
    const c = currentCase();
    els.phaseLabel.textContent = 'Debrief';
    els.stage.innerHTML = `
      <div class="dr-debrief-panel">
        <div class="ff-r-row">
          <i class="fa-solid fa-lightbulb"></i>
          <div>
            <div class="ff-r-label">Debrief</div>
            <div class="ff-r-text">${LiveEvent.escapeHtml(c.debrief)}</div>
          </div>
        </div>
      </div>
    `;
    updateNextButton();
    renderDots();
    renderPath();
    if (timer) timer.stop();
  }

  // A short, quickening tick in the final seconds - pace/energy only, unique to short cases
  // (long cases stay silent and calm). One shared, lazily-created AudioContext for the whole
  // page: each tick just schedules a new independent oscillator on it, so ticks can never
  // "stack" even if a facilitator moves through short cases quickly - every case's timer is
  // stopped before the next one starts, so at most one timer is ever live. Ported verbatim from
  // the former closing-quiz.js (Rapid Fire), which had the same one-shot-oscillator design.
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
    const c = currentCase();
    const short = isShortCase(c);
    els.timerEl.classList.toggle('dr-calm-timer', !short);
    els.timerEl.classList.toggle('qz-urgent-timer', short);
    if (!short) {
      timer = LiveEvent.createTimer(els.timerEl, CASE_TIMER_SECONDS, {
        onExpire: () => {},
        silent: true
      });
    } else {
      const isDecisionCase = c.decisions.length === 1;
      const seconds = isDecisionCase ? QUIZ_TIMER_SECONDS : SVR_TIMER_SECONDS;
      timer = LiveEvent.createTimer(els.timerEl, seconds, {
        onExpire: () => { if (isDecisionCase) revealGoodOptionOnTimeout(); },
        onTick: tickSound
      });
    }
    timer.start();
  }

  function startCase() {
    const c = currentCase();
    if (!c) return;
    decisionIndex = 0;
    selections = new Array(c.decisions.length).fill(null);
    expiredNoPick = false;

    els.counter.textContent = `Case ${caseIndex + 1} of ${cases.length}`;
    els.persona.textContent = c.persona;
    els.title.textContent = c.title;
    els.scenario.textContent = c.scenario;

    if (c.decisions.length === 0) {
      // Short debrief-only case (ex Rapid Fire SVR prompt) - nothing to decide, go straight
      // to its reveal text under its own brisk timer.
      phase = 'debrief';
      renderDebrief();
    } else {
      phase = 'decision';
      renderDecisionStep();
    }
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
    if (els.path) els.path.innerHTML = '';
  }

  // Shared "case is fully done" transition - decision-phase (short case with no debrief of its
  // own) and debrief-phase both land here once there's nothing left to show for this case.
  function advanceToNextCaseOrFinish() {
    if (caseIndex < cases.length - 1) {
      caseIndex += 1;
      startCase();
    } else {
      done = true;
      renderFinal();
    }
  }

  function next() {
    if (done) return;
    const c = currentCase();
    if (phase === 'decision') {
      if (!selections[decisionIndex] && !expiredNoPick) return;
      if (decisionIndex < c.decisions.length - 1) {
        decisionIndex += 1;
        expiredNoPick = false;
        renderDecisionStep();
      } else if (c.debrief) {
        phase = 'debrief';
        renderDebrief();
      } else {
        // Short 1-decision case with no debrief of its own (ex Rapid Fire quiz question)  - 
        // its per-option feedback already gave the "here's why" beat, so go straight on.
        advanceToNextCaseOrFinish();
      }
      return;
    }
    // phase === 'debrief'
    advanceToNextCaseOrFinish();
  }

  // Lands on the END of case `idx` - its debrief if it has one, else its last decision (a short
  // 1-decision case has no debrief, so backing into it from the case after should land on its
  // one decision, not a nonexistent debrief screen).
  function enterCaseAtEnd(idx) {
    caseIndex = idx;
    const c = cases[idx];
    if (c.debrief) {
      phase = 'debrief';
      renderDebrief();
    } else {
      phase = 'decision';
      decisionIndex = Math.max(0, c.decisions.length - 1);
      renderDecisionStep();
    }
  }

  function prev() {
    if (done) {
      done = false;
      enterCaseAtEnd(cases.length - 1);
      return;
    }
    if (phase === 'debrief') {
      const c = currentCase();
      if (c.decisions.length === 0) {
        // Debrief-only short case - nothing to back into within this case, step back a
        // whole case instead.
        if (caseIndex > 0) enterCaseAtEnd(caseIndex - 1);
        return;
      }
      phase = 'decision';
      decisionIndex = c.decisions.length - 1;
      renderDecisionStep();
      return;
    }
    if (decisionIndex > 0) {
      decisionIndex -= 1;
      renderDecisionStep();
    } else if (caseIndex > 0) {
      enterCaseAtEnd(caseIndex - 1);
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

  // Lightweight local shortcut for calling out an option live - 1/2/3 pick
  // option A/B/C. Self-contained to this page; doesn't touch shared keyboard nav.
  document.addEventListener('keydown', (e) => {
    if (!introDismissed || done || phase !== 'decision') return;
    // Short 1-decision cases (ex Rapid Fire quiz questions) can have up to 4 options, unlike
    // the original 2-3 option long-case decisions - cover all four digits.
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx === -1) return;
    const decision = currentCase().decisions[decisionIndex];
    if (!decision || idx >= decision.options.length || selections[decisionIndex]) return;
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
