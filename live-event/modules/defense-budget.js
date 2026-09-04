/* Defense Budget — standalone budget-allocation exercise
   Single flow, no bidding, no teams, no scoring.
   Budget → lock → scenario reveal with same hit/miss language as Live Simulation.
   Facilitator-driven, keyboard-first, self-contained. */
(function () {
  let data = null;
  let controls = [];
  let scenarios = [];
  let budgetTotal = 100;
  let selected = new Set();
  let phase = 'alloc'; // 'alloc' | 'reveal' | 'wrap'
  let scenarioIdx = 0;
  let introDismissed = false;
  let contentData = null;
  let rememberThisText = '';

  const stageEl = document.getElementById('stage');
  const dotsEl = document.getElementById('progressDots');
  const phaseLabelEl = document.getElementById('phaseLabel');
  const introScreen = document.getElementById('introScreen');
  const activityBody = document.getElementById('activityBody');
  const introText = document.getElementById('introText');
  const introStartBtn = document.getElementById('introStartBtn');

  function esc(s) { return LiveEvent.escapeHtml(s ?? ''); }

  function spent() {
    let total = 0;
    selected.forEach(id => {
      const c = controls.find(x => x.id === id);
      if (c) total += Number(c.cost) || 0;
    });
    return total;
  }

  function remaining() { return budgetTotal - spent(); }

  function isOverBudget() { return remaining() < 0; }

  function totalSteps() { return 1 + scenarios.length + 1; }

  function renderDots() {
    if (!dotsEl) return;
    const steps = totalSteps();
    let activeIdx = 0;
    if (phase === 'alloc') activeIdx = 0;
    else if (phase === 'reveal') activeIdx = 1 + scenarioIdx;
    else if (phase === 'wrap') activeIdx = steps - 1;
    dotsEl.innerHTML = Array.from({ length: steps }, (_, i) => {
      const cls = i === activeIdx ? 'dot current' : (i < activeIdx ? 'dot done' : 'dot');
      return `<span class="${cls}" aria-hidden="true"></span>`;
    }).join('');
  }

  function renderPhaseLabel() {
    if (!phaseLabelEl) return;
    if (phase === 'alloc') {
      phaseLabelEl.textContent = `Budget: ${spent()} / ${budgetTotal}`;
      phaseLabelEl.style.color = isOverBudget() ? 'var(--red)' : '';
    } else if (phase === 'reveal') {
      phaseLabelEl.textContent = `Attack ${scenarioIdx + 1} of ${scenarios.length}`;
    } else if (phase === 'wrap') {
      phaseLabelEl.textContent = 'Wrap-up';
    }
  }

  function layerControl(layerName) {
    return controls.find(c => c.layer === layerName);
  }

  function renderAlloc() {
    const sp = spent();
    const rem = remaining();
    const over = isOverBudget();
    const pct = Math.min(100, Math.max(0, (sp / budgetTotal) * 100));
    const barColor = over ? 'var(--red)' : sp > budgetTotal * 0.85 ? 'var(--amber)' : 'var(--cyan)';

    const gridHtml = controls.map((c, idx) => {
      const isSelected = selected.has(c.id);
      const num = idx + 1;
      const affordable = !isSelected && (sp + Number(c.cost) > budgetTotal);
      return `
        <button class="db-control ${isSelected ? 'selected' : ''} ${affordable ? 'would-exceed' : ''}" data-id="${esc(c.id)}" data-idx="${idx}" type="button" aria-pressed="${isSelected ? 'true' : 'false'}">
          <div class="db-control-top">
            <span class="db-control-num">${num}</span>
            <span class="db-control-cost"><i class="fa-solid fa-coins"></i> ${esc(String(c.cost))}</span>
            <span class="db-control-check" aria-hidden="true"><i class="fa-solid ${isSelected ? 'fa-check' : 'fa-plus'}"></i></span>
          </div>
          <div class="db-control-icon"><i class="${esc(c.icon || 'fa-solid fa-shield-halved')}"></i></div>
          <div class="db-control-layer">${esc(c.layer)}</div>
          <div class="db-control-name">${esc(c.name)}</div>
          <div class="db-control-desc">${esc(c.description)}</div>
          <div class="db-control-helps"><i class="fa-solid fa-circle-info"></i> ${esc(c.helpsWith || '')}</div>
        </button>`;
    }).join('');

    // Live interactive preview — understandable at a glance, updates as you toggle
    const previewRows = scenarios.map(sc => {
      let hits = 0, covered = 0;
      controls.forEach(c => { if (sc.controlOutcomes && sc.controlOutcomes[c.layer]) { hits++; if (selected.has(c.id)) covered++; }});
      const cells = controls.map(c => {
        const would = sc.controlOutcomes && sc.controlOutcomes[c.layer];
        const funded = selected.has(c.id);
        const cls = would ? 'hit' : 'miss';
        const ring = funded ? ' funded-ring' : '';
        const icon = would ? 'fa-check' : 'fa-minus';
        return `<span class="db-layers-cell ${cls}${ring}" style="width:20px;height:20px;font-size:9px" title="${esc(c.layer)} — ${would ? 'Would help' : 'No effect'}${funded ? ' · FUNDED' : ''}"><i class="fa-solid ${icon}"></i></span>`;
      }).join('');
      const status = covered === 0 ? 'none' : covered === hits ? 'full' : 'partial';
      return `<div class="db-preview-row ${status}">
        <div class="db-preview-scen"><span class="db-coverage-num">${esc(sc.label)}</span> ${esc(sc.title)} <span class="db-preview-persona">${esc(sc.persona)}</span></div>
        <div class="db-preview-cells">${cells}</div>
        <div class="db-preview-score ${status}">${covered}/${hits} would-help layers funded</div>
      </div>`;
    }).join('');

    const selectedList = controls.filter(c => selected.has(c.id)).map(c => esc(c.layer)).join(' · ') || 'None yet';
    const lockDisabled = over || selected.size === 0;
    const hint = over ? `Over budget by ${Math.abs(rem)} — deselect something to lock in.`
               : selected.size === 0 ? 'Select at least one control — try 3–4 layers to stay under 100.'
               : rem === 0 ? 'Exactly on budget — ready to lock.'
               : `${rem} units left — preview updates live below. Add or lock now.`;

    stageEl.innerHTML = `
      <div class="db-alloc">
        <div class="db-budget-head">
          <div class="db-budget-titles">
            <div class="db-budget-eyebrow">Your Budget — choose what you can afford</div>
            <h2 class="db-budget-title">Allocate <span>${budgetTotal} units</span> across 7 layers</h2>
            <p class="db-budget-sub">Total of all 7 is ${controls.reduce((a,c)=>a+Number(c.cost),0)} — you <b>cannot</b> afford everything. Pick the gaps you can live with.</p>
          </div>
          <div class="db-budget-meter-wrap">
            <div class="db-budget-numbers">
              <span class="db-spent ${over ? 'over' : ''}">${sp} spent</span>
              <span class="db-remaining ${over ? 'over' : ''}">${rem >= 0 ? rem + ' left' : Math.abs(rem) + ' over'}</span>
              <span class="db-total">/ ${budgetTotal}</span>
            </div>
            <div class="db-meter" role="progressbar" aria-valuenow="${sp}" aria-valuemin="0" aria-valuemax="${budgetTotal}">
              <div class="db-meter-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            <div class="db-meter-labels"><span>0</span><span>${budgetTotal}</span></div>
            <div class="db-selected-list"><i class="fa-solid fa-list-check"></i> ${selectedList}</div>
          </div>
        </div>

        <div class="db-controls-grid">${gridHtml}</div>

        <div class="db-live-preview">
          <div class="db-preview-header"><i class="fa-solid fa-wand-magic-sparkles"></i> Live preview — coverage with your current picks <span class="db-preview-hint">(updates as you toggle)</span></div>
          <div class="db-preview-list">${previewRows}</div>
          <div class="db-preview-legend"><span class="db-layers-cell hit" style="width:16px;height:16px;font-size:8px"><i class="fa-solid fa-check"></i></span> Would help &nbsp; <span class="db-layers-cell miss" style="width:16px;height:16px;font-size:8px"><i class="fa-solid fa-minus"></i></span> No effect &nbsp; <span class="db-layers-cell hit funded-ring" style="width:16px;height:16px;font-size:8px"><i class="fa-solid fa-check"></i></span> You funded</div>
        </div>

        <div class="db-alloc-hint ${over ? 'over' : ''}"><i class="fa-solid ${over ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i> ${esc(hint)}</div>

        <div class="db-alloc-actions">
          <button class="le-btn primary lg" id="lockBtn" type="button" ${lockDisabled ? 'disabled' : ''}><i class="fa-solid fa-lock"></i> Lock Budget &amp; Reveal Attacks</button>
          <button class="le-btn ghost lg" id="clearBtn" type="button" ${selected.size===0 ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> Clear</button>
        </div>
        <div class="db-alloc-footnote">Keyboard: press <kbd>1</kbd>-<kbd>7</kbd> to toggle · <kbd>Space</kbd> to lock when ready</div>
      </div>`;

    // bind toggles
    stageEl.querySelectorAll('.db-control').forEach(btn => {
      btn.addEventListener('click', () => toggleControl(btn.dataset.id));
    });
    const lockBtn = document.getElementById('lockBtn');
    if (lockBtn) lockBtn.addEventListener('click', () => lockIn());
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => { selected.clear(); render(); });

    renderDots();
    renderPhaseLabel();
  }

  function toggleControl(id) {
    if (phase !== 'alloc') return;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    render();
  }

  function lockIn() {
    if (isOverBudget() || selected.size === 0) return;
    phase = 'reveal';
    scenarioIdx = 0;
    render();
  }

  function renderScenario() {
    const sc = scenarios[scenarioIdx];
    if (!sc) { renderWrap(); return; }
    const totalControls = selected.size;
    let wouldHaveHelpedCount = 0;
    let missedHits = [];
    let fundedHits = [];
    let fundedMisses = [];

    const rows = controls.map(c => {
      const layer = c.layer;
      const wouldStop = sc.controlOutcomes && sc.controlOutcomes[layer];
      const isFunded = selected.has(c.id);
      const note = (sc.outcomeNotes && sc.outcomeNotes[layer]) || '';
      if (wouldStop && isFunded) { wouldHaveHelpedCount++; fundedHits.push(layer); }
      if (wouldStop && !isFunded) missedHits.push(layer);
      if (!wouldStop && isFunded) fundedMisses.push(layer);

      // hit/miss visual: wouldStop = hit (green check) else miss (gray minus) — same as LS
      const cellClass = wouldStop ? 'hit' : 'miss';
      const cellIcon = wouldStop ? 'fa-check' : 'fa-minus';
      // funded badge style
      const fundedClass = isFunded ? 'funded' : 'not-funded';
      const fundedLabel = isFunded ? 'FUNDED' : 'NOT FUNDED';
      const rowClass = isFunded ? (wouldStop ? 'funded-hit' : 'funded-miss') : (wouldStop ? 'gap' : 'irrelevant');
      // For accessibility, add title
      return `
        <div class="db-outcome-row ${rowClass}">
          <div class="db-outcome-layer">
            <span class="db-outcome-icon"><i class="${esc(c.icon || 'fa-solid fa-shield-halved')}"></i></span>
            <span class="db-outcome-layer-name">${esc(layer)}</span>
          </div>
          <div class="db-layers-cell ${cellClass}" title="${wouldStop ? 'Would have helped' : 'Would not have helped'}"><i class="fa-solid ${cellIcon}"></i></div>
          <div class="db-funded-badge ${fundedClass}">${fundedLabel}</div>
          <div class="db-outcome-note">${esc(note)}</div>
        </div>`;
    }).join('');

    const verdictParts = [];
    if (fundedHits.length) verdictParts.push(`${fundedHits.length} of your ${totalControls} funded layer${fundedHits.length===1?'':'s'} would have helped here`);
    else verdictParts.push(`None of your ${totalControls} funded layers would have helped here`);
    if (missedHits.length) verdictParts.push(`You left open: ${missedHits.join(' · ')} — those would have blocked this`);
    if (fundedMisses.length) verdictParts.push(`Funded but not needed this time: ${fundedMisses.join(' · ')}`);

    const isLast = scenarioIdx === scenarios.length - 1;

    stageEl.innerHTML = `
      <div class="db-scenario">
        <div class="db-scenario-kicker"><span class="db-scenario-label">${esc(sc.label || String(scenarioIdx+1).padStart(2,'0'))}</span> · ${esc(sc.persona || '')} · ${esc(sc.vector || '')}</div>
        <h2 class="db-scenario-title">${esc(sc.title)}</h2>
        <p class="db-scenario-desc">${esc(sc.description)}</p>
        <div class="db-scenario-narrative"><i class="fa-solid fa-circle-info"></i> ${esc(sc.narrative || '')}</div>

        <div class="db-outcomes">
          <div class="db-outcomes-header">
            <div class="db-outcomes-label"><i class="fa-solid fa-layer-group"></i> Would have helped vs. what you funded</div>
            <div class="db-outcomes-legend">
              <span><span class="db-layers-cell hit" style="width:22px;height:22px;font-size:10px;display:inline-flex;vertical-align:middle;"><i class="fa-solid fa-check"></i></span> Would have helped</span>
              <span><span class="db-layers-cell miss" style="width:22px;height:22px;font-size:10px;display:inline-flex;vertical-align:middle;"><i class="fa-solid fa-minus"></i></span> Would not have helped</span>
              <span><span class="db-funded-badge funded" style="font-size:10px;padding:2px 6px;">FUNDED</span> You funded</span>
            </div>
          </div>
          <div class="db-outcome-list">${rows}</div>
        </div>

        <div class="db-verdict ${wouldHaveHelpedCount > 0 ? 'hit' : 'miss'}">
          <div class="db-verdict-title"><i class="fa-solid ${wouldHaveHelpedCount > 0 ? 'fa-shield-halved' : 'fa-triangle-exclamation'}"></i> ${wouldHaveHelpedCount > 0 ? 'Your budget would have helped here' : 'Your budget would not have helped here'}</div>
          <div class="db-verdict-body">${esc(verdictParts.join(' · '))}</div>
        </div>

        <div class="ls-final-actions">
          ${!isLast ? `<button class="le-btn primary lg" id="nextScBtn" type="button"><i class="fa-solid fa-forward"></i> Next Attack</button>` : `<button class="le-btn primary lg" id="wrapBtn" type="button"><i class="fa-solid fa-flag-checkered"></i> See Wrap-up</button>`}
          <button class="le-btn ghost lg" id="editBudgetBtn" type="button"><i class="fa-solid fa-pen"></i> Edit Budget</button>
          <a class="le-btn ghost lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>
        </div>
      </div>`;

    const nextBtn = document.getElementById('nextScBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => { scenarioIdx++; render(); });
    const wrapBtn = document.getElementById('wrapBtn');
    if (wrapBtn) wrapBtn.addEventListener('click', () => { phase='wrap'; render(); });
    const editBtn = document.getElementById('editBudgetBtn');
    if (editBtn) editBtn.addEventListener('click', () => { phase='alloc'; render(); });

    renderDots();
    renderPhaseLabel();
  }

  function renderWrap() {
    const sp = spent();
    const totalCostAll = controls.reduce((a,c)=>a+Number(c.cost),0);
    const fundedLayers = controls.filter(c=>selected.has(c.id));
    const fundedNames = fundedLayers.map(c=> c.layer).join(' · ') || '—';
    const notFundedLayers = controls.filter(c=>!selected.has(c.id)).map(c=>c.layer).join(' · ') || '—';

    // Coverage analysis across scenarios
    let totalHitsAvailable = 0;
    let totalHitsCovered = 0;
    let totalHitsMissed = 0;
    let perScenarioSummary = scenarios.map(sc => {
      let hitsInScenario = 0;
      let covered = 0;
      let missed = [];
      controls.forEach(c => {
        const would = sc.controlOutcomes && sc.controlOutcomes[c.layer];
        if (would) {
          hitsInScenario++;
          if (selected.has(c.id)) covered++;
          else missed.push(c.layer);
        }
      });
      totalHitsAvailable += hitsInScenario;
      totalHitsCovered += covered;
      totalHitsMissed += (hitsInScenario - covered);
      return {
        sc,
        hitsInScenario,
        covered,
        missed
      };
    });

    const recall = rememberThisText || (data && data.rememberThis) || '';

    stageEl.innerHTML = `
      <div class="db-wrap">
        <div class="db-wrap-hero">
          <div class="db-wrap-eyebrow"><i class="fa-solid fa-flag-checkered"></i> Budget Locked — Here's What You Covered</div>
          <h2 class="db-wrap-title">You spent ${sp} of ${budgetTotal} — no single budget covers every attack</h2>
          <p class="db-wrap-sub">Total of all controls is ${totalCostAll} — you had to leave gaps. The point isn't a perfect score, it's knowing which gaps you left and how you'd catch them another way.</p>
        </div>

        <div class="db-budget-recap">
          <div class="db-recap-card funded">
            <div class="db-recap-label"><i class="fa-solid fa-check"></i> You Funded (${fundedLayers.length})</div>
            <div class="db-recap-value">${esc(fundedNames)}</div>
            <div class="db-recap-cost">Cost: ${sp} units</div>
          </div>
          <div class="db-recap-card not-funded">
            <div class="db-recap-label"><i class="fa-solid fa-minus"></i> You Left Open (${controls.length - fundedLayers.length})</div>
            <div class="db-recap-value">${esc(notFundedLayers)}</div>
            <div class="db-recap-cost">Would have cost +${totalCostAll - sp} more to fund</div>
          </div>
        </div>

        <div class="db-coverage">
          <div class="db-coverage-header"><i class="fa-solid fa-chart-simple"></i> Coverage across ${scenarios.length} attacks — green = would have helped, gray = wouldn't, shaded = you funded</div>
          ${perScenarioSummary.map((row, idx) => `
            <div class="db-coverage-row">
              <div class="db-coverage-scenario">
                <span class="db-coverage-num">${esc(row.sc.label || String(idx+1).padStart(2,'0'))}</span>
                <span class="db-coverage-title">${esc(row.sc.title)}</span>
                <span class="db-coverage-meta">${esc(row.sc.persona || '')}</span>
              </div>
              <div class="db-coverage-cells">
                ${controls.map(c => {
                  const would = row.sc.controlOutcomes[c.layer];
                  const funded = selected.has(c.id);
                  const cellClass = would ? 'hit' : 'miss';
                  const icon = would ? 'fa-check' : 'fa-minus';
                  const fundedRing = funded ? ' funded-ring' : '';
                  return `<div class="db-layers-cell ${cellClass}${fundedRing}" title="${esc(c.layer)} — ${would ? 'Would have helped' : 'Would not have helped'}${funded ? ' · FUNDED' : ''}"><i class="fa-solid ${icon}"></i></div>`;
                }).join('')}
              </div>
              <div class="db-coverage-summary">${row.covered} of ${row.hitsInScenario} helping layers were funded${row.missed.length ? ' · missed: ' + esc(row.missed.join(' · ')) : ' · fully covered for this attack'}</div>
            </div>
          `).join('')}
          <div class="db-coverage-total">
            <span class="db-coverage-total-label">Total</span>
            <span class="db-coverage-total-value">${totalHitsCovered} of ${totalHitsAvailable} helping layers were funded across all scenarios · ${totalHitsMissed} gaps where a would-have-helped layer was left unfunded</span>
          </div>
        </div>

        <div class="le-remember-card">
          <i class="fa-solid fa-thumbtack"></i>
          <div>
            <div class="le-remember-eyebrow">Remember This</div>
            <div class="le-remember-text">${esc(recall)}</div>
          </div>
        </div>

        <div class="ls-final-actions">
          <a class="le-btn primary lg" href="decision-room.html"><i class="fa-solid fa-forward"></i> Up Next: Decision Room — Decide</a>
          <button class="le-btn ghost lg" id="restartBtn" type="button"><i class="fa-solid fa-arrows-rotate"></i> Re-allocate</button>
          <a class="le-btn ghost lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>
        </div>
      </div>`;

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', () => { selected.clear(); phase='alloc'; scenarioIdx=0; render(); });

    renderDots();
    renderPhaseLabel();
  }

  function render() {
    if (phase === 'alloc') renderAlloc();
    else if (phase === 'reveal') renderScenario();
    else if (phase === 'wrap') renderWrap();
    else renderAlloc();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    introScreen.classList.add('le-hidden');
    activityBody.classList.remove('le-hidden');
    render();
  }

  function beginActivity() {
    if (!contentData) return;
    introScreen.classList.add('le-hidden');
    activityBody.classList.remove('le-hidden');
    render();
  }

  function prev() {
    if (phase === 'reveal') {
      if (scenarioIdx > 0) { scenarioIdx--; render(); }
      else { phase='alloc'; render(); }
    } else if (phase === 'wrap') {
      phase='reveal';
      scenarioIdx = scenarios.length - 1;
      render();
    } else if (phase === 'alloc') {
      // at alloc, no back beyond intro — keep
    }
  }

  function next() {
    if (phase === 'alloc') {
      lockIn();
    } else if (phase === 'reveal') {
      if (scenarioIdx < scenarios.length - 1) { scenarioIdx++; render(); }
      else { phase='wrap'; render(); }
    } else if (phase === 'wrap') {
      // stay
    }
  }

  if (introStartBtn) introStartBtn.addEventListener('click', dismissIntro);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    next: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    prev: () => { if (introDismissed) prev(); },
    reveal: () => { if (introDismissed && phase==='alloc') lockIn(); }
  });

  // 1-7 toggles in alloc phase
  document.addEventListener('keydown', (e) => {
    if (!introDismissed || phase !== 'alloc') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= controls.length) {
      e.preventDefault();
      const ctrl = controls[n - 1];
      if (ctrl) toggleControl(ctrl.id);
    }
  });

  fetch('../content/defense-budget.json')
    .then(r => r.json())
    .then(json => {
      data = json;
      controls = json.controls || [];
      scenarios = json.scenarios || [];
      budgetTotal = json.budget ?? 100;
      rememberThisText = json.rememberThis || '';
      if (introText) introText.textContent = json.whyThisMatters || '';
      contentData = json;
      if (introDismissed) beginActivity();
    })
    .catch(err => {
      if (stageEl) stageEl.innerHTML = '<p style="color:#fff;padding:24px;">Failed to load content/defense-budget.json</p>';
      console.error(err);
    });
})();
