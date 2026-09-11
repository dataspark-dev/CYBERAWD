/* Myth vs Fact - a quick, unscored knowledge interstitial.
   Not a quiz: one myth per screen, no timer, no right/wrong pressure - just
   read the myth, bust it, read the fact. Calm and readable, closer to
   Decision Room's pace than Rapid Fire's. Self-contained: no scoring,
   standalone endpoint like every other module. */
(function () {
  let items = [];
  let index = 0;
  let revealed = false;
  let done = false;
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  const els = {
    counter: document.getElementById('itemCounter'),
    topic: document.getElementById('itemTopic'),
    myth: document.getElementById('mythText'),
    factWrap: document.getElementById('factWrap'),
    fact: document.getElementById('factText'),
    detail: document.getElementById('detailText'),
    dots: document.getElementById('progressDots'),
    revealBtn: document.getElementById('revealBtn'),
    nextBtn: document.getElementById('nextBtn'),
    itemView: document.getElementById('itemView'),
    finalView: document.getElementById('finalView'),
    rememberText: document.getElementById('rememberText'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };

  function renderDots() {
    els.dots.innerHTML = items.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<button type="button" class="${cls}" data-jump="${i}" aria-label="Go to myth ${i + 1}" title="${items[i] ? items[i].topic : ''} ${i + 1}"></button>`;
    }).join('');
    Array.from(els.dots.querySelectorAll('[data-jump]')).forEach((btn) => {
      btn.addEventListener('click', () => goTo(Number(btn.dataset.jump)));
    });
  }

  function renderItem() {
    const item = items[index];
    if (!item) return;
    els.counter.textContent = `Myth ${index + 1} of ${items.length}`;
    els.topic.textContent = item.topic;
    // Topic tint — matches console.css .mf-topic-tag.topic-*
    els.topic.className = 'mf-topic-tag';
    const t = (item.topic || '').toLowerCase();
    if (t.includes('phishing')) els.topic.classList.add('topic-phishing');
    else if (t.includes('password')) els.topic.classList.add('topic-passwords');
    else if (t.includes('social')) els.topic.classList.add('topic-social');
    else if (t.includes('reporting')) els.topic.classList.add('topic-reporting');
    els.myth.textContent = item.myth;
    els.myth.classList.remove('busted');
    els.fact.textContent = item.fact;
    els.detail.textContent = item.detail || '';
    els.detail.classList.toggle('le-hidden', !item.detail);
    els.factWrap.classList.remove('show');
    revealed = false;

    const isLast = index === items.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-flag-checkered"></i> Finish'
      : '<i class="fa-solid fa-forward"></i> Next Myth';

    renderDots();
  }

  function reveal() {
    if (done || revealed) return;
    revealed = true;
    els.myth.classList.add('busted');
    els.factWrap.classList.add('show');
  }

  function goTo(newIndex) {
    if (newIndex < 0 || newIndex >= items.length) return;
    index = newIndex;
    renderItem();
  }

  function showFinal() {
    done = true;
    els.itemView.classList.add('le-hidden');
    els.finalView.classList.remove('le-hidden');
    els.rememberText.textContent = rememberThisText;
    els.counter.textContent = 'Complete';
    els.topic.textContent = '';
  }

  function next() {
    if (done) return;
    if (index < items.length - 1) { goTo(index + 1); return; }
    showFinal();
  }

  function prev() {
    if (done) {
      done = false;
      els.finalView.classList.add('le-hidden');
      els.itemView.classList.remove('le-hidden');
      goTo(items.length - 1);
      return;
    }
    if (index > 0) goTo(index - 1);
  }

  // Brief framing screen before the first myth loads - see console.css's
  // "UNDERSTANDING LAYER" section. One screen, no timer, dismissed by Start.
  function beginActivity() {
    if (!contentData) return;
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    renderItem();
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
    // SPACE does double duty: bust the myth first, then advance on the next
    // press - reads naturally without needing two separate key presses.
    advance: () => {
      if (!introDismissed) { dismissIntro(); return; }
      if (done) return;
      if (!revealed) { reveal(); return; }
      next();
    },
    next: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    prev: () => { if (introDismissed) prev(); },
    reveal: () => { if (introDismissed) reveal(); }
  });

  fetch('../content/myth-vs-fact.json')
    .then((r) => r.json())
    .then((data) => {
      items = data.items;
      rememberThisText = data.rememberThis || '';
      if (els.introText) els.introText.textContent = data.whyThisMatters || '';
      contentData = data;
      if (introDismissed) beginActivity();
    })
    .catch((err) => {
      els.myth.textContent = "Could not load this activity. Check your connection and refresh.";
      console.error(err);
    });
})();
