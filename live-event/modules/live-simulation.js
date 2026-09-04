/* Live Simulation — Social-Engineering Virtual Environment
   4 persona-based attack-chain scenarios + OSINT → Teams/SMS → Portal → CSO Fraud flow
   Facilitator-driven, keyboard-first, self-contained — no scoring, restartable */
(function () {
  let data = null;
  let scenarioIdx = 0;
  let stage = 0; // 0..beats.length-1 = thread, beats.length = hold, beats.length+1 = reveal, (+1 for globalReveal on last scenario)
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;
  const stageEl = document.getElementById('stage');
  const dotsEl = document.getElementById('progressDots');
  const scenarioNavEl = document.getElementById('scenarioNav');
  const scenarioMetaEl = document.getElementById('scenarioMeta');
  const flowBarEl = document.getElementById('flowBar');
  const introScreen = document.getElementById('introScreen');
  const activityBody = document.getElementById('activityBody');
  const introText = document.getElementById('introText');
  const introStartBtn = document.getElementById('introStartBtn');

  function currentScenario() {
    if (data.scenarios && data.scenarios.length) return data.scenarios[scenarioIdx];
    return data;
  }

  function isLastScenario() {
    return data.scenarios && scenarioIdx === data.scenarios.length - 1;
  }

  function maxStage() {
    const sc = currentScenario();
    const n = sc.beats ? sc.beats.length : 0;
    // last scenario has an extra globalReveal stage after its reveal
    return n + 1 + (isLastScenario() ? 1 : 0);
  }

  function esc(s) { return LiveEvent.escapeHtml(s ?? ''); }

  function channelIcon(channel) {
    const map = {
      linkedin: 'fa-brands fa-linkedin',
      osint: 'fa-solid fa-magnifying-glass',
      email: 'fa-solid fa-envelope',
      attachment: 'fa-solid fa-paperclip',
      teams: 'fa-brands fa-microsoft',
      sms: 'fa-solid fa-mobile-screen',
      portal: 'fa-solid fa-globe',
      vendor: 'fa-solid fa-building'
    };
    return map[channel] || 'fa-solid fa-circle';
  }

  function channelLabel(channel) {
    const map = {
      linkedin: 'LinkedIn',
      osint: 'OSINT Tool',
      email: 'Email',
      attachment: 'Attachment',
      teams: 'Teams',
      sms: 'SMS',
      portal: 'Portal',
      vendor: 'External Vendor'
    };
    return map[channel] || channel;
  }

  function isExternalSender(sender) {
    if (!sender || !sender.address) return false;
    const a = sender.address.toLowerCase();
    return a.includes('external')
      || a.includes('protonmail.ch')
      || a.includes('protonmail')
      || a.includes('outlook.com')
      || a.includes('gmail.com')
      || a.includes('bit.ly')
      || a.includes('amazonses.com')
      || a.includes('synergymarine-group')
      || a.includes('portal-synergymarine')
      || a.includes('horizon-provisions')
      || a.includes('-secure')
      || a.includes('secure.net')
      || a.includes('spoof');
  }

  function buildMessageEl(beat, idx) {
    const sender = beat.sender || currentScenario().sender || { name: 'Unknown', title: '', initials: '?' };
    const ch = (beat.channel || 'email').toLowerCase();
    const external = isExternalSender(sender) || ch === 'sms' || (sender.address && sender.address.toLowerCase().includes('external'));
    const avatarText = sender.initials || sender.name?.charAt(0) || '?';
    const severityClass = beat.severity === 'critical' ? ' severity-critical' : '';

    let artifactHtml = '';
    let windowTitle = 'Message';
    let windowIcon = channelIcon(ch);

    if (ch === 'linkedin') {
      windowTitle = 'LinkedIn — Search';
      artifactHtml = `
        <div class="ls-linkedin-card">
          <img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='24' fill='%23e2e8f0'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='18' font-family='Barlow'%3ERK%3C/text%3E%3C/svg%3E" />
          <div>
            <div class="ls-linkedin-name">Rajesh Kumar · 3/O — MV Horizon</div>
            <div class="ls-linkedin-role">Synergy Marine Group · India · 500+ connections · Joined 2021</div>
            <div style="font-size:11px;color:#0ea5e9;margin-top:4px;"><i class="fa-brands fa-linkedin"></i> Public profile · Vessel: MV Horizon · Location: Singapore</div>
          </div>
        </div>`;
    } else if (ch === 'osint') {
      windowTitle = 'OSINT Tool — Hunter';
      artifactHtml = `<div class="ls-artifact"><i class="fa-solid fa-wand-magic-sparkles"></i> Predicted 18 addresses — try rajesh.kumar@synergymarinegroup.com — <b>Valid format 92%</b></div>`;
    } else if (ch === 'attachment') {
      const isMalicious = (beat.meta && beat.meta.includes('.exe')) || beat.text.includes('.exe') || beat.address?.includes('Application');
      if (beat.text.includes('Payslip_March.pdf.exe') || isMalicious) {
        artifactHtml = `
          <div class="ls-attachment-card malicious" data-malicious="true">
            <div class="ls-att-icon exe">EXE</div>
            <div>
              <div class="ls-att-name">Payslip_March.pdf.exe</div>
              <div class="ls-att-meta">1.1 MB · Application · Double extension — <b>.exe is real type</b></div>
            </div>
            <i class="fa-solid fa-triangle-exclamation" style="margin-left:auto;color:#ef4444"></i>
          </div>
          <div class="ls-attachment-card malicious" data-malicious="true" style="margin-top:8px">
            <div class="ls-att-icon zip">ZIP</div>
            <div>
              <div class="ls-att-name">Documents.zip</div>
              <div class="ls-att-meta">3.4 MB · Archive · Password: 1234 — generic name</div>
            </div>
          </div>
          <div class="ls-artifact" style="border-color:#fecaca;background:#fef2f2;color:#991b1b"><i class="fa-solid fa-shield-halved"></i> Hover: Windows hides known extensions — .pdf.exe shows as .pdf</div>`;
        windowTitle = 'HR Email — Attachment Preview';
        windowIcon = 'fa-solid fa-paperclip';
      } else {
        artifactHtml = `
          <div class="ls-attachment-card">
            <div class="ls-att-icon pdf">PDF</div>
            <div><div class="ls-att-name">Payslip_Feb2025_RajKumar.pdf</div><div class="ls-att-meta">480 KB · PDF — Expected</div></div>
            <i class="fa-solid fa-check" style="margin-left:auto;color:#16a34a"></i>
          </div>
          <div class="ls-attachment-card" style="margin-top:8px">
            <div class="ls-att-icon xls">XLS</div>
            <div><div class="ls-att-name">Rotation_Roster_MV-Horizon_Feb-Apr.xlsx</div><div class="ls-att-meta">210 KB · Spreadsheet — Expected</div></div>
            <i class="fa-solid fa-check" style="margin-left:auto;color:#16a34a"></i>
          </div>`;
        windowTitle = 'HR Email — Legit Attachments';
      }
    } else if (ch === 'email' && beat.text.includes('portal.synergymarinegroup.com')) {
      if (beat.meta && beat.meta.includes('Display:')) {
        const display = 'https://portal.synergymarinegroup.com/crew/rotation-confirm';
        const href = 'https://portal-synergymarine-group-secure.net/crew/verify?id=42';
        artifactHtml = `
          <div class="ls-link-preview" data-href="${esc(href)}" role="button" tabindex="0" aria-label="Link preview — click to reveal destination">
            <i class="fa-solid fa-link" style="color:#2563eb"></i>
            <span class="ls-link-text">${esc(display)}</span>
            <span class="ls-ext-badge">CLICK TO INSPECT</span>
            <div class="ls-link-tooltip malicious">Actual href: ${esc(href)} · Also: bit.ly/CrewRotation-Horizon — <b>Display ≠ destination</b></div>
          </div>
          <div class="ls-artifact"><i class="fa-solid fa-arrow-pointer"></i> Click or tap the blue link — real destination is lookalike with “-secure.net”</div>`;
        windowTitle = 'Email — Link Mismatch';
      } else if (beat.sender && beat.sender.address.includes('portal')) {
        artifactHtml = `
          <div class="ls-link-preview" style="border-color:#bbf7d0;background:#f0fdf4">
            <i class="fa-solid fa-link" style="color:#16a34a"></i>
            <span class="ls-link-text" style="color:#14532d">https://portal.synergymarinegroup.com/crew/rotation-confirm — matches display ✓</span>
          </div>`;
        windowTitle = 'Email — Legit Portal Link';
      }
    } else if (ch === 'sms') {
      windowTitle = 'Phone — SMS';
    } else if (ch === 'teams') {
      windowTitle = 'Microsoft Teams';
    } else if (ch === 'portal') {
      windowTitle = 'Endpoint — Execution';
      if (beat.text.includes('beacon') || beat.text.includes('PowerShell')) {
        artifactHtml = `<div class="ls-artifact" style="border-color:#fecaca;background:#fef2f2;color:#7f1d1d"><i class="fa-solid fa-bug"></i> Simulated: Macro → PowerShell → C2 beacon — no real payload executed</div>`;
      }
    }

    const liveBadge = external ? '<span class="ls-live-badge"><span class="dot"></span> LIVE EXTERNAL</span>' : '<span class="ls-live-badge" style="background:#f0fdf4;border-color:#bbf7d0;color:#14532d"><span class="dot" style="background:#22c55e"></span> LIVE INTERNAL</span>';
    const avatarHtml = ch === 'sms' ? `<div class="ls-avatar" style="background:#22c55e;color:#fff">💬</div>` : ch === 'linkedin' ? `<div class="ls-avatar" style="background:linear-gradient(135deg,#0ea5e9,#0284c7)"><i class="${windowIcon}"></i></div>` : `<div class="ls-avatar">${esc(avatarText)}</div>`;

    if (ch === 'sms') {
      return `
        <div class="${external ? 'ls-msg external' : 'ls-msg'}${severityClass}" data-channel="${ch}" data-severity="${esc(beat.severity || 'normal')}">
          ${avatarHtml}
          <div class="ls-bubble ls-sms-bubble" style="padding:0;overflow:visible">
            <div class="ls-window-bar" style="background:#f0fdf4;border-bottom-color:#bbf7d0"><span class="ls-traffic"><span class="dot g"></span></span> SMS — 06:12 <span style="margin-left:auto;font-size:10px;color:#14532d">via spoofed gateway</span></div>
            <div style="padding:14px">
              <div class="ls-channel"><i class="${channelIcon(ch)}"></i> ${esc(channelLabel(ch))} · ${esc(beat.label)} ${external ? '<span class="ls-ext-badge">EXTERNAL</span>' : ''}</div>
              <div class="ls-meta"><span class="ls-sender-name">${esc(sender.name)} — ${esc(sender.title)}</span><span>${esc(beat.timestamp)}</span></div>
              <div class="ls-address">${esc(sender.address)}</div>
              <div class="ls-text">${esc(beat.text)}</div>
              ${artifactHtml || (beat.meta ? `<div class="ls-artifact">${esc(beat.meta)}</div>` : '')}
              <div class="ls-phone-frame" style="margin-top:12px">
                <div class="ls-phone-notch"></div>
                <div class="ls-phone-msg">${esc(beat.text)}</div>
                <div style="font-size:10px;color:#86efac;text-align:center;margin-top:6px">bit.ly link — tap target → lookalike</div>
              </div>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="${external ? 'ls-msg external' : 'ls-msg'}${severityClass}" data-channel="${ch}" data-severity="${esc(beat.severity || 'normal')}">
        ${avatarHtml}
        <div class="ls-bubble ${ch === 'teams' ? 'ls-teams-bubble' : ch === 'osint' || ch === 'linkedin' ? 'ls-osint-card' : ''}" style="padding:0;overflow:visible">
          <div class="ls-window-bar">
            <span class="ls-traffic"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></span>
            <i class="${windowIcon}"></i> ${esc(windowTitle)} ${liveBadge}
          </div>
          <div style="padding:16px 18px">
            <div class="ls-channel"><i class="${channelIcon(ch)}"></i> ${esc(channelLabel(ch))} · ${esc(beat.label)} ${external ? '<span class="ls-ext-badge">EXTERNAL</span>' : ''}</div>
            <div class="ls-meta"><span class="ls-sender-name">${esc(sender.name)} — ${esc(sender.title)}</span><span>${esc(beat.timestamp)}</span></div>
            <div class="ls-address">${esc(sender.address)}</div>
            <div class="ls-text">${esc(beat.text)}</div>
            ${artifactHtml || (beat.meta ? `<div class="ls-artifact">${esc(beat.meta)}</div>` : '')}
          </div>
        </div>
      </div>`;
  }

  function buildTypingEl() {
    const sc = currentScenario();
    const initials = sc.sender?.initials || '?';
    return `
      <div class="ls-msg ls-typing">
        <div class="ls-avatar">${esc(initials)}</div>
        <div class="ls-bubble ls-typing-bubble"><span></span><span></span><span></span></div>
      </div>`;
  }

  function renderScenarioNav() {
    if (!scenarioNavEl || !data.scenarios) return;
    scenarioNavEl.innerHTML = data.scenarios.map((sc, i) => {
      const active = i === scenarioIdx ? 'active' : '';
      const done = i < scenarioIdx ? 'done' : '';
      return `<button class="ls-scenario-tab ${active} ${done}" data-idx="${i}" type="button">
        <span class="lst-num">${esc(sc.label)}</span>
        <span class="lst-title">${esc(sc.title)}</span>
        <span class="lst-persona">${esc(sc.persona)}</span>
        <span class="lst-vector">${esc(sc.vector)}</span>
      </button>`;
    }).join('');
    scenarioNavEl.querySelectorAll('.ls-scenario-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        scenarioIdx = parseInt(btn.dataset.idx, 10);
        stage = 0;
        render();
      });
    });
  }

  function renderScenarioMeta() {
    if (!scenarioMetaEl) return;
    const sc = currentScenario();
    if (!sc.persona) { scenarioMetaEl.innerHTML = ''; return; }
    scenarioMetaEl.innerHTML = `
      <div class="ls-scenario-meta">
        <span class="ls-meta-persona"><i class="fa-solid fa-user-tag"></i> ${esc(sc.persona)}</span>
        <span class="ls-meta-dot">·</span>
        <span class="ls-meta-vector"><i class="fa-solid fa-shield-virus"></i> ${esc(sc.vector)}</span>
        <span class="ls-meta-dot">·</span>
        <span class="ls-meta-channel">${esc(sc.channelSummary)}</span>
      </div>
      <div class="ls-scenario-desc">${esc(sc.description)}</div>
    `;
  }

  function renderFlowBar() {
    if (!flowBarEl) return;
    const sc = currentScenario();
    const beats = sc.beats || [];
    const steps = beats.map(b => channelLabel(b.channel));
    const flow = [];
    steps.forEach(s => { if (flow[flow.length-1] !== s) flow.push(s); });
    flow.push('Hold');
    flow.push('Lessons');
    if (isLastScenario()) flow.push('Full Flow');
    flowBarEl.innerHTML = flow.map((label, i) => {
      const n = beats.length;
      let isActive = false;
      let isDone = false;
      if (!isLastScenario()) {
        isActive = (i === stage) || (i === n && stage === n) || (i === n+1 && stage > n);
        isDone = i < stage;
      } else {
        // last scenario has extra stage
        if (stage <= n+1) {
          isActive = (i === stage) || (i === n && stage === n) || (i === n+1 && stage === n+1);
          isDone = i < stage;
        } else {
          // globalReveal stage
          isActive = i === flow.length - 1;
          isDone = i < flow.length - 1;
        }
      }
      const cls = isActive ? 'active' : isDone ? 'done' : '';
      const arrow = i < flow.length - 1 ? '<span class="ls-flow-arrow">→</span>' : '';
      return `<span class="ls-flow-step ${cls}">${esc(label)}</span>${arrow}`;
    }).join('');
  }

  function renderDots() {
    if (!dotsEl) return;
    const sc = currentScenario();
    const beats = sc.beats || [];
    const n = beats.length;
    // during globalReveal, keep dots at last beat state
    let effectiveStage = stage;
    if (isLastScenario() && stage > n+1) effectiveStage = n+1;
    dotsEl.innerHTML = beats.map((_, i) => {
      const cls = i === effectiveStage ? 'dot current' : (i < effectiveStage ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function renderThread(upToBeat) {
    const sc = currentScenario();
    const beats = sc.beats || [];
    const targetCount = upToBeat + 1;
    let container = stageEl.querySelector('.ls-thread');
    if (!container) {
      stageEl.innerHTML = '<div class="ls-thread"></div>';
      container = stageEl.querySelector('.ls-thread');
    }
    const currentCount = container.children.length;
    if (targetCount < currentCount) {
      while (container.children.length > targetCount) container.removeChild(container.lastElementChild);
      return;
    }
    const addingOne = targetCount - currentCount === 1;
    for (let i = currentCount; i < targetCount; i++) {
      if (addingOne) {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildTypingEl();
        const typingEl = tmp.firstElementChild;
        container.appendChild(typingEl);
        typingEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        setTimeout(() => {
          if (!typingEl.isConnected) return;
          const wrap = document.createElement('div');
          wrap.innerHTML = buildMessageEl(beats[i], i);
          const msgEl = wrap.firstElementChild;
          container.replaceChild(msgEl, typingEl);
          msgEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 520);
      } else {
        const wrap = document.createElement('div');
        wrap.innerHTML = buildMessageEl(beats[i], i);
        container.appendChild(wrap.firstElementChild);
      }
    }
  }

  function renderHold() {
    const sc = currentScenario();
    const hp = sc.holdPrompt || data.holdPrompt || { title: 'What would you do?', body: '' };
    stageEl.innerHTML = `
      <div class="ls-hold">
        <div class="ls-hold-kicker">${esc(sc.persona)} · ${esc(sc.vector)}</div>
        <h2>${esc(hp.title)}</h2>
        <p>${esc(hp.body)}</p>
        <div class="ls-hold-hint"><i class="fa-solid fa-keyboard"></i> SPACE to reveal lessons · ← to step back</div>
      </div>`;
  }

  function layerTagsHtml(layers) {
    const hits = (layers || []).filter((l) => l.wouldStopIt);
    if (!hits.length) return '';
    return `
      <div class="ls-layer-tags-label"><i class="fa-solid fa-layer-group"></i> Would have stopped it here</div>
      <div class="ls-layer-tags">
        ${hits.map((l) => `<span class="ls-layer-tag"><i class="fa-solid fa-shield-halved"></i> ${esc(l.name)}</span>`).join('')}
      </div>`;
  }

  function renderReveal() {
    const sc = currentScenario();
    const r = sc.reveal || data.reveal;
    if (!r) { stageEl.innerHTML = '<div class="ls-hold"><h2>End of scenario</h2></div>'; return; }
    const flagsHtml = (r.redFlags || []).map(f => `
      <div class="lr-flag">
        <i class="${esc(f.icon)}"></i>
        <h4>${esc(f.label)}</h4>
        <p>${esc(f.detail)}</p>
      </div>`).join('');
    const isLast = isLastScenario();
    stageEl.innerHTML = `
      <div class="ls-reveal">
        <div class="ls-reveal-kicker">${esc(sc.persona)} · ${esc(sc.vector)}</div>
        <div class="lr-title">${esc(r.title)}</div>
        <div class="lr-subtitle">${esc(r.subtitle)}</div>
        <div class="lr-flags">${flagsHtml}</div>
        ${layerTagsHtml(r.layers)}
        <div class="lr-cta">${esc(r.callToAction)}</div>
        <div class="ls-final-actions">
          ${!isLast ? `<button class="le-btn primary lg" id="nextScenarioBtn" type="button"><i class="fa-solid fa-forward"></i> Next Scenario — ${esc(data.scenarios[scenarioIdx+1].title)}</button>` : ''}
          <button class="le-btn ${!isLast ? 'ghost' : 'primary'} lg" id="restartScenarioBtn" type="button"><i class="fa-solid fa-rotate"></i> Replay Scenario</button>
          <a class="le-btn ghost lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>
        </div>
      </div>`;
    const nextBtn = document.getElementById('nextScenarioBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => { scenarioIdx = Math.min(scenarioIdx+1, data.scenarios.length-1); stage=0; render(); });
    document.getElementById('restartScenarioBtn').addEventListener('click', () => { stage=0; render(); });
  }

  function layersGridHtml(layers) {
    if (!layers || !layers.length) return '';
    const rows = layers.map((l) => {
      const cells = [1, 2, 3, 4].map((n) => {
        const hit = (l.hitScenarios || []).includes(n);
        return `<div class="ls-layers-cell ${hit ? 'hit' : 'miss'}"><i class="fa-solid ${hit ? 'fa-check' : 'fa-minus'}"></i></div>`;
      }).join('');
      return `
        <div class="ls-layers-name">${esc(l.name)}</div>
        ${cells}
        <div class="ls-layers-summary">${esc(l.summary)}</div>`;
    }).join('');
    return `
      <div class="ls-layers-grid">
        <div class="ls-layers-header-label">Defense Layer</div>
        <div class="ls-layers-header-col">S1</div>
        <div class="ls-layers-header-col">S2</div>
        <div class="ls-layers-header-col">S3</div>
        <div class="ls-layers-header-col">S4</div>
        ${rows}
      </div>`;
  }

  function renderGlobalReveal() {
    const r = data.globalReveal;
    if (!r) { stageEl.innerHTML = '<div class="ls-hold"><h2>End of simulation</h2></div>'; return; }
    const flagsHtml = (r.redFlags || []).map(f => `
      <div class="lr-flag">
        <i class="${esc(f.icon)}"></i>
        <h4>${esc(f.label)}</h4>
        <p>${esc(f.detail)}</p>
      </div>`).join('');
    stageEl.innerHTML = `
      <div class="ls-reveal ls-global-reveal">
        <div class="ls-global-timeline">
          <span class="ls-timeline-step"><i class="fa-brands fa-linkedin"></i> Day 1 — OSINT</span>
          <span class="ls-timeline-arrow">→</span>
          <span class="ls-timeline-step"><i class="fa-solid fa-paperclip"></i> Day 4 — Attachment</span>
          <span class="ls-timeline-arrow">→</span>
          <span class="ls-timeline-step"><i class="fa-brands fa-microsoft"></i> Day 5 — Teams/SMS</span>
          <span class="ls-timeline-arrow">→</span>
          <span class="ls-timeline-step is-critical"><i class="fa-solid fa-building-columns"></i> Day 6 — Wire</span>
        </div>
        <div class="lr-title">${esc(r.title)}</div>
        <div class="lr-subtitle">${esc(r.subtitle)}</div>
        <div class="lr-flags">${flagsHtml}</div>
        ${r.layersIntro ? `<div class="ls-layers-intro">${esc(r.layersIntro)}</div>` : ''}
        ${layersGridHtml(r.layers)}
        <div class="lr-cta">${esc(r.callToAction)}</div>
        <div class="le-remember-card">
          <i class="fa-solid fa-thumbtack"></i>
          <div>
            <div class="le-remember-eyebrow">Remember This</div>
            <div class="le-remember-text">${esc(rememberThisText)}</div>
          </div>
        </div>
        <div class="ls-final-actions">
          <a class="le-btn primary lg" href="myth-vs-fact.html"><i class="fa-solid fa-forward"></i> Up Next: Myth vs Fact — Correct</a>
          <button class="le-btn ghost lg" id="restartAllBtnGlobal" type="button"><i class="fa-solid fa-arrows-rotate"></i> Restart All</button>
          <a class="le-btn ghost lg" href="../index.html"><i class="fa-solid fa-house"></i> Back to Console</a>
        </div>
      </div>`;
    document.getElementById('restartAllBtnGlobal').addEventListener('click', () => { scenarioIdx=0; stage=0; render(); });
  }

  function renderGlobalIntro() {
    const header = document.getElementById('simHeader');
    if (header && data.title) {
      header.innerHTML = `
        <div class="ls-virtual-badge"><i class="fa-solid fa-vr-cardboard"></i> VIRTUAL ENVIRONMENT</div>
        <h1 class="ls-sim-title">${esc(data.title)}</h1>
        <p class="ls-sim-subtitle">${esc(data.subtitle)}</p>
        <p class="ls-sim-intro">${esc(data.intro.body)}</p>
      `;
    }
  }

  function render() {
    renderScenarioNav();
    renderScenarioMeta();
    renderFlowBar();
    renderGlobalIntro();
    const sc = currentScenario();
    const n = sc.beats?.length || 0;
    if (stage < n) {
      renderThread(stage);
    } else if (stage === n) {
      renderHold();
    } else if (stage === n+1) {
      renderReveal();
    } else if (isLastScenario() && stage === n+2) {
      renderGlobalReveal();
    } else {
      renderReveal();
    }
    renderDots();
    if (scenarioNavEl) {
      scenarioNavEl.querySelectorAll('.ls-scenario-tab').forEach((b, i) => {
        b.classList.toggle('active', i===scenarioIdx);
      });
    }
  }

  function advance() {
    const m = maxStage();
    if (stage >= m) {
      if (data.scenarios && scenarioIdx < data.scenarios.length -1) { scenarioIdx++; stage=0; } else { stage=0; scenarioIdx=0; }
    } else {
      stage = Math.min(stage+1, m);
    }
    render();
  }

  function back() {
    if (stage > 0) stage--;
    else if (scenarioIdx > 0) { scenarioIdx--; stage = maxStage() -1; }
    else stage = 0;
    render();
  }

  function skipToReveal() {
    const sc = currentScenario();
    const n = sc.beats?.length || 0;
    stage = n+1;
    render();
  }

  function showOverlay(title, body) {
    const ov = document.getElementById('virtualOverlay');
    if (!ov) return;
    document.getElementById('overlayTitle').textContent = title;
    document.getElementById('overlayBody').textContent = body;
    ov.classList.remove('le-hidden');
  }
  function hideOverlay() {
    const ov = document.getElementById('virtualOverlay');
    if (ov) ov.classList.add('le-hidden');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#overlayClose') || e.target.closest('#virtualOverlay')) {
      if (e.target.id === 'virtualOverlay' || e.target.closest('#overlayClose')) hideOverlay();
    }
    const att = e.target.closest('.ls-attachment-card.malicious');
    if (att) {
      e.preventDefault();
      showOverlay('Execution Blocked — Simulation', 'In a real system, double-clicking Payslip_March.pdf.exe would have launched an EXE, not a PDF. Windows hides the true .exe extension by default — the PDF icon is fake. This is why HR/Payroll must verify file type and expectation before enabling macros.');
    }
    const link = e.target.closest('.ls-link-preview[data-href]');
    if (link) {
      e.preventDefault();
      showOverlay('Link Destination Revealed', 'Displayed: portal.synergymarinegroup.com — Actual href: ' + link.dataset.href + ' — Always hover/long-press on mobile. The blue text can be any string; the href is what the browser follows.');
    } else {
      const linkPlain = e.target.closest('.ls-link-preview');
      if (linkPlain && linkPlain.dataset.href) {
        e.preventDefault();
        showOverlay('Link Destination Revealed', 'Displayed: portal.synergymarinegroup.com — Actual href: ' + linkPlain.dataset.href + ' — Always hover/long-press on mobile.');
      }
    }
  });

  // Brief framing screen before the simulation starts — see console.css's
  // "UNDERSTANDING LAYER" section. One screen, no timer, dismissed by Start.
  function beginActivity() {
    if (!contentData) return;
    introScreen.classList.add('le-hidden');
    activityBody.classList.remove('le-hidden');
    render();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    beginActivity();
  }

  if (introStartBtn) introStartBtn.addEventListener('click', dismissIntro);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) { dismissIntro(); return; } advance(); },
    next: () => { if (!introDismissed) { dismissIntro(); return; } advance(); },
    prev: () => { if (introDismissed) back(); },
    reveal: () => { if (introDismissed) skipToReveal(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('virtualOverlay').classList.contains('le-hidden')) {
      hideOverlay();
      e.preventDefault();
      return;
    }
    if (!introDismissed) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4 && data && data.scenarios && data.scenarios[n-1]) {
      e.preventDefault();
      scenarioIdx = n - 1;
      stage = 0;
      render();
    }
  });

  fetch('../content/live-simulation.json')
    .then(r => r.json())
    .then(json => {
      data = json;
      rememberThisText = data.rememberThis || '';
      if (introText) introText.textContent = data.whyThisMatters || '';
      if (!data.scenarios) {
        data.scenarios = [{
          id: 'legacy',
          label: '01',
          title: data.sender ? `${data.sender.title} Impersonation` : 'Simulation',
          persona: 'All Staff',
          vector: 'Authority',
          channelSummary: 'Chat',
          description: '',
          sender: data.sender,
          beats: data.beats,
          holdPrompt: data.holdPrompt,
          reveal: data.reveal
        }];
      }
      contentData = data;
      if (introDismissed) beginActivity();
    })
    .catch(err => {
      stageEl.innerHTML = '<p style="color:#fff;">Failed to load content/live-simulation.json</p>';
      console.error(err);
    });
})();
