/* Fault Finding — image queue with facilitator-controlled reveal.
   Supports two item types:
   - "single" (default): one scenario image, reveal shows what's wrong.
   - "compare": two images side by side (one real, one fake) — the room
     calls out which one is fake, then Reveal shows the answer with a
     green/red highlight on each panel plus the explanation.
   Self-contained: no shared scoring, restarts at beginning when finished. */
(function () {
  let items = [];
  let index = 0;
  let revealed = false;
  let rememberThisText = '';
  let contentData = null;
  let introDismissed = false;

  const els = {
    counter: document.getElementById('itemCounter'),
    title: document.getElementById('itemTitle'),
    category: document.getElementById('itemCategory'),
    frame: document.getElementById('imageFrame'),
    image: document.getElementById('itemImage'),
    placeholderFlag: document.getElementById('placeholderFlag'),
    overlay: document.getElementById('revealOverlay'),
    whatWrong: document.getElementById('whatIsWrongText'),
    whySuspicious: document.getElementById('whyItsSuspiciousText'),
    rememberCardSingle: document.getElementById('rememberCardSingle'),
    rememberTextSingle: document.getElementById('rememberTextSingle'),
    compareFrame: document.getElementById('compareFrame'),
    comparePanelA: document.getElementById('comparePanelA'),
    comparePanelB: document.getElementById('comparePanelB'),
    compareImageA: document.getElementById('compareImageA'),
    compareImageB: document.getElementById('compareImageB'),
    compareReveal: document.getElementById('compareRevealPanel'),
    compareWhatWrong: document.getElementById('compareWhatIsWrongText'),
    compareWhySuspicious: document.getElementById('compareWhyItsSuspiciousText'),
    rememberCardCompare: document.getElementById('rememberCardCompare'),
    rememberTextCompare: document.getElementById('rememberTextCompare'),
    dots: document.getElementById('progressDots'),
    revealBtn: document.getElementById('revealBtn'),
    nextBtn: document.getElementById('nextBtn'),
    upNextRow: document.getElementById('upNextRow'),
    introScreen: document.getElementById('introScreen'),
    activityBody: document.getElementById('activityBody'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn')
  };

  let fakeSide = 'A'; // which panel is the fake one for the current compare item

  function renderDots() {
    els.dots.innerHTML = items.map((_, i) => {
      const cls = i === index ? 'dot current' : (i < index ? 'dot done' : 'dot');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  function renderSingleItem(item) {
    els.frame.classList.remove('le-hidden');
    els.compareFrame.classList.add('le-hidden');

    els.frame.classList.add('is-loading');
    els.image.onload = () => els.frame.classList.remove('is-loading');
    els.image.onerror = () => els.frame.classList.remove('is-loading');
    els.image.src = item.imagePath;
    els.image.alt = item.title;
    els.placeholderFlag.classList.toggle('le-hidden', !item.placeholder);
    els.whatWrong.textContent = item.whatIsWrong;
    els.whySuspicious.textContent = item.whyItsSuspicious;
    els.overlay.classList.remove('show');
  }

  function renderCompareItem(item) {
    els.frame.classList.add('le-hidden');
    els.compareFrame.classList.remove('le-hidden');

    // Randomize which side shows the fake one so it's not predictable.
    fakeSide = Math.random() < 0.5 ? 'A' : 'B';
    const realImg = fakeSide === 'A' ? els.compareImageB : els.compareImageA;
    const fakeImg = fakeSide === 'A' ? els.compareImageA : els.compareImageB;
    realImg.src = item.realImage;
    fakeImg.src = item.fakeImage;
    els.compareImageA.alt = 'Option A';
    els.compareImageB.alt = 'Option B';

    [els.comparePanelA, els.comparePanelB].forEach((p) => p.classList.remove('reveal-fake', 'reveal-real'));
    els.compareWhatWrong.textContent = item.whatIsWrong;
    els.compareWhySuspicious.textContent = item.whyItsSuspicious;
    els.compareReveal.classList.remove('show');
  }

  function renderItem() {
    const item = items[index];
    if (!item) return;
    els.counter.textContent = `Item ${index + 1} of ${items.length}`;
    els.title.textContent = item.title;
    if (els.category) {
      const label = item.persona && item.category
        ? `${item.persona} \u00b7 ${item.category}`
        : (item.category || item.persona || '');
      if (label) {
        els.category.textContent = label;
        els.category.classList.remove('le-hidden');
      } else {
        els.category.textContent = '';
        els.category.classList.add('le-hidden');
      }
    }

    if (item.type === 'compare') {
      renderCompareItem(item);
    } else {
      renderSingleItem(item);
    }

    const isLast = index === items.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start'
      : '<i class="fa-solid fa-forward"></i> Next Item';

    revealed = false;
    if (els.rememberCardSingle) els.rememberCardSingle.classList.add('le-hidden');
    if (els.rememberCardCompare) els.rememberCardCompare.classList.add('le-hidden');
    if (els.upNextRow) els.upNextRow.classList.add('le-hidden');
    renderDots();
  }

  function reveal() {
    if (revealed) return;
    revealed = true;

    const item = items[index];
    const isLast = index === items.length - 1;
    if (item && item.type === 'compare') {
      const fakePanel = fakeSide === 'A' ? els.comparePanelA : els.comparePanelB;
      const realPanel = fakeSide === 'A' ? els.comparePanelB : els.comparePanelA;
      fakePanel.classList.add('reveal-fake');
      realPanel.classList.add('reveal-real');
      els.compareReveal.classList.add('show');
      if (isLast && els.rememberCardCompare) {
        els.rememberTextCompare.textContent = rememberThisText;
        els.rememberCardCompare.classList.remove('le-hidden');
        if (els.upNextRow) els.upNextRow.classList.remove('le-hidden');
      }
    } else {
      els.overlay.classList.add('show');
      if (isLast && els.rememberCardSingle) {
        els.rememberTextSingle.textContent = rememberThisText;
        els.rememberCardSingle.classList.remove('le-hidden');
        if (els.upNextRow) els.upNextRow.classList.remove('le-hidden');
      }
    }
  }

  function goTo(newIndex) {
    if (newIndex < 0 || newIndex >= items.length) return;
    index = newIndex;
    renderItem();
  }

  function next() {
    if (index < items.length - 1) { goTo(index + 1); return; }
    // At the end, simply restart from the beginning — no redirect.
    index = 0;
    renderItem();
  }

  function prev() {
    if (index > 0) goTo(index - 1);
  }

  // Brief framing screen before the queue starts — see console.css's
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
    advance: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    next: () => { if (!introDismissed) { dismissIntro(); return; } next(); },
    prev: () => { if (introDismissed) prev(); },
    reveal: () => { if (introDismissed) reveal(); }
  });

  fetch('../content/fault-finding.json')
    .then((r) => r.json())
    .then((data) => {
      items = data.items;
      rememberThisText = data.rememberThis || '';
      if (els.introText) els.introText.textContent = data.whyThisMatters || '';
      contentData = data;
      if (introDismissed) beginActivity();
    })
    .catch((err) => {
      els.title.textContent = 'Failed to load content/fault-finding.json';
      console.error(err);
    });
})();
