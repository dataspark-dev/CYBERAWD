/* Working at Height — image queue with facilitator-controlled reveal.
   Self-contained: no shared scoring, restarts at beginning when finished. */
(function () {
  let items = [];
  let index = 0;
  let revealed = false;

  const els = {
    counter: document.getElementById('itemCounter'),
    title: document.getElementById('itemTitle'),
    frame: document.getElementById('imageFrame'),
    image: document.getElementById('itemImage'),
    placeholderFlag: document.getElementById('placeholderFlag'),
    overlay: document.getElementById('revealOverlay'),
    whatWrong: document.getElementById('whatIsWrongText'),
    whySuspicious: document.getElementById('whyItsSuspiciousText'),
    dots: document.getElementById('progressDots'),
    revealBtn: document.getElementById('revealBtn'),
    nextBtn: document.getElementById('nextBtn')
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
    els.counter.textContent = `Item ${index + 1} of ${items.length}`;
    els.title.textContent = item.title;
    els.frame.classList.add('is-loading');
    els.image.onload = () => els.frame.classList.remove('is-loading');
    els.image.onerror = () => els.frame.classList.remove('is-loading');
    els.image.src = item.imagePath;
    els.image.alt = item.title;
    els.placeholderFlag.classList.toggle('le-hidden', !item.placeholder);
    els.whatWrong.textContent = item.whatIsWrong;
    els.whySuspicious.textContent = item.whyItsSuspicious;

    const isLast = index === items.length - 1;
    els.nextBtn.innerHTML = isLast
      ? '<i class="fa-solid fa-rotate"></i> Restart — Back to Start'
      : '<i class="fa-solid fa-forward"></i> Next Item';

    revealed = false;
    els.overlay.classList.remove('show');
    renderDots();
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    els.overlay.classList.add('show');
  }

  function goTo(newIndex) {
    if (newIndex < 0 || newIndex >= items.length) return;
    index = newIndex;
    renderItem();
  }

  function next() {
    if (index < items.length - 1) { goTo(index + 1); return; }
    index = 0;
    renderItem();
  }

  function prev() {
    if (index > 0) goTo(index - 1);
  }

  els.revealBtn.addEventListener('click', reveal);
  els.nextBtn.addEventListener('click', next);

  LiveEvent.onAction({
    advance: next,
    next,
    prev,
    reveal
  });

  fetch('../content/working-at-height.json')
    .then((r) => r.json())
    .then((data) => {
      items = data;
      renderItem();
    })
    .catch((err) => {
      els.title.textContent = 'Failed to load content/working-at-height.json';
      console.error(err);
    });
})();
