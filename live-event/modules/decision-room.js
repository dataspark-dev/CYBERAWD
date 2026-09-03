/* Decision Room — branching-decision cases with clickable options.
   Each case presents a scenario, then 2-3 decision points in a row; picking
   an option shows its outcome inline (good vs. consequence) and always
   continues to the next decision or the case debrief — nothing is a dead end.
   Deliberately slow-paced: one calm, ambient clock per case (not per decision,
   and not urgency-styled — see .dr-calm-timer) since this is a discuss-as-a-
   room activity, not a race. Contrast Rapid Fire's tight, urgent per-step timer.
   Self-contained: no scoring, no leaderboard, standalone endpoint like every
   other reworked module. */
(function () {
  const CASE_TIMER_SECONDS = 90; // one ambient clock for the whole case — never resets per decision
  let cases = [];
  let caseIndex = 0;
  let decisionIndex = 0;
  let selections = []; // chosen option id per decision, for the current case
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
    dots: document.getElementById('progressDots')
  };

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

  // The within-case "path" — 3 connected nodes for this case's decisions,
  // so the narrative arc is visible, not just an overall count.
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
    els.nextBtn.disabled = !selections[decisionIndex];
    els.nextBtn.innerHTML = isLastDecision
      ? '<i class="fa-solid fa-forward"></i> See Debrief'
      : '<i class="fa-solid fa-forward"></i> Next Decision';
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
    if (done || phase !== 'decision' || selections[decisionIndex]) return;
    selections[decisionIndex] = optId;
    renderDecisionStep();
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

  function startTimer() {
    if (timer) timer.stop();
    timer = LiveEvent.createTimer(els.timerEl, CASE_TIMER_SECONDS, {
      onExpire: () => {},
      silent: true
    });
    timer.start();
  }

  function startCase() {
    const c = currentCase();
    if (!c) return;
    decisionIndex = 0;
    selections = new Array(c.decisions.length).fill(null);
    phase = 'decision';

    els.counter.textContent = `Case ${caseIndex + 1} of ${cases.length}`;
    els.persona.textContent = c.persona;
    els.title.textContent = c.title;
    els.scenario.textContent = c.scenario;

    renderDecisionStep();
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
        <div class="fb-eyebrow">Decision Room Complete</div>
        <h1>All 6 Cases Worked Through</h1>
        <p style="font-size:18px;color:var(--body-text);max-width:700px;margin:12px auto 0;">
          Different situation every time, same instinct needed:
        </p>
        <p class="lr-cta" style="margin-top:18px;">STOP before you act. VERIFY through a channel you already trust. REPORT it either way.</p>
      </div>
    `;
    els.btnRow.innerHTML = '<a class="le-btn primary lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>';
    els.dots.innerHTML = '';
    if (els.path) els.path.innerHTML = '';
  }

  function next() {
    if (done) return;
    const c = currentCase();
    if (phase === 'decision') {
      if (!selections[decisionIndex]) return;
      if (decisionIndex < c.decisions.length - 1) {
        decisionIndex += 1;
        renderDecisionStep();
      } else {
        phase = 'debrief';
        renderDebrief();
      }
      return;
    }
    // phase === 'debrief'
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
      phase = 'debrief';
      renderDebrief();
      return;
    }
    if (phase === 'debrief') {
      phase = 'decision';
      decisionIndex = currentCase().decisions.length - 1;
      renderDecisionStep();
      return;
    }
    if (decisionIndex > 0) {
      decisionIndex -= 1;
      renderDecisionStep();
    } else if (caseIndex > 0) {
      caseIndex -= 1;
      phase = 'debrief';
      renderDebrief();
    }
  }

  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({ advance: next, next, prev });

  // Lightweight local shortcut for calling out an option live — 1/2/3 pick
  // option A/B/C. Self-contained to this page; doesn't touch shared keyboard nav.
  document.addEventListener('keydown', (e) => {
    if (done || phase !== 'decision') return;
    const idx = ['1', '2', '3'].indexOf(e.key);
    if (idx === -1) return;
    const decision = currentCase().decisions[decisionIndex];
    if (!decision || idx >= decision.options.length || selections[decisionIndex]) return;
    selectOption(decision.options[idx].id);
  });

  fetch('../content/decision-room.json')
    .then((r) => r.json())
    .then((json) => {
      cases = json;
      startCase();
    })
    .catch((err) => {
      els.stage.innerHTML = '<p style="color:#fff;">Failed to load content/decision-room.json</p>';
      console.error(err);
    });
})();
