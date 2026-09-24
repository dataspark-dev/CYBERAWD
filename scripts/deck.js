/* ============================================================
   SYNERGY CYBER SECURITY AWARENESS MONTH — DECK VIEWER
   Rebuilt with modern JS, better scroll‑snap accuracy, and 
   robust error handling.
   ============================================================ */

const SLIDES = [
  { file: 'slide-01.html', title: 'Opening', group: 'Welcome' },
  { file: 'slide-02.html', title: 'Why Cybersecurity Matters Now', group: 'Welcome' },
  { file: 'slide-03.html', title: 'Modern Threat Landscape', group: 'Threat Landscape' },
  { file: 'slide-04.html', title: 'Deepfake Attacks: The Concept', group: 'Deepfake Attacks' },
  { file: 'slide-05.html', title: 'Deepfakes: Spot the Signs', group: 'Deepfake Attacks' },
  { file: 'slide-06.html', title: "Deepfakes: Who's Targeted", group: 'Deepfake Attacks' },
  { file: 'slide-07.html', title: 'Phishing Has Evolved', group: 'Phishing Evolution' },
  { file: 'slide-08.html', title: 'Phishing Goes Multi-Channel', group: 'Phishing Evolution' },
  { file: 'slide-09.html', title: 'Pasting Data Into Public AI', group: 'AI & Chatbot Risks' },
  { file: 'slide-10.html', title: 'Shadow AI — The Unapproved Tools', group: 'AI & Chatbot Risks' },
  { file: 'slide-11.html', title: 'When Attackers Use AI Too', group: 'AI & Chatbot Risks' },
  { file: 'slide-12.html', title: 'Your Desk Is Part of the Perimeter', group: 'Workplace & Login Security' },
  { file: 'slide-13.html', title: 'Your Login Is Part of the Perimeter', group: 'Workplace & Login Security' },
  { file: 'slide-14.html', title: 'See Something, Say Something', group: "Do's & Don'ts" },
  { file: 'slide-15.html', title: 'GDPR — EU Data Protection', group: 'Legal & Compliance' },
  { file: 'slide-16.html', title: "DPDPA — India's Data Law", group: 'Legal & Compliance' },
  { file: 'slide-17.html', title: "Do's & Don'ts", group: "Do's & Don'ts" },
  { file: 'slide-18.html', title: 'True or False', group: "Do's & Don'ts" },
  { file: 'slide-19.html', title: 'Closing', group: 'Closing' }
];

// Audience-specific Closing slide - mirrors the canonical audience ids used by the admin
// dashboard's audience picker (admin/dashboard.html) and app.py's AUDIENCE_DEFS. Picking an
// audience there and opening this deck with the matching ?audience= query param (e.g.
// index.html?audience=hr) swaps ONLY the final Closing slide's file below, before the deck is
// built - every other slide, and the deck for anyone opening it with no ?audience= param (or an
// unrecognised one), is completely unaffected and still shows the shared general slide-19.html.
const AUDIENCE_CLOSING_SLIDES = {
  'accounts': 'slide-19-accounts.html',
  'hr': 'slide-19-hr.html',
  'fleet-management': 'slide-19-fleet-management.html',
  'it-support': 'slide-19-it-support.html',
  'development': 'slide-19-development.html',
  'vessel-operations': 'slide-19-vessel-operations.html',
};

// Resolved once and reused by every audience-aware piece of this file (slide swap, slide
// insertion, and the iframe query string below) so they all agree on the same value instead of
// each re-parsing location.search separately.
let CURRENT_AUDIENCE = '';
function resolveCurrentAudience() {
  try {
    return new URLSearchParams(location.search).get('audience') || '';
  } catch (_) {
    return '';
  }
}

function applyAudienceClosingSlide() {
  const file = AUDIENCE_CLOSING_SLIDES[CURRENT_AUDIENCE];
  if (!file) return; // no audience, or not one of the 6 canonical ids - keep general slide-19.html
  const closingSlide = SLIDES.find(s => s.group === 'Closing');
  if (closingSlide) closingSlide.file = file;
}

// Audience-specific topic slides (secure development practice / key & credential management),
// inserted into the deck rather than swapped in place - unlike the Closing slide, these don't
// replace anything that already exists for other audiences, they add extra ground only IT
// Support/Development need. Inserted right after 'slide-13.html' (the last Workplace & Login
// Security slide) and before 'slide-14.html' (See Something, Say Something): general login/
// workplace hygiene naturally leads into each technical audience's own deeper practice before
// the shared reporting-culture message resumes. For every other audience (or no ?audience=),
// SLIDES is left at its original 19 entries - no regression. slide-13.html's own "Next" bridge
// text is audience-aware too (see its own inline script) via the ?audience= query string
// buildDeck() below appends to every iframe's src - so its bridge accurately names whichever
// slide is actually next for the viewer, instead of always saying "See Something, Say Something".
const AUDIENCE_TOPIC_SLIDES = {
  'it-support': [
    { file: 'slide-it-fundamentals.html', title: 'Privileged Credentials — Foundations', group: 'Secure IT Practice' },
    { file: 'slide-it-vault.html', title: 'Vaults, Not Inboxes', group: 'Secure IT Practice' },
    { file: 'slide-it-rotation.html', title: 'Rotate, Review, Remove', group: 'Secure IT Practice' },
  ],
  'development': [
    { file: 'slide-dev-fundamentals.html', title: 'Secure Coding — Foundations', group: 'Secure Development Practice' },
    { file: 'slide-dev-pipeline.html', title: 'Pipeline Integrity', group: 'Secure Development Practice' },
    { file: 'slide-dev-trust.html', title: 'Verified Trust', group: 'Secure Development Practice' },
  ],
};

function applyAudienceTopicSlides() {
  const topics = AUDIENCE_TOPIC_SLIDES[CURRENT_AUDIENCE];
  if (!topics || !topics.length) return; // no audience, or one with no topic slides defined - deck stays at its original sequence
  const afterIndex = SLIDES.findIndex(s => s.file === 'slide-13.html');
  if (afterIndex === -1) return;
  SLIDES.splice(afterIndex + 1, 0, ...topics);
}

let currentIndex = 0;
let currentScale = 1;
let scrollSyncTimeout = null;
const isScrollEndSupported = 'onscrollend' in window;

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildDeck() {
  const container = document.getElementById('deckContainer');
  // Forwarded into every iframe's own src so an individual slide (e.g. slide-13.html's own
  // inline script) can read location.search inside its own frame and be audience-aware too,
  // the same way the parent page already is - iframes don't inherit the parent's query string
  // on their own, it has to be appended here. Harmless for slides that don't look at it.
  const audienceQuery = CURRENT_AUDIENCE ? ('?audience=' + encodeURIComponent(CURRENT_AUDIENCE)) : '';
  let html = '';
  SLIDES.forEach((s, i) => {
    html += `<section class="slide-page" data-index="${i}">
              <div class="slide-frame-wrap">
                <iframe class="slide-iframe" data-src="slides/${s.file}${audienceQuery}" data-index="${i}" title="${escapeAttr(s.title)}"></iframe>
              </div>
            </section>`;
  });
  container.innerHTML = html;
}

function loadSlide(index) {
  const frames = document.querySelectorAll('.slide-iframe');
  if (index < 0 || index >= frames.length) return;
  const frame = frames[index];
  if (!frame || frame.dataset.loaded === '1') return;
  frame.onload = () => checkLoadSucceeded(frame, index);
  frame.src = frame.dataset.src;
  frame.dataset.loaded = '1';
}

function checkLoadSucceeded(frame, index) {
  let ok = false;
  try {
    ok = !!(frame.contentDocument && frame.contentDocument.querySelector('.slide'));
  } catch (_) { /* ignore */ }
  if (ok) {
    clearLoadError(frame);
  } else {
    showLoadError(frame, index);
  }
}

function clearLoadError(frame) {
  const existing = frame.parentElement.querySelector('.slide-load-error');
  if (existing) existing.remove();
}

function showLoadError(frame, index) {
  frame.dataset.loaded = ''; // allow retry
  clearLoadError(frame);
  const msg = document.createElement('div');
  msg.className = 'slide-load-error';
  msg.textContent = "Couldn't load this slide — tap to retry";
  msg.onclick = () => loadSlide(index);
  frame.parentElement.appendChild(msg);
}

function loadAround(index, bufferSize = 1) {
  const from = Math.max(0, index - bufferSize);
  const to = Math.min(SLIDES.length - 1, index + bufferSize);
  for (let i = from; i <= to; i++) {
    loadSlide(i);
  }
}

function scaleFrames() {
  currentScale = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
  document.querySelectorAll('.slide-frame-wrap').forEach(el => {
    el.style.transform = `scale(${currentScale})`;
  });
}

function updateUIForIndex(index) {
  const changed = index !== currentIndex;
  currentIndex = index;
  loadAround(index);
  document.getElementById('deckProgressFill').style.width = `${((index + 1) / SLIDES.length) * 100}%`;
  history.replaceState(null, '', `#${index + 1}`);
  if (changed) {
    const frame = document.querySelectorAll('.slide-iframe')[index];
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'slide-activate' }, '*');
    }
  }
}

function scrollToSlide(index, behavior = 'smooth') {
  const target = Math.max(0, Math.min(SLIDES.length - 1, index));
  loadAround(target);
  const container = document.getElementById('deckContainer');
  container.scrollTo({
    top: target * window.innerHeight,
    behavior: behavior
  });
  updateUIForIndex(target);
}

function deckNext() { scrollToSlide(currentIndex + 1); }
function deckPrev() { scrollToSlide(currentIndex - 1); }
function deckGo(index) { scrollToSlide(index); }

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function syncFromScrollPosition() {
  const container = document.getElementById('deckContainer');
  let idx = Math.round(container.scrollTop / window.innerHeight);
  idx = Math.max(0, Math.min(SLIDES.length - 1, idx));
  if (idx !== currentIndex) {
    updateUIForIndex(idx);
  }
}

function handleContainerScroll() {
  if (isScrollEndSupported) return;
  clearTimeout(scrollSyncTimeout);
  scrollSyncTimeout = setTimeout(syncFromScrollPosition, 150);
}

// ---- Keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  const key = e.key;
  if (['Enter', ' ', 'ArrowDown', 'ArrowRight', 'PageDown'].includes(key)) {
    e.preventDefault();
    deckNext();
  } else if (['Backspace', 'ArrowUp', 'ArrowLeft', 'PageUp'].includes(key)) {
    e.preventDefault();
    deckPrev();
  } else if (key === 'Home') {
    e.preventDefault();
    scrollToSlide(0);
  } else if (key === 'End') {
    e.preventDefault();
    scrollToSlide(SLIDES.length - 1);
  } else if (key === 'f' || key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  } else if (key === 'Escape') {
    // Escape must always mean "close/cancel" — it used to request fullscreen
    // here, which fought with a slide's own popup wanting to close on Escape
    // whenever keyboard focus happened to be on the outer deck page rather
    // than inside that slide's iframe. Broadcast a close instead, to every
    // iframe, so a popup closes even if it was left open on a slide you've
    // since scrolled away from.
    document.querySelectorAll('.slide-iframe').forEach(frame => {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'close-modal' }, '*');
    });
  }
});

window.addEventListener('resize', () => {
  scaleFrames();
  scrollToSlide(currentIndex, 'instant');
});

window.addEventListener('DOMContentLoaded', () => {
  CURRENT_AUDIENCE = resolveCurrentAudience();
  // Both apply* calls run before SLIDES.length is read for the hash calculation below -
  // applyAudienceTopicSlides() can change the array's length (it inserts, not just swaps),
  // so the hash-based deep link needs to be computed against the final array, not the base 19.
  applyAudienceTopicSlides();
  applyAudienceClosingSlide();
  const hash = parseInt(location.hash.replace('#', ''), 10);
  const start = (hash >= 1 && hash <= SLIDES.length) ? hash - 1 : 0;
  buildDeck();
  loadAround(start);
  scaleFrames();
  const container = document.getElementById('deckContainer');
  if (isScrollEndSupported) {
    container.addEventListener('scrollend', syncFromScrollPosition);
  } else {
    container.addEventListener('scroll', handleContainerScroll);
  }
  scrollToSlide(start, 'instant');
});