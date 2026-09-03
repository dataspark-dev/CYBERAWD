/* QR / USB / AI Scam Challenge — Physical prop identification.
   Space = start/next, T = identify threat, S = looks safe, → = next (after reveal).
   Self-contained: restarts at beginning when finished. */
(function () {
  let stations = [];
  let index = -1; // -1 = intro, 0..stations.length-1 = rounds
  let revealed = false;

  const els = {
    introScreen: document.getElementById('introScreen'),
    roundScreen: document.getElementById('roundScreen'),
    propImage: document.getElementById('propImage'),
    propLabel: document.getElementById('propLabel'),
    voteThreat: document.getElementById('voteThreat'),
    voteSafe: document.getElementById('voteSafe'),
    revealPanel: document.getElementById('revealPanel'),
    threatType: document.getElementById('threatType'),
    explanationText: document.getElementById('explanationText'),
    dots: document.getElementById('progressDots'),
    nextBtn: document.getElementById('nextBtn'),
    startBtn: document.getElementById('startBtn')
  };

  function renderDots() {
    els.dots.innerHTML = stations.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function renderStation() {
    const station = stations[index];
    if (!station) return;

    // Show prop image if available, otherwise just label
    if (station.image) {
      els.propImage.src = station.image;
      els.propImage.style.display = 'block';
    } else {
      els.propImage.style.display = 'none';
    }
    els.propLabel.textContent = station.prop;

    els.revealPanel.classList.remove('show');
    els.threatType.textContent = '';
    els.explanationText.textContent = '';
    els.voteThreat.disabled = false;
    els.voteSafe.disabled = false;
    els.voteThreat.classList.remove('chosen', 'correct', 'incorrect');
    els.voteSafe.classList.remove('chosen', 'correct', 'incorrect');
    els.nextBtn.disabled = true;
    revealed = false;
    const isLast = index === stations.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start'
      : '<i class="fa-solid fa-forward"></i> Next Station';
    renderDots();
  }

  function begin() {
    if (index !== -1) return;
    index = 0;
    els.introScreen.classList.add('le-hidden');
    els.roundScreen.classList.remove('le-hidden');
    renderStation();
  }

  function restart() {
    index = -1;
    revealed = false;
    els.roundScreen.classList.add('le-hidden');
    els.introScreen.classList.remove('le-hidden');
    renderDots();
  }

  function vote(isThreat) {
    if (revealed) return;
    revealed = true;

    const station = stations[index];
    const isCorrect = isThreat === true; // All stations are threats in this challenge
    const chosenBtn = isThreat ? els.voteThreat : els.voteSafe;
    const otherBtn = isThreat ? els.voteSafe : els.voteThreat;

    chosenBtn.classList.add('chosen', isCorrect ? 'correct' : 'incorrect');
    otherBtn.classList.add(isCorrect ? 'incorrect' : 'correct');
    els.voteThreat.disabled = true;
    els.voteSafe.disabled = true;

    els.threatType.textContent = station.threat;
    els.explanationText.textContent = station.explanation;
    els.revealPanel.classList.add('show');
    els.nextBtn.disabled = false;
  }

  function next() {
    if (index === -1) { begin(); return; }
    if (!revealed) return;
    if (index < stations.length - 1) { index++; renderStation(); return; }
    restart();
  }

  function prev() {
    if (index > 0) { index--; renderStation(); }
  }

  if (els.startBtn) els.startBtn.addEventListener('click', begin);
  els.voteThreat.addEventListener('click', () => vote(true));
  els.voteSafe.addEventListener('click', () => vote(false));
  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({
    advance: () => { if (index === -1) begin(); else if (!revealed) vote(true); else next(); },
    next,
    prev,
    reveal: () => {}
  });

  // T/S key handlers for voting
  document.addEventListener('keydown', (e) => {
    if (index === -1 || revealed) return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); vote(true); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); vote(false); }
  });

  fetch('../content/qr-usb-scam.json')
    .then((r) => r.json())
    .then((data) => {
      stations = data.stations || [];
      renderDots();
    })
    .catch((err) => {
      els.propLabel.textContent = 'Failed to load content/qr-usb-scam.json';
      console.error(err);
    });
})();
