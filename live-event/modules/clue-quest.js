/* Cyber Clue Quest — easy riddles + 30s timer + 2-3 interactive options.
   Self-contained: no team scoring, restarts at beginning when finished. */
(function () {
  const TIMER_SECONDS = 30;
  let riddles = [];
  let index = 0;
  let revealed = false;
  let answered = false;
  let timer = null;
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  const els = {
    counter: document.getElementById('itemCounter'),
    riddleText: document.getElementById('riddleText'),
    answerReveal: document.getElementById('answerReveal'),
    rememberCard: document.getElementById('rememberCard'),
    rememberText: document.getElementById('rememberText'),
    optionsContainer: document.getElementById('optionsContainer'),
    feedback: document.getElementById('feedback'),
    timerEl: document.getElementById('timer'),
    revealBtn: document.getElementById('revealBtn'),
    nextBtn: document.getElementById('nextBtn'),
    dots: document.getElementById('progressDots'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };

  function renderDots() {
    els.dots.innerHTML = riddles.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderRiddle() {
    const r = riddles[index];
    if (!r) return;
    els.counter.textContent = `Riddle ${index + 1} of ${riddles.length}`;
    els.riddleText.textContent = r.riddle;
    els.answerReveal.textContent = r.answer;
    els.answerReveal.classList.remove('show');
    els.feedback.textContent = '';
    els.feedback.className = 'cq-feedback';
    els.feedback.classList.remove('show');
    if (els.rememberCard) els.rememberCard.classList.add('le-hidden');

    const isLast = index === riddles.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start'
      : '<i class="fa-solid fa-forward"></i> Next Riddle';

    revealed = false;
    answered = false;

    // Build 2-3 option buttons — shuffle so correct answer isn't always first
    els.optionsContainer.innerHTML = '';
    const opts = r.options && r.options.length ? shuffle(r.options) : [r.answer];
    opts.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cq-option';
      btn.textContent = opt;
      btn.dataset.opt = opt;
      btn.dataset.idx = String(i + 1);
      const label = document.createElement('span');
      label.className = 'cq-opt-num';
      label.textContent = String(i + 1);
      btn.prepend(label);
      btn.addEventListener('click', () => choose(opt, btn));
      els.optionsContainer.appendChild(btn);
    });

    if (timer) timer.stop();
    timer = LiveEvent.createTimer(els.timerEl, TIMER_SECONDS, {
      onExpire: () => {
        if (!answered && !revealed) {
          els.optionsContainer.querySelectorAll('.cq-option').forEach(b => b.disabled = true);
          els.feedback.textContent = 'Time up — tap Reveal to see the answer';
          els.feedback.className = 'cq-feedback show timeout';
        }
      }
    });
    timer.start();
    renderDots();
  }

  function highlightOptions(correctAnswer, chosenBtn) {
    els.optionsContainer.querySelectorAll('.cq-option').forEach(b => {
      b.disabled = true;
      if (b.dataset.opt === correctAnswer) b.classList.add('correct');
      if (b === chosenBtn && b.dataset.opt !== correctAnswer) b.classList.add('incorrect');
    });
  }

  function showRememberIfLast() {
    if (index === riddles.length - 1 && els.rememberCard) {
      els.rememberText.textContent = rememberThisText;
      els.rememberCard.classList.remove('le-hidden');
    }
  }

  function choose(opt, btn) {
    if (answered || revealed) return;
    answered = true;
    revealed = true;
    if (timer) timer.stop();
    const r = riddles[index];
    const isCorrect = opt === r.answer;
    highlightOptions(r.answer, btn);
    els.answerReveal.classList.add('show');
    if (isCorrect) {
      els.feedback.textContent = '✓ Correct! — ' + r.answer;
      els.feedback.className = 'cq-feedback show correct';
    } else {
      els.feedback.textContent = '✗ Not quite — correct is ' + r.answer;
      els.feedback.className = 'cq-feedback show incorrect';
    }
    showRememberIfLast();
  }

  function goTo(newIndex) {
    if (newIndex < 0 || newIndex >= riddles.length) return;
    index = newIndex;
    renderRiddle();
  }

  function next() {
    if (index < riddles.length - 1) { goTo(index + 1); return; }
    index = 0;
    renderRiddle();
  }
  function prev() {
    if (index > 0) goTo(index - 1);
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    answered = true;
    if (timer) timer.stop();
    const r = riddles[index];
    highlightOptions(r.answer, null);
    els.answerReveal.classList.add('show');
    els.feedback.textContent = 'Answer: ' + r.answer;
    els.feedback.className = 'cq-feedback show revealed';
    showRememberIfLast();
  }

  // Brief framing screen before the riddles start — see console.css's
  // "UNDERSTANDING LAYER" section. One screen, no timer, dismissed by Start.
  function beginActivity() {
    if (!contentData) return;
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    renderRiddle();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    beginActivity();
  }

  if (els.introStartBtn) els.introStartBtn.addEventListener('click', dismissIntro);

  els.revealBtn.addEventListener('click', reveal);
  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    next: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    prev: () => { if (introDismissed) prev(); },
    reveal: () => { if (introDismissed) reveal(); }
  });

  // 1,2,3 to pick options
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (['1','2','3'].includes(e.key)) {
      const btns = els.optionsContainer.querySelectorAll('.cq-option');
      const idx = parseInt(e.key, 10) - 1;
      if (btns[idx] && !btns[idx].disabled) {
        e.preventDefault();
        btns[idx].click();
      }
    }
  });

  fetch('../content/clue-quest.json')
    .then((r) => r.json())
    .then((data) => {
      riddles = data.riddles;
      rememberThisText = data.rememberThis || '';
      if (els.introText) els.introText.textContent = data.whyThisMatters || '';
      contentData = data;
      if (introDismissed) beginActivity();
    })
    .catch((err) => {
      els.riddleText.textContent = 'Failed to load content/clue-quest.json';
      console.error(err);
    });
})();
