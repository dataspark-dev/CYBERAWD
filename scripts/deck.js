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

// Audience-specific Desk/Login Perimeter slides - same swap-in-place pattern as the Closing
// slide above (not insert, since these replace an existing slide 1-for-1 rather than adding
// ground), but matched by title instead of group since slide-12 and slide-13 share the same
// group ('Workplace & Login Security') and title is the only field that disambiguates them.
// IT Support and Development get their own reframed version of each - IT's toward privileged/
// admin account and server-room hygiene, Development's toward SSH keys, active terminal
// sessions, and git/cloud console logins - instead of the generic personal-account version.
// Every other audience (or no ?audience=) keeps the shared slide-12.html/slide-13.html
// unaffected. Applied after applyAudienceTopicSlides() below (see call order in
// DOMContentLoaded) - that function still needs to find the real 'slide-13.html' by filename to
// know where to insert, so the swap here must happen after that lookup, not before it.
const AUDIENCE_DESK_SLIDES = {
  'it-support': 'slide-it-desk-perimeter.html',
  'development': 'slide-dev-desk-perimeter.html',
};
const AUDIENCE_LOGIN_SLIDES = {
  'it-support': 'slide-it-login-perimeter.html',
  'development': 'slide-dev-login-perimeter.html',
};

function applyAudienceDeskSlide() {
  const file = AUDIENCE_DESK_SLIDES[CURRENT_AUDIENCE];
  if (!file) return;
  const deskSlide = SLIDES.find(s => s.title === 'Your Desk Is Part of the Perimeter');
  if (deskSlide) deskSlide.file = file;
}

function applyAudienceLoginSlide() {
  const file = AUDIENCE_LOGIN_SLIDES[CURRENT_AUDIENCE];
  if (!file) return;
  const loginSlide = SLIDES.find(s => s.title === 'Your Login Is Part of the Perimeter');
  if (loginSlide) loginSlide.file = file;
}

// Audience-specific "Pasting Data Into Public AI" / "Shadow AI" slides - same swap-in-place
// pattern as Desk/Login above, matched by title (slide-09 and slide-10 also share a group, 'AI &
// Chatbot Risks', with slide-11 which is NOT swapped here - only these two were asked for).
// IT Support gets ticket/incident-log/credential examples and IT-specific shadow tools
// (unapproved diagnostic scanners, ticketing-system AI plugins); Development gets stack-trace/
// .env/secret examples and dev-specific shadow tools (unapproved coding extensions, dependency
// scanners) - instead of the generic crew-record/browser-extension version. Neither slide-09 nor
// slide-10 is ever used as an insertion anchor by another function, so unlike Desk/Login there's
// no ordering constraint on when these two run relative to the other apply* calls.
const AUDIENCE_AI_PASTE_SLIDES = {
  'it-support': 'slide-it-ai-data-paste.html',
  'development': 'slide-dev-ai-data-paste.html',
};
const AUDIENCE_SHADOW_AI_SLIDES = {
  'it-support': 'slide-it-shadow-ai.html',
  'development': 'slide-dev-shadow-ai.html',
};

function applyAudienceAiPasteSlide() {
  const file = AUDIENCE_AI_PASTE_SLIDES[CURRENT_AUDIENCE];
  if (!file) return;
  const s = SLIDES.find(s => s.title === 'Pasting Data Into Public AI');
  if (s) s.file = file;
}

function applyAudienceShadowAiSlide() {
  const file = AUDIENCE_SHADOW_AI_SLIDES[CURRENT_AUDIENCE];
  if (!file) return;
  const s = SLIDES.find(s => s.title === 'Shadow AI — The Unapproved Tools');
  if (s) s.file = file;
}

// Audience-specific topic slides (secure development practice / IT security practice), inserted
// into the deck rather than swapped in place - unlike the Closing and Desk/Login slides above,
// these don't replace anything that already exists for other audiences, they add extra ground
// only IT Support/Development need. Inserted right after 'slide-13.html' (the last Workplace &
// Login Security slide, before it gets swapped to its own reframed version by
// applyAudienceLoginSlide() above) and before 'slide-14.html' (See Something, Say Something):
// general login/workplace hygiene naturally leads into each technical audience's own deeper
// practice before the shared reporting-culture message resumes. For every other audience (or no
// ?audience=), SLIDES is left at its original 19 entries - no regression. Each new Login
// Perimeter slide's own "Next" bridge text is hardcoded directly to whichever of these six is
// first, since that slide is now already audience-specific (no shared inline script needed the
// way slide-13.html used to carry one). Each sequence follows the same logical flow:
// foundational principles -> day-to-day hygiene controls -> the audience-specific deep-dive
// (secrets/CI-CD for Dev, endpoint/network for IT) -> AI-security material -> golden rules,
// immediately before slide-14/Closing.
const AUDIENCE_TOPIC_SLIDES = {
  'it-support': [
    { file: 'slide-it-hygiene.html', title: 'Enterprise Security Hygiene', group: 'Secure IT Practice' },
    { file: 'slide-it-data-classification.html', title: 'Data Classification & Handling', group: 'Secure IT Practice' },
    { file: 'slide-it-endpoint.html', title: 'Endpoint Protection Standards', group: 'Secure IT Practice' },
    { file: 'slide-it-network.html', title: 'Zero Trust Network Boundaries', group: 'Secure IT Practice' },
    { file: 'slide-it-ai-leakage.html', title: 'AI Data Leakage & Observability', group: 'Secure IT Practice' },
    { file: 'slide-it-golden-rules.html', title: 'Golden Rules for IT Support', group: 'Secure IT Practice' },
  ],
  'development': [
    { file: 'slide-dev-appsec.html', title: 'AppSec Essentials', group: 'Secure Development Practice' },
    { file: 'slide-dev-secrets.html', title: 'Secrets Architecture Standards', group: 'Secure Development Practice' },
    { file: 'slide-dev-git-lifecycle.html', title: 'Git Lifecycle Defense', group: 'Secure Development Practice' },
    { file: 'slide-dev-ai-audit.html', title: 'AI-Generated Code Audit Protocol', group: 'Secure Development Practice' },
    { file: 'slide-dev-prompt-injection.html', title: 'Prompt Injection & AI Tool Risk', group: 'Secure Development Practice' },
    { file: 'slide-dev-golden-rules.html', title: 'Golden Rules for Developers', group: 'Secure Development Practice' },
  ],
};

function applyAudienceTopicSlides() {
  const topics = AUDIENCE_TOPIC_SLIDES[CURRENT_AUDIENCE];
  if (!topics || !topics.length) return; // no audience, or one with no topic slides defined - deck stays at its original sequence
  const afterIndex = SLIDES.findIndex(s => s.file === 'slide-13.html');
  if (afterIndex === -1) return;
  SLIDES.splice(afterIndex + 1, 0, ...topics);
}

// Audience-specific slide skipping - the companion to AUDIENCE_TOPIC_SLIDES above, but removing
// base slides entirely instead of inserting extra ones. IT Support and Development skip the
// generic Legal & Compliance / Do's & Don'ts / True-or-False slides (slide-15 through slide-18):
// those are basic, non-technical judgment checks already covered more rigorously by this
// audience's own live-event activity modules (Fault Finding, Decision Room, etc). slide-14 (See
// Something, Say Something) is kept for every audience - reporting culture applies universally
// regardless of technical depth. Same "audience id -> list of base slide filenames" pattern as
// every other audience map here; every other audience (or no ?audience=) is unaffected.
// slide-03 through slide-08 (Modern Threat Landscape, Deepfake Attacks x3, Phishing Evolution
// x2) are also skipped for these two audiences - not because the topics don't apply, but because
// the generic versions are replaced by the reframed, consolidated AUDIENCE_EARLY_TOPIC_SLIDES
// below (6 generic slides -> 3 reframed slides per audience) rather than shown twice.
const AUDIENCE_SKIP_SLIDES = {
  'it-support': ['slide-03.html', 'slide-04.html', 'slide-05.html', 'slide-06.html', 'slide-07.html', 'slide-08.html', 'slide-15.html', 'slide-16.html', 'slide-17.html', 'slide-18.html'],
  'development': ['slide-03.html', 'slide-04.html', 'slide-05.html', 'slide-06.html', 'slide-07.html', 'slide-08.html', 'slide-15.html', 'slide-16.html', 'slide-17.html', 'slide-18.html'],
};

function applyAudienceSkipSlides() {
  const skip = AUDIENCE_SKIP_SLIDES[CURRENT_AUDIENCE];
  if (!skip || !skip.length) return; // no audience, or one with nothing to skip - deck stays at its original sequence
  const skipSet = new Set(skip);
  for (let i = SLIDES.length - 1; i >= 0; i--) {
    if (skipSet.has(SLIDES[i].file)) SLIDES.splice(i, 1);
  }
}

// Companion to AUDIENCE_TOPIC_SLIDES, but anchored after 'slide-02.html' instead of
// 'slide-13.html' - same insert-not-swap pattern, just a second insertion point earlier in the
// deck. Replaces the 6 generic slides skipped above (slide-03..08) with 3 reframed, consolidated
// slides per audience: Modern Threat Landscape (reworded toward each audience's own attack
// surface), a single Deepfake slide (consolidating the general deck's 3 into 1, retargeted at
// vendor/executive-impersonation calls this audience actually receives), and a single Phishing
// slide (consolidating the general deck's 2 into 1, retargeted at this audience's own toolchain/
// ticketing channels). Applied before applyAudienceSkipSlides() and applyAudienceTopicSlides()
// in the init sequence below, though order relative to those two doesn't actually matter here -
// this anchors on slide-02, which neither of the other two functions ever touches or removes.
const AUDIENCE_EARLY_TOPIC_SLIDES = {
  'it-support': [
    { file: 'slide-it-threat-landscape.html', title: 'Modern Threat Landscape', group: 'Threat Landscape' },
    { file: 'slide-it-deepfake.html', title: 'Deepfake Attacks', group: 'Deepfake Attacks' },
    { file: 'slide-it-phishing.html', title: 'Phishing Evolution', group: 'Phishing Evolution' },
  ],
  'development': [
    { file: 'slide-dev-threat-landscape.html', title: 'Modern Threat Landscape', group: 'Threat Landscape' },
    { file: 'slide-dev-deepfake.html', title: 'Deepfake Attacks', group: 'Deepfake Attacks' },
    { file: 'slide-dev-phishing.html', title: 'Phishing Evolution', group: 'Phishing Evolution' },
  ],
};

function applyAudienceEarlyTopicSlides() {
  const topics = AUDIENCE_EARLY_TOPIC_SLIDES[CURRENT_AUDIENCE];
  if (!topics || !topics.length) return; // no audience, or one with no early topic slides defined - deck stays at its original sequence
  const afterIndex = SLIDES.findIndex(s => s.file === 'slide-02.html');
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
  // All six apply* calls run before SLIDES.length is read for the hash calculation below - most
  // of them change the array's length (removing/inserting, not just swapping), so the
  // hash-based deep link needs to be computed against the final array, not the base 19. Skip
  // runs first so it only ever removes base slides (slide-02/slide-13 themselves are never
  // skipped, so neither insertion anchor below is affected regardless of order), then both
  // topic-insertion points are applied while 'slide-13.html' still has that literal filename
  // (applyAudienceTopicSlides() finds its insertion point by that filename, so the Desk/Login
  // swap below - which changes slide-13's file, not its position - must come after, not before),
  // then the Desk/Login slides are swapped, then the Closing slide is swapped.
  applyAudienceSkipSlides();
  applyAudienceEarlyTopicSlides();
  applyAudienceTopicSlides();
  applyAudienceDeskSlide();
  applyAudienceLoginSlide();
  applyAudienceAiPasteSlide();
  applyAudienceShadowAiSlide();
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