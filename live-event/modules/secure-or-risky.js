/* Secure or Risky? — AI Edition rapid-fire binary choice game.
   Space = start/next, S = vote Secure, R = vote Risky, → = next (after reveal).
   Self-contained: restarts at beginning when finished. */
(function () {
  let items = [];
  let index = -1; // -1 = intro, 0..items.length-1 = rounds
  let voted = false;

  const els = {
    introScreen: document.getElementById('introScreen'),
    roundScreen: document.getElementById('roundScreen'),
    counter: document.getElementById('itemCounter'),
    scenarioCard: document.getElementById('scenarioCard'),
    scenarioText: document.getElementById('scenarioText'),
    voteSecure: document.getElementById('voteSecure'),
    voteRisky: document.getElementById('voteRisky'),
    revealPanel: document.getElementById('revealPanel'),
    resultText: document.getElementById('resultText'),
    lessonText: document.getElementById('lessonText'),
    dots: document.getElementById('progressDots'),
    nextBtn: document.getElementById('nextBtn'),
    startBtn: document.getElementById('startBtn')
  };

  function renderDots() {
    els.dots.innerHTML = items.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function renderItem() {
    const item = items[index];
    if (!item) return;
    els.counter.textContent = `Scenario ${index + 1} of ${items.length}`;
    els.scenarioText.textContent = item.scenario;
    els.revealPanel.classList.remove('show');
    els.resultText.textContent = '';
    els.lessonText.textContent = '';
    els.voteSecure.disabled = false;
    els.voteRisky.disabled = false;
    els.voteSecure.classList.remove('chosen', 'correct', 'incorrect');
    els.voteRisky.classList.remove('chosen', 'correct', 'incorrect');
    els.nextBtn.disabled = true;
    voted = false;
    const isLast = index === items.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start'
      : '<i class="fa-solid fa-forward"></i> Next Scenario';
    renderDots();
  }

  function begin() {
    if (index !== -1) return;
    index = 0;
    els.introScreen.classList.add('le-hidden');
    els.roundScreen.classList.remove('le-hidden');
    renderItem();
  }

  function restart() {
    index = -1;
    voted = false;
    els.roundScreen.classList.add('le-hidden');
    els.introScreen.classList.remove('le-hidden');
    renderDots();
  }

  function vote(choice) {
    if (voted) return;
    voted = true;

    const item = items[index];
    const isCorrect = choice === item.answer;
    const chosenBtn = choice === 'SECURE' ? els.voteSecure : els.voteRisky;
    const otherBtn = choice === 'SECURE' ? els.voteRisky : els.voteSecure;

    chosenBtn.classList.add('chosen', isCorrect ? 'correct' : 'incorrect');
    otherBtn.classList.add(isCorrect ? 'incorrect' : 'correct');
    els.voteSecure.disabled = true;
    els.voteRisky.disabled = true;

    els.resultText.innerHTML = isCorrect
      ? '<i class="fa-solid fa-check"></i> <strong>CORRECT</strong> — It is ' + item.answer
      : '<i class="fa-solid fa-xmark"></i> <strong>INCORRECT</strong> — The answer is ' + item.answer;
    els.resultText.className = 'sr-result ' + (isCorrect ? 'correct' : 'incorrect');
    els.lessonText.textContent = item.explanation;
    els.revealPanel.classList.add('show');
    els.nextBtn.disabled = false;
  }

  function next() {
    if (index === -1) { begin(); return; }
    if (!voted) return;
    if (index < items.length - 1) { index++; renderItem(); return; }
    restart();
  }

  function prev() {
    if (index > 0) { index--; renderItem(); }
  }

  if (els.startBtn) els.startBtn.addEventListener('click', begin);
  els.voteSecure.addEventListener('click', () => vote('SECURE'));
  els.voteRisky.addEventListener('click', () => vote('RISKY'));
  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({
    advance: () => { if (index === -1) begin(); else if (!voted) vote('SECURE'); else next(); },
    next,
    prev,
    // Allow S/R keys for voting
    reveal: () => {} // no-op
  });

  // Add S/R key handlers for voting
  document.addEventListener('keydown', (e) => {
    if (index === -1 || voted) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); vote('SECURE'); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); vote('RISKY'); }
  });

  fetch('../content/secure-or-risky.json')
    .then((r) => r.json())
    .then((data) => {
      items = data.items || [];
      renderDots();
    })
    .catch((err) => {
      els.scenarioText.textContent = 'Failed to load content/secure-or-risky.json';
      console.error(err);
    });
})();
