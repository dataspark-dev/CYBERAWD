/* ============================================================
   SYNERGY CYBER SECURITY AWARENESS MONTH — DECK VIEWER
   Rebuilt with modern JS, better scroll‑snap accuracy, and 
   robust error handling.
   ============================================================ */

const SLIDES = [
  { file: 'slide-01.html', title: 'Opening', group: 'Welcome' },
  { file: 'slide-02.html', title: 'Why Cybersecurity Matters', group: 'Welcome' },
  { file: 'slide-03.html', title: 'Deepfakes — The Concept', group: 'Deepfake Attacks' },
  { file: 'slide-04.html', title: 'Deepfakes — Real vs Fake Simulation', group: 'Deepfake Attacks' },
  { file: 'slide-05.html', title: 'Deepfakes Beyond the Boardroom', group: 'Deepfake Attacks' },
  { file: 'slide-06.html', title: 'Phishing Evolution', group: 'Phishing Evolution' },
  { file: 'slide-07.html', title: 'Beyond Email — Smishing & Vishing', group: 'Phishing Evolution' },
  { file: 'slide-08.html', title: 'Spot the Phish', group: 'Phishing Evolution' },
  { file: 'slide-09.html', title: 'AI & Chatbot Risks', group: 'AI & Chatbot Risks' },
  { file: 'slide-10.html', title: 'Shadow AI — Unapproved Tools', group: 'AI & Chatbot Risks' },
  { file: 'slide-11.html', title: 'When Attackers Use AI Too', group: 'AI & Chatbot Risks' },
  { file: 'slide-12.html', title: 'Modern Threat Landscape', group: 'Threat Landscape' },
  { file: 'slide-13.html', title: 'Supply Chain & Third-Party Risk', group: 'Threat Landscape' },
  { file: 'slide-14.html', title: 'Workplace Security Behavior', group: 'Workplace Security' },
  { file: 'slide-15.html', title: 'Passwords, MFA & Access Hygiene', group: 'Workplace Security' },
  { file: 'slide-16.html', title: 'See Something, Say Something', group: "Do's & Don'ts" },
  { file: 'slide-17.html', title: "Do's & Don'ts", group: "Do's & Don'ts" },
  { file: 'slide-18.html', title: 'Closing', group: 'Closing' }
];

let currentIndex = 0;
let currentScale = 1;
let scrollSyncTimeout = null;
const isScrollEndSupported = 'onscrollend' in window;

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildDeck() {
  const container = document.getElementById('deckContainer');
  let html = '';
  SLIDES.forEach((s, i) => {
    html += `<section class="slide-page" data-index="${i}">
              <div class="slide-frame-wrap">
                <iframe class="slide-iframe" data-src="slides/${s.file}" data-index="${i}" title="${escapeAttr(s.title)}"></iframe>
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