
const ROOM_CODE = "2W8OLU";
const STORAGE_PID = 'participantId_' + ROOM_CODE;
const STORAGE_NAME = 'participantName_' + ROOM_CODE;
let participantId = localStorage.getItem(STORAGE_PID);
let participantName = localStorage.getItem(STORAGE_NAME);
let pollTimer = null;
let retryCount = 0;
let notFoundCount = 0;
// Guards against a slow poll tick's response landing AFTER a later tick's and rendering stale
// state over it (setInterval fires every 1.5s regardless of whether the previous request has
// resolved) - fetchState captures the sequence number current at its start and re-checks it
// right after the fetch resolves; a mismatch means a newer poll has already started, so this
// (now-stale) response is discarded instead of rendered.
let fetchSeq = 0;
const NOT_FOUND_RETRY_LIMIT = 3; // ~3 poll cycles at 1.5s = ~4.5s before giving up on a 404
let lastActiveModule = null;
let lastActiveItemId = null;
let hasAnsweredCurrentItem = false;
// Self-paced activity: local-only navigation state. actItems is fetched once per module (not
// re-fetched/re-rendered on every 1.5s poll - see fetchState) so a participant's own Prev/Next
// position and in-progress interaction are never disrupted by the ambient poll loop.
let actModuleLoaded = null;
let actItems = [];
let actIndex = 0;
// Submission state - per-participant per-module deliberate lock
let mySubmission = null; // {isSubmitted, submittedAt, module} for current activeModule from /state
let actIsSubmitted = false; // mirrors mySubmission for activityScreen (MC + pass-phrase)
let cwIsSubmitted = false;  // mirrors for crossword
let introDismissedFor = null; // module id for which participant intro was dismissed
let lastRememberThis = null;
let isReviewingAfterSubmit = false; // participant tapped Review on submittedScreen
let cwInitialized = false;
let cwWords = [];
let cwCells = new Map();
let cwRows = 0, cwCols = 0;
let cwCurrentRow = -1, cwCurrentCol = -1, cwCurrentDir = 'across';
let cwPendingDir = null;
let cwRevealed = false;
let cwLastActiveWordIdx = null; // last word index the clue list was scrolled to - see cwHighlight
let cwRememberText = '';
let cwProgressTimer = null;
let cwLastSent = null;
const CW_DEBOUNCE = 3500;
let ccIsSubmitted = false;  // mirrors mySubmission for control-catch

const els = {
  joinScreen: document.getElementById('joinScreen'),
  nameInput: document.getElementById('nameInput'),
  joinBtn: document.getElementById('joinBtn'),
  joinOk: document.getElementById('joinOk'),
  joinErr: document.getElementById('joinErr'),
  waitingScreen: document.getElementById('waitingScreen'),
  waitingCount: document.getElementById('waitingCount'),
  waitingModule: document.getElementById('waitingModule'),
  waitingNames: document.getElementById('waitingNames'),
  activityScreen: document.getElementById('activityScreen'),
  actModuleBadge: document.getElementById('actModuleBadge'),
  actCount: document.getElementById('actCount'),
  actProgress: document.getElementById('actProgress'),
  actMount: document.getElementById('actMount'),
  actPrevBtn: document.getElementById('actPrevBtn'),
  actNextBtn: document.getElementById('actNextBtn'),
  actDots: document.getElementById('actDots'),
  actSubmitWrap: document.getElementById('actSubmitWrap'),
  actSubmitBtn: document.getElementById('actSubmitBtn'),
  actSubmitMsg: document.getElementById('actSubmitMsg'),
  introScreen: document.getElementById('introScreen'),
  introText: document.getElementById('introText'),
  introPolicy: document.getElementById('introPolicy'),
  introStartBtn: document.getElementById('introStartBtn'),
  submittedScreen: document.getElementById('submittedScreen'),
  submittedModule: document.getElementById('submittedModule'),
  submittedModule2: document.getElementById('submittedModule2'),
  submittedCount: document.getElementById('submittedCount'),
  submittedAtLine: document.getElementById('submittedAtLine'),
  submittedRememberWrap: document.getElementById('submittedRememberWrap'),
  submittedRememberText: document.getElementById('submittedRememberText'),
  reviewAnswersBtn: document.getElementById('reviewAnswersBtn'),
  backToSubmittedBtn: document.getElementById('backToSubmittedBtn'),
  reviewBackWrap: document.getElementById('reviewBackWrap'),
  backToSubmittedFromActivityBtn: document.getElementById('backToSubmittedFromActivityBtn'),
  cwReviewBackWrap: document.getElementById('cwReviewBackWrap'),
  backToSubmittedFromCwBtn: document.getElementById('backToSubmittedFromCwBtn'),
  crosswordScreen: document.getElementById('crosswordScreen'),
  cwClueCountBadge: document.getElementById('cwClueCountBadge'),
  cwCount: document.getElementById('cwCount'),
  cwGrid: document.getElementById('cwGrid'),
  cwAcross: document.getElementById('cwAcross'),
  cwDown: document.getElementById('cwDown'),
  cwStatus: document.getElementById('cwStatus'),
  cwSolvedBanner: document.getElementById('cwSolvedBanner'),
  cwRememberCard: document.getElementById('cwRememberCard'),
  cwRememberCardText: document.getElementById('cwRememberCardText'),
  cwCheck: document.getElementById('cwCheck'),
  cwReveal: document.getElementById('cwReveal'),
  cwSubmitWrap: document.getElementById('cwSubmitWrap'),
  cwSubmitBtn: document.getElementById('cwSubmitBtn'),
  cwSubmitMsg: document.getElementById('cwSubmitMsg'),
  submittedScoreWrap: document.getElementById('submittedScoreWrap'),
  submittedScoreText: document.getElementById('submittedScoreText'),
  controlCatchScreen: document.getElementById('controlCatchScreen'),
  ccModuleBadge: document.getElementById('ccModuleBadge'),
  ccCount: document.getElementById('ccCount'),
  ccScoreVal: document.getElementById('ccScoreVal'),
  ccLivesVal: document.getElementById('ccLivesVal'),
  ccTimeVal: document.getElementById('ccTimeVal'),
  ccMuteBtn: document.getElementById('ccMuteBtn'),
  ccIntroHint: document.getElementById('ccIntroHint'),
  ccArena: document.getElementById('ccArena'),
  ccGameOverWrap: document.getElementById('ccGameOverWrap'),
  ccGameOverStats: document.getElementById('ccGameOverStats'),
  ccSubmitBtn: document.getElementById('ccSubmitBtn'),
  ccSubmitMsg: document.getElementById('ccSubmitMsg'),
  ccReviewBackWrap: document.getElementById('ccReviewBackWrap'),
  backToSubmittedFromCcBtn: document.getElementById('backToSubmittedFromCcBtn'),
  completeScreen: document.getElementById('completeScreen'),
  completeCount: document.getElementById('completeCount'),
  completeModule: document.getElementById('completeModule'),
  errorScreen: document.getElementById('errorScreen'),
  errorMsg: document.getElementById('errorMsg'),
  retryBtn: document.getElementById('retryBtn'),
  headerCount: document.getElementById('headerCount'),
  reconnectBanner: document.getElementById('reconnectBanner'),
};

function showScreen(name){
  els.joinScreen.classList.add('hidden');
  els.waitingScreen.classList.add('hidden');
  if(els.introScreen) els.introScreen.classList.add('hidden');
  els.activityScreen.classList.add('hidden');
  if(els.submittedScreen) els.submittedScreen.classList.add('hidden');
  els.crosswordScreen.classList.add('hidden');
  if(els.controlCatchScreen) els.controlCatchScreen.classList.add('hidden');
  if(els.completeScreen) els.completeScreen.classList.add('hidden');
  els.errorScreen.classList.add('hidden');
  if(name==='join') els.joinScreen.classList.remove('hidden');
  if(name==='waiting') els.waitingScreen.classList.remove('hidden');
  if(name==='intro' && els.introScreen) els.introScreen.classList.remove('hidden');
  if(name==='activity') els.activityScreen.classList.remove('hidden');
  if(name==='submitted' && els.submittedScreen) els.submittedScreen.classList.remove('hidden');
  if(name==='crossword') els.crosswordScreen.classList.remove('hidden');
  if(name==='control-catch' && els.controlCatchScreen) els.controlCatchScreen.classList.remove('hidden');
  if(name==='complete' && els.completeScreen) els.completeScreen.classList.remove('hidden');
  if(name==='error') els.errorScreen.classList.remove('hidden');
}
function showErr(msg){
  els.joinErr.textContent = msg;
  els.joinErr.classList.remove('hidden');
}
function hideErr(){
  els.joinErr.classList.add('hidden');
  els.joinErr.textContent = '';
}
function updateHeaderCount(n){
  els.headerCount.textContent = n + ' joined';
  els.waitingCount.textContent = n + ' joined';
  els.actCount.textContent = n + ' joined';
  els.cwCount.textContent = n + ' joined';
  if(els.ccCount) els.ccCount.textContent = n + ' joined';
  if(els.completeCount) els.completeCount.textContent = n + ' joined';
  if(els.submittedCount) els.submittedCount.textContent = n + ' joined';
}
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function doJoin(){
  const name = els.nameInput.value.trim();
  if(!name){ showErr('Please enter your name'); return; }
  if(name.length<1 || name.length>40){ showErr('Name must be 1-40 characters'); return; }
  els.joinBtn.disabled = true;
  hideErr();
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/join', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      if(j.error === 'room not found') throw new Error('This session has ended or the lab code is wrong. Please check with the host or ask for a new QR.');
      throw new Error('Could not join - please try again.');
    }
    participantId = j.participantId;
    participantName = name;
    localStorage.setItem(STORAGE_PID, participantId);
    localStorage.setItem(STORAGE_NAME, name);
    startPolling();
  }catch(e){
    showErr(e.message || 'Join failed - check connection');
  }finally{
    els.joinBtn.disabled = false;
  }
}

// --- Self-paced activity: full sequence pushed once, participant pages through it locally ---
const MC_MODULES = ['fault-finding','myth-vs-fact','decision-room','clue-quest','pass-phrase'];

async function submitAnswer(item, optionId){
  const r = await fetch('/api/session/' + ROOM_CODE + '/respond', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, itemId: item.id, optionId: optionId})});
  const j = await r.json().catch(()=>({}));
  if(!r.ok){
    if(j.error && j.error.includes('unknown participantId')){
      localStorage.removeItem(STORAGE_PID);
      localStorage.removeItem(STORAGE_NAME);
      participantId = null;
      showScreen('join');
      showErr('Session was reset - please join again with your name');
      stopPolling();
      return false;
    }
    throw new Error(j.error || 'Submit failed');
  }
  item.myAnswer = optionId; // update local copy so navigating back shows the selection
  if(j.isCorrect!=null) item.myAnswerCorrect = j.isCorrect; // per-item feedback only - never a tally
  if(j.correctOptionId!=null) item.correctOptionId = j.correctOptionId; // revealed only now that this item is answered
  if(j.fact!=null){ item.fact = j.fact; item.revealed = !!j.revealed; } // clue-quest's immediate reveal - see session_respond
  if(j.myOutcome!=null) item.myOutcome = j.myOutcome; // decision-room's immediate outcome+feedback - see session_respond
  if(j.myFeedback!=null) item.myFeedback = j.myFeedback;
  if(j.myDebrief!=null) item.myDebrief = j.myDebrief; // decision-room's case debrief, same reveal timing as myOutcome/myFeedback
  return true;
}

// --- Submission helpers - deliberate lock per participant per module ---
// Console gates its own "Solved" button behind reaching Strong/Very-Strong (pass-phrase.js's
// canSolve) rather than accepting any non-empty build - matches that here so a round only
// counts as done once it's actually strong, not just attempted.
function ppRoundIsStrong(it){
  const built = (it._ppSlots ? it._ppSlots.join('') : '') || (it.myBuild && it.myBuild.builtPassword) || '';
  if(!built) return false;
  const level = ppComputeStrength(built, it.weakPassword||'').level;
  return level==='strong' || level==='very-strong';
}
function isActivityAllAnswered(){
  if(!actItems || !actItems.length) return false;
  // pass-phrase: Build phases count as answered once they reach Strong+ (matching console);
  // Choose phases are plain MC, so they count as answered via the generic myAnswer!=null check
  // below, same as every other MC module.
  if(actModuleLoaded === 'pass-phrase'){
    return actItems.every(it => it.kind === 'build' ? ppRoundIsStrong(it) : it.myAnswer!=null);
  }
  // MC modules with discrete options: every item has a myAnswer. Decision-room no longer
  // produces any debrief-only/no-option items (every one of its 10 items is a real decision -
  // its debrief now rides along as myDebrief on the same item, see _load_module_sequence) so
  // the 'debrief'/'svr' kind checks below are kept only as a defensive no-op for any other
  // module or already-in-flight legacy session data. Also treat any item with no options as
  // auto-done even if its kind was mis-tagged, to stay aligned with the server's gate (see
  // session_submit).
  return actItems.every(it=> it.myAnswer!=null || it.kind==='svr' || it.kind==='debrief' || !it.options || it.options.length===0);
}
function updateActivitySubmitVisibility(){
  if(!els.actSubmitWrap) return;
  if(actIsSubmitted){
    els.actSubmitWrap.classList.add('hidden');
    return;
  }
  if(isActivityAllAnswered()){
    els.actSubmitWrap.classList.remove('hidden');
    if(els.actSubmitBtn){
      els.actSubmitBtn.disabled = false;
      els.actSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Done - Submit Answers';
    }
  } else {
    // Also show on last item even if not all answered? Spec says after last item - but for MC we
    // prefer to prompt only when all answered; for continuous modules (crossword/pass-phrase) the
    // crossword has its own submit. Keep hidden until all answered to nudge completion.
    // However if participant is on last item and wants to submit incomplete, they can still tap
    // once they reach last item - show disabled hint.
    if(actIndex === actItems.length - 1 && actItems.length>0){
      els.actSubmitWrap.classList.remove('hidden');
      if(els.actSubmitBtn){
        const allDone = isActivityAllAnswered();
        els.actSubmitBtn.disabled = !allDone;
        els.actSubmitBtn.innerHTML = allDone
          ? '<i class="fa-solid fa-paper-plane"></i> Done - Submit Answers'
          : '<i class="fa-solid fa-paper-plane"></i> Answer all items to submit';
      }
    } else {
      els.actSubmitWrap.classList.add('hidden');
    }
  }
}
async function doActivitySubmit(){
  if(actIsSubmitted) return;
  const module = actModuleLoaded;
  if(!module || !participantId) return;
  if(!isActivityAllAnswered()){
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Please answer every item before you submit.';
    return;
  }
  if(els.actSubmitBtn) els.actSubmitBtn.disabled = true;
  if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Submitting...';
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, module: module})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'Submit failed');
    actIsSubmitted = true;
    mySubmission = {isSubmitted: true, submittedAt: j.submittedAt, module: module};
    showSubmittedFor(module, j.submittedAt);
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = '';
  }catch(e){
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Submit failed: ' + (e.message||'Please try again.');
    if(els.actSubmitBtn) els.actSubmitBtn.disabled = false;
  }
}
function showSubmittedFor(module, submittedAt){
  actIsSubmitted = true;
  // Hide activity/crossword and show dedicated submitted confirmation
  // Keep module name for display
  if(els.submittedModule) els.submittedModule.textContent = module;
  if(els.submittedModule2) els.submittedModule2.textContent = module + ' · locked';
  if(els.submittedAtLine && submittedAt){
    try{ els.submittedAtLine.textContent = 'Submitted at ' + new Date(submittedAt).toLocaleTimeString(); }catch(e){ els.submittedAtLine.textContent = ''; }
  }
  if(els.submittedRememberWrap && els.submittedRememberText){
    if(lastRememberThis){
      els.submittedRememberText.textContent = lastRememberThis;
      els.submittedRememberWrap.classList.remove('hidden');
    } else {
      els.submittedRememberWrap.classList.add('hidden');
    }
  }
  // Control Catch's own final score - "your result" framing, read from this participant's own
  // local game state (never re-fetched from the server, never another participant's numbers  - 
  // see ccEndGame). Falls back to localStorage so a hard refresh after submitting still shows
  // it instead of a bare confirmation with no numbers.
  if(els.submittedScoreWrap && els.submittedScoreText){
    let result = (module==='control-catch') ? ccFinalResult : null;
    if(!result && module==='control-catch'){
      try{ result = JSON.parse(localStorage.getItem('ccResult_'+ROOM_CODE) || 'null'); }catch(e){}
    }
    if(module==='control-catch' && result){
      const mins = Math.floor(result.survivedMs/60000), secs = Math.round((result.survivedMs%60000)/1000);
      els.submittedScoreText.textContent = result.score + ' good caught · ' + result.badPops + ' bad popped · ' + result.livesLeft + '/3 lives left · survived ' + mins + ':' + String(secs).padStart(2,'0');
      els.submittedScoreWrap.classList.remove('hidden');
    } else {
      els.submittedScoreWrap.classList.add('hidden');
    }
  }
  // Control Catch is a real-time reflex round, not a set of reviewable per-item facts like
  // every other module here - "Review Answers with Details" has nothing meaningful to show,
  // so hide it rather than leave a tap that silently does nothing.
  if(els.reviewAnswersBtn) els.reviewAnswersBtn.classList.toggle('hidden', module==='control-catch');
  showScreen('submitted');
}
function updateCwSubmitVisibility(){
  if(!els.cwSubmitWrap) return;
  if(cwIsSubmitted){
    els.cwSubmitWrap.classList.add('hidden');
    return;
  }
  // Crossword: always show submit once grid initialized - participant decides when finished
  if(cwInitialized){
    els.cwSubmitWrap.classList.remove('hidden');
    if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = false;
  } else {
    els.cwSubmitWrap.classList.add('hidden');
  }
}
async function doCwSubmit(){
  if(cwIsSubmitted) return;
  const module = 'crossword';
  if(!participantId) return;
  if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = true;
  if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = 'Submitting...';
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, module: module})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'Submit failed');
    cwIsSubmitted = true;
    mySubmission = {isSubmitted: true, submittedAt: j.submittedAt, module: module};
    showSubmittedFor(module, j.submittedAt);
    // Lock grid inputs
    cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
    if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = '';
  }catch(e){
    if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = 'Submit failed: ' + (e.message||'');
    if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = false;
  }
}
let pendingIntroModule = null;
function showParticipantIntro(curMod, whyText, policyText){
  if(!whyText) return false;
  if(introDismissedFor === curMod) return false;
  pendingIntroModule = curMod;
  if(els.introText) els.introText.textContent = whyText;
  if(els.introPolicy){
    if(policyText){
      els.introPolicy.textContent = policyText;
      els.introPolicy.classList.remove('hidden');
    } else {
      els.introPolicy.textContent = '';
      els.introPolicy.classList.add('hidden');
    }
  }
  showScreen('intro');
  return true;
}
function dismissParticipantIntro(){
  if(!pendingIntroModule) {
    // Fallback: use last activeModule from mySubmission or actModuleLoaded
    const fallback = actModuleLoaded || (mySubmission && mySubmission.module);
    if(fallback) pendingIntroModule = fallback;
    else return;
  }
  introDismissedFor = pendingIntroModule;
  const mod = pendingIntroModule;
  pendingIntroModule = null;
  if(mod === 'crossword'){
    showScreen('crossword');
    ensureCrossword();
    setTimeout(updateCwSubmitVisibility, 400);
  } else if(mod === 'control-catch'){
    // Audio must start from this exact tap - never on page load or a poll tick - to respect
    // mobile browsers' autoplay restrictions. Also avoids a brief wrong-screen flash: without
    // this branch, control-catch fell through to the generic showScreen('activity') below
    // until the next ~1.5s poll corrected it via fetchState's own control-catch dispatch.
    ccEnsureAudioCtx();
    showScreen('control-catch');
    ensureControlCatch();
  } else if(MC_MODULES.includes(mod)){
    showScreen('activity');
    if(actModuleLoaded === mod) renderActivityItem();
    else {
      // Module not yet init'd - next fetchState poll will init, but show placeholder
      if(els.actMount) els.actMount.innerHTML = '<p style="color:#64748b;text-align:center">Loading activity...</p>';
    }
  } else {
    showScreen('activity');
  }
}
if(els.introStartBtn) els.introStartBtn.addEventListener('click', dismissParticipantIntro);
if(els.reviewAnswersBtn) els.reviewAnswersBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = true;
  const mod = pendingIntroModule || introDismissedFor || actModuleLoaded || (mySubmission && mySubmission.module);
  if(!mod) return;
  if(mod === 'crossword'){
    showScreen('crossword');
    ensureCrossword();
    setTimeout(()=>{
      cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
      if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.remove('hidden');
      if(els.cwSubmitWrap) els.cwSubmitWrap.classList.add('hidden');
    }, 300);
  } else if(MC_MODULES.includes(mod)){
    showScreen('activity');
    if(els.reviewBackWrap) els.reviewBackWrap.classList.remove('hidden');
    if(els.actSubmitWrap) els.actSubmitWrap.classList.add('hidden');
    if(actModuleLoaded === mod) renderActivityItem();
  }
});
if(els.backToSubmittedBtn) els.backToSubmittedBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  const mod = mySubmission ? mySubmission.module : null;
  const at = mySubmission ? mySubmission.submittedAt : null;
  if(mod) showSubmittedFor(mod, at);
});
if(els.backToSubmittedFromActivityBtn) els.backToSubmittedFromActivityBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  const mod = mySubmission ? mySubmission.module : actModuleLoaded;
  const at = mySubmission ? mySubmission.submittedAt : null;
  if(mod) showSubmittedFor(mod, at);
  if(els.reviewBackWrap) els.reviewBackWrap.classList.add('hidden');
});
if(els.backToSubmittedFromCwBtn) els.backToSubmittedFromCwBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  showSubmittedFor('crossword', mySubmission && mySubmission.submittedAt);
  if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.add('hidden');
});
if(els.backToSubmittedFromCcBtn) els.backToSubmittedFromCcBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  showSubmittedFor('control-catch', mySubmission && mySubmission.submittedAt);
  if(els.ccReviewBackWrap) els.ccReviewBackWrap.classList.add('hidden');
});

// initActivity() runs ONCE per module (when actModuleLoaded changes) - see fetchState. Poll
// ticks for the SAME module never call this again, so a participant's own Prev/Next position
// and any in-progress tap are never disrupted by the ambient 1.5s poll loop.
function initActivity(module, items){
  actModuleLoaded = module;
  actItems = items || [];
  actIndex = 0;
  // Tag the activity card with the module id, in case a future module-specific layout rule needs it
  const actScreen = document.getElementById('activityScreen');
  if(actScreen) { if(module) actScreen.dataset.module = module; else delete actScreen.dataset.module; }
  // Reset per-activity submission lock from server state (fetchState will have set mySubmission)
  actIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && mySubmission.module===module);
  els.actModuleBadge.textContent = module;
  renderActivityItem();
}

function updateActivityChrome(){
  const total = actItems.length;
  els.actProgress.textContent = (actIndex+1) + ' / ' + total;
  els.actPrevBtn.disabled = actIndex<=0;
  els.actNextBtn.disabled = actIndex>=total-1;
  els.actDots.innerHTML = actItems.map((it,i)=>{
    // pass-phrase Build phases have no single "answer" - their dot only turns "done" once the
    // build reaches Strong+, matching console's own Solved-button gate (ppRoundIsStrong).
    // Choose phases are plain MC, so they fall through to the generic myAnswer!=null check.
    const hasBuild = (actModuleLoaded==='pass-phrase' && it.kind==='build') ? ppRoundIsStrong(it)
      : (it._ppSlots && it._ppSlots.length>0) || (it.myBuild && it.myBuild.builtPassword && it.myBuild.builtPassword.length>0);
    const isDone = it.myAnswer!=null || hasBuild || it.kind==='svr' || it.kind==='debrief' || !it.options || it.options.length===0;
    const cls = ['dot']; if(isDone) cls.push('done'); if(i===actIndex) cls.push('current');
    const kindLabel = it.kind==='debrief' ? 'debrief' : it.kind==='svr' ? 'info' : `step ${i+1}`;
    const stateLabel = isDone ? 'answered' : 'unanswered';
    // Dot is now interactive - shows answered vs unanswered (done=cyan, unanswered=gray) and
    // is tappable to jump directly, so a user can visually spot the missing step before Submit.
    return `<span class="${cls.join(' ')}" data-dot-idx="${i}" role="button" tabindex="0" aria-label="${kindLabel} ${stateLabel}" title="${kindLabel}: ${stateLabel} - click to jump" style="cursor:pointer"></span>`;
  }).join('');
  // Wire dot navigation - tap any dot to jump directly (visual answered/unanswered already
  // encoded in done vs gray; this makes the dots functional navigation, not just decoration).
  els.actDots.querySelectorAll('[data-dot-idx]').forEach(el=>{
    const go = ()=>{
      const idx = parseInt(el.dataset.dotIdx,10);
      if(!isNaN(idx) && idx>=0 && idx<actItems.length){
        actIndex = idx;
        renderActivityItem();
      }
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); go(); }});
  });
  updateActivitySubmitVisibility();
}

function renderActivityItem(){
  const item = actItems[actIndex];
  if(!item){ els.actMount.innerHTML = '<p style="color:#94a3b8">No items in this activity.</p>'; return; }
  const renderer = ACTIVITY_RENDERERS[actModuleLoaded] || renderGenericItem;
  els.actMount.innerHTML = renderer(item);
  // Pass-phrase's Build phase has no [data-answer-opt] vote at all - it's a free-build
  // deck/slot interaction with its own wiring and its own debounced submit, not a
  // single-answer lock. Its Choose phase is plain MC though, so it wires like every other
  // MC module's options.
  if(actModuleLoaded === 'pass-phrase' && item.kind === 'build') wirePassPhraseBuild(item);
  else wireActivityOptions(item);
  // Clue-quest's 30s-per-riddle timer is its own mechanic, layered on top of the shared
  // [data-answer-opt] wiring above (which already handles a real tap).
  if(actModuleLoaded === 'clue-quest'){ cqManageTimer(item); }
  updateActivityChrome();
}

function wireActivityOptions(item){
  // If already submitted for this module, lock completely - no further edits even via Prev
  if(actIsSubmitted){
    els.actMount.querySelectorAll('[data-answer-opt]').forEach(btn=>{
      btn.style.pointerEvents = 'none';
      btn.disabled = true;
      const optId = btn.dataset.answerOpt;
      if(String(item.myAnswer)===String(optId)) btn.classList.add('picked');
    });
    return;
  }
  const already = item.myAnswer!=null;
  els.actMount.querySelectorAll('[data-answer-opt]').forEach(btn=>{
    const optId = btn.dataset.answerOpt;
    if(already){
      btn.style.pointerEvents = 'none';
      if(String(item.myAnswer)===String(optId)) btn.classList.add('picked');
      return;
    }
    btn.addEventListener('click', async ()=>{
      if(actIsSubmitted) return;
      els.actMount.querySelectorAll('[data-answer-opt]').forEach(b=>{ b.style.pointerEvents='none'; });
      try{
        const ok = await submitAnswer(item, optId);
        if(!ok) return;
        // Re-render this same item (not just toggle a class) so every module's own "picked"
        // text/state (e.g. fault-finding's "Tap if fake" -> "Your answer") stays in sync,
        // not just the border color.
        renderActivityItem();
        // Brief pause so the tap visibly registers, then auto-advance (participant can still
        // use Prev to go back and change an answer - /respond allows overwrite). Items with
        // correct/wrong feedback get longer - that's meant to be read, not just glimpsed.
        // Decision-room gets the same longer pause: each answer now reveals both the outcome
        // feedback AND the case debrief inline (see renderDecisionRoom), more to read than a
        // plain correct/incorrect badge.
        const advanceDelay = (item.myAnswerCorrect!=null || actModuleLoaded==='decision-room') ? 1400 : 550;
        setTimeout(()=>{ if(actIndex < actItems.length-1){ actIndex++; renderActivityItem(); } }, advanceDelay);
      }catch(e){
        const msg = (e.message||'');
        if(msg.includes('already submitted')){
          actIsSubmitted = true;
          if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Already submitted - answers locked.';
          showSubmittedFor(actModuleLoaded, mySubmission && mySubmission.submittedAt);
          return;
        }
        els.actMount.querySelectorAll('[data-answer-opt]').forEach(b=>{ b.style.pointerEvents=''; });
      }
    });
  });
}
els.actPrevBtn.addEventListener('click', ()=>{ if(actIndex>0){ actIndex--; renderActivityItem(); } });
els.actNextBtn.addEventListener('click', ()=>{ if(actIndex<actItems.length-1){ actIndex++; renderActivityItem(); } });
// Submit handlers - wired once, safe to re-add (idempotent guard inside)
if(els.actSubmitBtn) els.actSubmitBtn.addEventListener('click', doActivitySubmit);
if(els.cwSubmitBtn) els.cwSubmitBtn.addEventListener('click', doCwSubmit);
if(els.ccSubmitBtn) els.ccSubmitBtn.addEventListener('click', doCcSubmit);

// --- Per-module templates - adapted from the facilitator console's own component classes
// (console.css, linked above) so a phone and the big screen read as the same activity. ---
function renderFaultFinding(item){
  const picked = item.myAnswer;
  // correctOptionId is only ever populated once picked!=null (see _sanitize_item_for_participant)  - 
  // console's reveal() adds the same reveal-fake/reveal-real glow to its two panels the instant
  // Reveal is tapped, so this fires in step with the immediate Correct/Not-quite badge below,
  // not deferred to Submit like the explanatory text is.
  const correctId = item.correctOptionId;
  const panel = (letter, img)=>{
    const cls = ['ff-compare-panel'];
    // Once revealed, defer entirely to console's real reveal-fake/reveal-real glow (matching
    // console's own reveal() exactly) rather than layering the phone-only "picked" cyan
    // override on top of it - the "✓ Your answer" tap-hint text below still marks which
    // panel was tapped, so that information isn't lost, just no longer fighting the glow color.
    if(picked!=null && correctId!=null) cls.push(letter===correctId ? 'reveal-fake' : 'reveal-real');
    else if(picked===letter) cls.push('picked');
    return '<button type="button" class="'+cls.join(' ')+'" data-answer-opt="'+letter+'">'
      + '<div class="ff-compare-label">OPTION '+letter+'</div>'
      + (img ? '<img src="'+esc(img)+'" alt="Option '+letter+'"/>' : '<div style="padding:24px;text-align:center;color:#94a3b8">(no image)</div>')
      + '<div class="ff-tap-hint">'+(picked===letter?'✓ Your answer':'Tap if this one is fake')+'</div>'
      + '</button>';
  };
  // Parity with console: show persona · category like fault-finding.js:96-97
  const ffTag = [item.persona, item.category].filter(Boolean).join(' · ');
  // Console's own ff-compare-reveal: two rows, What's Wrong + Why It's Suspicious - kept
  // separate (not blended into one paragraph) and only populated once item.fact arrives,
  // which for this module is deliberately deferred until whole-activity Submit (see
  // _sanitize_item_for_participant) - same hybrid timing as the badge-now/detail-later split
  // this module has always had.
  const reveal = (item.fact || item.whatIsWrong) ? ('<div class="ff-compare-reveal show">'
      + (item.whatIsWrong ? '<div class="ff-r-row"><i class="fa-solid fa-circle-exclamation"></i><div><div class="ff-r-label">What’s Wrong</div><div class="ff-r-text">'+esc(item.whatIsWrong)+'</div></div></div>' : '')
      + (item.fact ? '<div class="ff-r-row"><i class="fa-solid fa-lightbulb"></i><div><div class="ff-r-label">Why It’s Suspicious</div><div class="ff-r-text">'+esc(item.fact)+'</div></div></div>' : '')
      + '</div>') : '';
  const badge = item.myAnswerCorrect!=null
    ? (item.myAnswerCorrect
        ? '<div class="feedback-badge correct"><i class="fa-solid fa-check"></i> Correct</div>'
        : '<div class="feedback-badge incorrect"><i class="fa-solid fa-xmark"></i> Not quite</div>')
    : '';
  return '<div class="ff-compare-frame">'
    + (ffTag ? '<div class="ff-category-tag" style="display:inline-block;margin-bottom:8px">'+esc(ffTag)+'</div>' : '')
    + '<div style="text-align:center;font-weight:800;margin-bottom:10px;color:var(--navy,#001a4d)">Which one is <span style="color:var(--red,#ef4444)">FAKE</span>?</div>'
    + '<div class="ff-compare-row">' + panel('A', item.realImage) + panel('B', item.fakeImage) + '</div>'
    + reveal
    + '</div>' + badge;
}
// Hybrid feedback: immediate badge (Correct/Not quite) after answer, plus full
// identification + recommendation (fact/whatIsWrong) only after deliberate Submit  - 
// mirrors console's Reveal (whatIsWrong + whyItsSuspicious) but delayed until locked.
function renderCorrectFeedback(item){
  let html = '';
  if(item.myAnswerCorrect!=null){
    html += item.myAnswerCorrect
      ? '<div class="feedback-badge correct"><i class="fa-solid fa-check"></i> Correct</div>'
      : '<div class="feedback-badge incorrect"><i class="fa-solid fa-xmark"></i> Not quite</div>';
  }
  if(item.fact){
    // white-space:pre-line honors the newline separators pass-phrase's Choose-phase composes
    // into its fact string (one line per option's verdict+reason) - a no-op for every other
    // module, whose fact strings never contain a line break.
    const factLabel = item.kind==='choose' ? 'Why each option passed or failed:' : 'Details - Identification & Recommendation:';
    html += '<div style="margin-top:10px;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:10px 12px;border-radius:6px;font-size:var(--fs-badge);line-height:1.5;color:#0c4a6e;text-align:left;white-space:pre-line"><strong>'+factLabel+'</strong><br>'+esc(item.fact)+'</div>';
  } else if(item.myAnswerCorrect==null && !item.fact){
    return '';
  }
  return html;
}
function renderMythVsFact(item){
  const picked = item.myAnswer;
  // Console's myth/fact/detail card, real classes - the yes/no quiz buttons below have no
  // console equivalent (console is pure narration, no vote at all) so those stay phone-only.
  const factWrap = item.fact ? ('<div class="mf-fact-wrap show">'
      + '<div class="mf-fact-label"><i class="fa-solid fa-check"></i> Fact</div>'
      + '<div class="mf-fact">'+esc(item.fact)+'</div>'
      + (item.detail ? '<div class="mf-detail">'+esc(item.detail)+'</div>' : '')
      + '</div>') : '';
  const badge = item.myAnswerCorrect!=null
    ? (item.myAnswerCorrect
        ? '<div class="feedback-badge correct"><i class="fa-solid fa-check"></i> Correct</div>'
        : '<div class="feedback-badge incorrect"><i class="fa-solid fa-xmark"></i> Not quite</div>')
    : '';
  return '<div class="mf-card">'
    + (item.topic ? '<div class="mf-topic-tag">'+esc(item.topic)+'</div>' : '')
    + '<div class="mf-myth-label" style="margin-top:10px">Myth</div>'
    + '<div class="mf-myth'+(picked!=null?' busted':'')+'">'+esc(item.prompt||'')+'</div>'
    + factWrap
    + '</div>'
    + '<div class="options" style="margin-top:14px">' + (item.options||[]).map(opt=>{
        const sel = picked!=null && String(picked)===String(opt.id);
        return '<button type="button" class="option-btn'+(sel?' selected picked':'')+'" data-answer-opt="'+esc(opt.id)+'">'+esc(opt.text)+'</button>';
      }).join('') + '</div>'
    + badge;
}
function renderDecisionRoom(item){
  let html = '';
  // Every case is now exactly one sequence item (scenario -> one decision -> debrief, see
  // _load_module_sequence's decision-room branch) so the case position is just this item's own
  // index in actItems - no more multi-decision-per-case bookkeeping needed.
  const caseNum = actItems.indexOf(item) + 1;
  const caseTotal = actItems.length || 10;
  const caseProgress = `Case ${caseNum}/${caseTotal}`;
  if(item.persona || item.caseTitle){
    html += '<div class="ff-title-bar">';
    html += "<div style=\"font-family:'Space Mono',monospace;font-size:var(--fs-badge);font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#64748b;margin-bottom:6px;\">"+esc(caseProgress)+"</div>";
    if(item.persona) html += '<div class="dr-persona-tag">'+esc(item.persona)+'</div>';
    if(item.caseTitle) html += '<h2 style="margin:8px 0 4px;font-size:var(--fs-body);color:var(--navy,#001a4d)">'+esc(item.caseTitle)+'</h2>';
    if(item.caseScenario) html += '<div class="dr-scenario-context">'+esc(item.caseScenario)+'</div>';
    html += '</div>';
  }
  const picked = item.myAnswer;
  html += '<div class="dr-scene"><div class="dr-prompt" style="margin:14px 0;color:var(--navy,#001a4d);font-weight:700">'+esc(item.prompt||'')+'</div>';
  html += '<div class="dr-options">' + (item.options||[]).map((opt,idx)=>{
    const letter = String.fromCharCode(65+idx);
    const sel = picked!=null && String(picked)===String(opt.id);
    // Once the chosen option's outcome is known, defer to console's real good/consequence
    // color-coding (matching console's own selected.good/selected.consequence exactly)
    // instead of the phone-only cyan "picked" override, same reasoning as fault-finding's
    // reveal-fake/reveal-real vs. picked.
    const cls = ['dr-option'];
    if(sel && item.myOutcome) cls.push('selected', item.myOutcome);
    else if(sel) cls.push('picked');
    return '<button type="button" class="'+cls.join(' ')+'" data-answer-opt="'+esc(opt.id)+'"><span class="dr-opt-letter">'+letter+'</span><span class="dr-opt-text">'+esc(opt.text)+'</span></button>';
  }).join('') + '</div>';
  // Console shows the chosen option's own feedback inline the instant it's picked (dr-feedback,
  // color-matched to that option's outcome) - no separate badge, no blended "good answer" text.
  if(picked!=null && item.myFeedback){
    html += '<div class="dr-feedback show'+(item.myOutcome?(' '+item.myOutcome):'')+'">'+esc(item.myFeedback)+'</div>';
  }
  // The case's debrief now shows inline right below the outcome, once answered - reusing the
  // same dr-debrief-panel look this used to get as its own separate step (see the app.py
  // comment on caseDebrief/myDebrief for why it's bundled onto this one item instead).
  if(picked!=null && item.myDebrief){
    html += '<div class="dr-debrief-panel" style="margin-top:14px"><div class="ff-r-row"><i class="fa-solid fa-lightbulb"></i><div>'
      + '<div class="ff-r-label">Debrief</div><div class="ff-r-text">'+esc(item.myDebrief)+'</div>'
      + '</div></div></div>';
  }
  html += '</div>';
  return html;
}
const CQ_TIMER_SECONDS = 30;
let cqTimerInterval = null, cqTimerItemId = null;
function cqStopTimer(){ if(cqTimerInterval){ clearInterval(cqTimerInterval); cqTimerInterval=null; } cqTimerItemId=null; }
// Console's clue-quest gives a genuine 30s-per-riddle countdown (LiveEvent.createTimer) that
// locks the riddle and shows a "Time up" state on expiry; the phone had no timer at all before
// this, so a participant could sit on a riddle indefinitely. Manages one interval for whichever
// clue-quest item is currently on screen - stopped/restarted on navigation or answer.
function cqManageTimer(item){
  if(actModuleLoaded!=='clue-quest' || item.myAnswer!=null || item._cqTimedOut){ cqStopTimer(); return; }
  if(cqTimerItemId===item.id) return; // already ticking for this exact item - don't restart on re-render
  cqStopTimer();
  cqTimerItemId = item.id;
  if(item._cqSecondsLeft==null) item._cqSecondsLeft = CQ_TIMER_SECONDS;
  cqRenderTimerDisplay(item);
  cqTimerInterval = setInterval(()=>{
    item._cqSecondsLeft--;
    if(item._cqSecondsLeft<=0){
      cqStopTimer();
      item._cqTimedOut = true;
      if(actItems[actIndex]===item) renderActivityItem();
      return;
    }
    cqRenderTimerDisplay(item);
  }, 1000);
}
function cqRenderTimerDisplay(item){
  const el = document.getElementById('cqTimer');
  if(!el) return;
  const remaining = Math.max(item._cqSecondsLeft||0, 0);
  el.classList.remove('amber','red');
  if(remaining<=5) el.classList.add('red'); else if(remaining<=10) el.classList.add('amber');
  const digits = el.querySelector('.lt-digits');
  if(digits) digits.textContent = String(remaining).padStart(2,'0');
}
function renderClueQuest(item){
  const picked = item.myAnswer;
  const answered = picked!=null;
  const timedOut = !!item._cqTimedOut;
  const locked = answered || timedOut;
  // Shuffle once per riddle and cache on the item - recomputing on every render (which
  // renderActivityItem does right after a tap, to reflect the new answer state) made the
  // options visibly reorder under the participant's thumb the instant they picked one.
  if(!item._cqShuffled) item._cqShuffled = (item.options||[]).slice().sort(()=> Math.random()-0.5);
  const shuffled = item._cqShuffled;
  const correctId = item.correctOptionId;
  let feedbackHtml = '';
  if(answered && correctId!=null){
    feedbackHtml = item.myAnswerCorrect
      ? '<div class="cq-feedback show correct">✓ Correct - '+esc(item.fact||'')+'</div>'
      : '<div class="cq-feedback show incorrect">✗ Not quite - correct is '+esc(item.fact||'')+'</div>';
  } else if(timedOut){
    feedbackHtml = '<div class="cq-feedback show timeout">Time up - no answer locked in this round</div>';
  }
  const showTimer = !answered && !timedOut;
  return '<div class="cq-riddle-card"><div class="cq-riddle-text">'+esc(item.prompt||'')+'</div>'
    + (item.fact ? '<div class="cq-answer-reveal'+(answered?' show':'')+'">'+esc(item.fact)+'</div>' : '')
    + '</div>'
    + (showTimer ? '<div class="le-timer" id="cqTimer" style="margin:14px auto"><div class="lt-digits">30</div><div class="lt-label">Seconds</div></div>' : '')
    + '<div class="cq-options">' + shuffled.map((opt,idx)=>{
        const sel = answered && String(picked)===String(opt.id);
        const isCorrectOpt = correctId!=null && String(opt.id)===String(correctId);
        const cls = ['cq-option']; if(sel) cls.push('picked');
        if(locked && correctId!=null){ if(isCorrectOpt) cls.push('correct'); else if(sel) cls.push('incorrect'); }
        const tapAttr = locked ? '' : ' data-answer-opt="'+esc(opt.id)+'"';
        return '<div class="'+cls.join(' ')+'"'+tapAttr+'><span class="cq-opt-num">'+(idx+1)+'</span>'+esc(opt.text)+'</div>';
      }).join('') + '</div>'
    + feedbackHtml;
}
// --- Pass-phrase: real build-your-own-password mechanic (tap-to-place, not drag - touch
// drag was already deemed unreliable in an earlier pass). Matches the console's actual
// activity (a themed deck, a 12-slot password row, a live strength meter) instead of a
// rating poll on a pre-built password. ---

// Verbatim from live-event/modules/pass-phrase.js's own computeStrength() (trimmed to the
// fields the phone UI needs) - same scoring the console uses, so the live meter here matches
// exactly. The debounced POST to /passphrase/build re-runs this SAME logic server-side
// (_pp_compute_strength in app.py) as the authoritative, stored value - this copy is only an
// instant local preview so the meter doesn't wait on a network round-trip for every tap.
function ppComputeStrength(pw, weak){
  // Line-for-line port of console's own computeStrength() (pass-phrase.js) - including crack
  // time and level, which the phone previously computed server-side (_pp_compute_strength) but
  // never surfaced in this client-side preview copy, so "time to crack" never rendered.
  var checks = {
    upper: /[A-Z]/.test(pw), lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw), special: /[^A-Za-z0-9]/.test(pw)
  };
  var score=0;
  if(pw.length >=12) score+=25; else if(pw.length >=8) score+=10;
  if(pw.length >=16) score+=10;
  if(checks.upper) score+=15;
  if(checks.lower) score+=15;
  if(checks.number) score+=15;
  if(checks.special) score+=15;
  if(checks.upper && checks.lower && checks.number && checks.special && pw.length>=12) score+=5;
  if(weak){
    var normPw=pw.toLowerCase(), normWeak=weak.toLowerCase();
    if(normPw===normWeak) score=Math.max(0,score-30);
    else if(normPw.includes(normWeak) || normWeak.includes(normPw)) score=Math.max(0,score-15);
    if(pw.length - weak.length <=2 && normPw.includes(normWeak.slice(0,4))) score=Math.max(0,score-10);
  }
  if(/(.){2,}/.test(pw)) score=Math.max(0,score-10);
  score=Math.min(100,Math.max(0,score));
  var charset=0;
  if(checks.lower) charset+=26;
  if(checks.upper) charset+=26;
  if(checks.number) charset+=10;
  if(checks.special) charset+=12;
  var crack=' - ';
  if(pw.length>0 && charset>0){
    var entropy=pw.length*Math.log2(charset);
    var guesses=Math.pow(2,entropy);
    var s=guesses/1e9;
    if(s<1) crack='< 1 second';
    else if(s<60) crack=Math.round(s)+' seconds';
    else if(s<3600) crack=Math.round(s/60)+' minutes';
    else if(s<86400) crack=Math.round(s/3600)+' hours';
    else if(s<2592000) crack=Math.round(s/86400)+' days';
    else if(s<31536000) crack=Math.round(s/2592000)+' months';
    else if(s<315360000) crack=Math.round(s/31536000)+' years';
    else crack='centuries';
  }
  var label='Weak', level='weak', color='#ef4444';
  if(pw.length===0 || score<40){ label='Weak'; level='weak'; color='#ef4444'; }
  else if(score<60){ label='Fair'; level='fair'; color='#f59e0b'; }
  else if(score<80){ label='Strong'; level='strong'; color='#10b981'; }
  else { label='Very Strong'; level='very-strong'; color='#065f46'; }
  return {score:score, label:label, level:level, color:color, crack:crack};
}

// Local-only build state, stashed directly on the item object (same pattern as myAnswer)
// so navigating away and back to a round preserves in-progress placement without a round-trip.
// Chunk-aware: deck is 15 mixed chunks (e.g. "Ka","Th","on", singles, symbols). Password row
// holds whole chunks per tile (not single characters), capped by total character count
// (maxChars 12) not tile count. Deck availability is per chunk, and resume from myBuild's
// builtPassword string (which loses chunk boundaries) is reconstructed greedily by matching
// deck chunks against the built string - preferring longer chunks first - sufficient for
// demo continuity; exact chunk identity is recovered via server-stored strength anyway.
//
// _ppSlots is a COMPACT array - one entry per placed chunk, in placement order, with no gaps
// ever stored (previously this was a fixed-length array pre-filled with nulls and chunks were
// written directly to whatever slot index the participant tapped, which could leave nulls in
// the middle if that tap didn't land on the very next sequential empty button - the row then
// rendered those nulls as gaps between chunks). Placing always appends to the end of this
// array; removing always splices the chunk out, so everything after it shifts down automatically
// and the row can never show a gap or have chunks render out of placement order.
function ppEnsureState(item){
  if(item._ppSlots) return;
  var maxChars = item.maxChars || item.maxSlots || 15;
  var deck = item.deck || [];
  // Rebalanced: deck 15, cap 20 — with mixed 1-3 char chunks total char potential exceeds
  // cap, so choice matters. maxTiles is deck length capped by maxChars worst-case.
  var maxTiles = Math.min(deck.length || 15, maxChars);
  var slots = [];
  var built = (item.myBuild && item.myBuild.builtPassword) || '';
  var deckAvail = deck.map(function(){ return true; });
  // Reconstruct which deck chunks were used to build the string, greedily matching
  // longest deck chunks first to disambiguate ("Ka" vs "K"+"a").
  var pos = 0;
  // Build a copy of deck sorted by length desc for matching
  var deckByLen = deck.map(function(ch, idx){ return {ch:ch, idx:idx}; });
  deckByLen.sort(function(a,b){ return b.ch.length - a.ch.length; });
  while(pos < built.length && slots.length < maxTiles){
    var matched = null;
    var matchLen = 0;
    for(var k=0;k<deckByLen.length;k++){
      var entry = deckByLen[k];
      if(!deckAvail[entry.idx]) continue;
      var chunk = entry.ch;
      if(built.substr(pos, chunk.length) === chunk){
        matched = entry;
        matchLen = chunk.length;
        break;
      }
    }
    if(matched){
      slots.push(matched.ch);
      deckAvail[matched.idx] = false;
      pos += matchLen;
    } else {
      // No deck chunk matches at this position - fall back to single char (may be residue
      // from old single-char content still in wild). Treat built[pos] as a tile if it exists
      // as a deck entry, else just advance.
      var ch = built[pos];
      var foundIdx = -1;
      for(var i=0;i<deck.length;i++){ if(deckAvail[i] && deck[i]===ch){ foundIdx=i; break; } }
      if(foundIdx!==-1){
        slots.push(ch);
        deckAvail[foundIdx]=false;
      } else {
        // orphan char - place it anyway as a tile (deck-less) so password string is preserved
        slots.push(ch);
      }
      pos += 1;
    }
  }
  // Enforce maxChars cap: if reconstructed string exceeds maxChars, drop chunks off the end
  var totalChars = slots.join('').length;
  while(totalChars > maxChars && slots.length>0){
    var removed = slots.pop();
    if(removed){
      for(var i=0;i<deck.length;i++){ if(!deckAvail[i] && deck[i]===removed){ deckAvail[i]=true; break; } }
    }
    totalChars = slots.join('').length;
  }
  item._ppSlots = slots;
  item._ppDeckAvailable = deckAvail;
  item._ppSelectedDeckIdx = null;
  item._ppMaxTiles = maxTiles;
  item._ppMaxChars = maxChars;
  item._ppShuffleUsed = item._ppShuffleUsed || false;
  item._ppPrevTier = item._ppPrevTier || null;
}

let ppSubmitTimer = null;
function ppSubmitBuild(item){
  if(actIsSubmitted) return;
  clearTimeout(ppSubmitTimer);
  ppSubmitTimer = setTimeout(function(){
    if(actIsSubmitted) return;
    const built = item._ppSlots.join('');
    fetch('/api/session/' + ROOM_CODE + '/passphrase/build', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({participantId: participantId, roundId: item.id, builtPassword: built})
    }).catch(function(){});
  }, 500);
}

function renderPassPhrase(item){
  // Choose phase (pick the compliant password among 4) reuses the exact same generic MC
  // renderer every other module's options use - only the Build phase below needs the
  // deck/slots UI. See the matching branch in the wiring dispatch (wireActivityOptions vs
  // wirePassPhraseBuild) and updateActivityChrome's per-dot done-check.
  if(item.kind === 'choose') return renderGenericItem(item);
  ppEnsureState(item);
  const built = item._ppSlots.join('');
  const result = ppComputeStrength(built, item.weakPassword||'');
  const maxChars = item._ppMaxChars || item.maxChars || 15;
  // tier pulse tracking
  var prevTier = item._ppPrevTier;
  var tierPulseClass = (prevTier && prevTier!==result.level) ? ' tier-pulse' : '';
  item._ppPrevTier = result.level;
  const difficulty = item.difficulty || 'medium';
  const diffLabel = difficulty.charAt(0).toUpperCase()+difficulty.slice(1);
  const twoCount = (item.deck||[]).filter(function(c){return String(c).length===2;}).length;
  const threeCount = (item.deck||[]).filter(function(c){return String(c).length>=3;}).length;
  let html = '<div class="pp-weak-card">'
    + '<div class="pp-weak-label"><i class="fa-solid fa-triangle-exclamation"></i> Starting Sample - Weak <span style="margin-left:6px;font-weight:400;opacity:0.7">['+esc(diffLabel)+']</span></div>'
    + '<div class="pp-weak-text">'+esc(item.weakPassword||'')+'</div>'
    + (item.violates ? '<div class="pp-weak-violates"><i class="fa-solid fa-circle-xmark"></i> Violates: '+esc(item.violates)+'</div>' : '')
    + (item.weakRequirement ? '<div class="pp-weak-meta">'+esc(diffLabel+' - '+item.weakRequirement+' - deck has '+item.deck.length+' chunks ('+twoCount+' ×2-char, '+threeCount+' ×3-char) to rebuild strong (cap '+maxChars+' chars)')+'</div>' : '')
    + '</div>';
  html += '<div class="pp-builder-card" style="margin-top:14px;padding:14px">'
    + '<div class="pp-strength"><div class="pp-strength-head">'
    + '<span class="pp-strength-label" style="color:'+result.color+'">Strength: '+result.label+'</span>'
    + "<span style=\"margin-left:8px;color:#94a3b8;font-family:'Space Mono',monospace;font-size:var(--fs-badge)\">"+result.score+" / 100</span>"
    + '</div>'
    + '<div class="pp-meter"><div class="pp-meter-fill'+tierPulseClass+'" style="width:'+result.score+'%;background:'+result.color+'"></div></div>'
    + '<div class="pp-meter-labels"><span>Weak</span><span>Fair</span><span>Strong</span><span>V.Strong</span></div>'
    + '<div class="pp-crack">Time to crack: '+esc(result.crack)+'</div>'
    + '</div></div>';
  html += '<div class="pp-section-label"><i class="fa-solid fa-lock"></i> Your Password <span>'+built.length+' / '+maxChars+' chars</span></div>';
  // Filled tiles render first, in placement order (item._ppSlots is a compact array - see
  // ppEnsureState), immediately followed by whatever empty slots remain - so a gap can never
  // appear between two placed chunks, only ever after the last one.
  const emptyCount = Math.max(0, (item._ppMaxTiles||item.deck.length||0) - item._ppSlots.length);
  html += '<div class="pp-tiles'+tierPulseClass+'" id="ppSlotsRow">'
    + item._ppSlots.map((ch,i)=>{
        const len = String(ch).length;
        const chunkCls = len>=3 ? ' chunk-tile3' : (len===2 ? ' chunk-tile' : '');
        return '<button type="button" class="pp-tile'+chunkCls+'" data-slot-idx="'+i+'" data-filled="1"><span class="pp-tile-letter">'+esc(ch)+'</span></button>';
      }).join('')
    + Array(emptyCount).fill('<button type="button" class="pp-slot-empty"></button>').join('')
    + '</div>';
  html += '<div class="pp-section-label" style="margin-top:14px">'
    + '<i class="fa-solid fa-layer-group"></i> Deck - tap a chunk, then tap a slot above <span style="margin-left:auto;color:#94a3b8;font-weight:400">['+esc(diffLabel)+' · '+twoCount+'×2-char, '+threeCount+'×3-char · scarce premium]</span></div>';
  html += '<div class="pp-deck" id="ppDeckTray">' + item.deck.map((ch,i)=>{
      const avail = item._ppDeckAvailable[i];
      const isSelected = item._ppSelectedDeckIdx===i;
      const len = String(ch).length;
      const cls = ['pp-tile','pp-deck-tile']; if(len>=3) cls.push('chunk-tile3'); else if(len===2) cls.push('chunk-tile'); if(!avail) cls.push('is-inert'); if(isSelected) cls.push('selected');
      return '<button type="button" class="'+cls.join(' ')+'" data-deck-idx="'+i+'" '+(!avail?'disabled':'')+'><span class="pp-tile-letter">'+esc(ch)+'</span></button>';
    }).join('') + '</div>';
  // Shuffle deck (once per round) — adds strategic gamble, phone+console consistent
  var shuffleDisabled = item._ppShuffleUsed || actIsSubmitted ? ' disabled' : '';
  var shuffleLabel = item._ppShuffleUsed ? 'Shuffled (1/1 used)' : 'Shuffle Deck (once per round)';
  html += '<div style="display:flex;gap:10px;justify-content:center;margin-top:10px;align-items:center">'
    + '<button type="button" class="le-btn" id="ppShuffleBtn"'+shuffleDisabled+'><i class="fa-solid fa-shuffle"></i> '+shuffleLabel+'</button>'
    + "<span style=\"font-family:'Space Mono',monospace;font-size:var(--fs-badge);color:#94a3b8\">Swap 3-4 unused tiles — strategic gamble</span></div>";
  html += "<div style=\"margin-top:6px;font-family:'Space Mono',monospace;font-size:var(--fs-badge);color:#64748b;text-align:center\">Chunk-aware cap: "+maxChars+" total characters, not tile count - a \"Syn\" tile counts as 3</div>";
  return html;
}

function wirePassPhraseBuild(item){
  // Locked after submit - deck/slots become inert
  if(actIsSubmitted){
    const deckTrayLock = document.getElementById('ppDeckTray');
    if(deckTrayLock) deckTrayLock.querySelectorAll('[data-deck-idx]').forEach(btn=>{ btn.disabled = true; btn.style.pointerEvents='none'; btn.classList.add('is-inert'); });
    const slotsRowLock = document.getElementById('ppSlotsRow');
    if(slotsRowLock) slotsRowLock.querySelectorAll('[data-filled]').forEach(el=>{ el.style.pointerEvents='none'; });
    return;
  }
  const deckTray = document.getElementById('ppDeckTray');
  const slotsRow = document.getElementById('ppSlotsRow');
  if(deckTray){
    deckTray.querySelectorAll('[data-deck-idx]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        const idx = Number(btn.dataset.deckIdx);
        if(!item._ppDeckAvailable[idx]) return;
        // Enforce char cap even for selection preview - grey out if would exceed
        const maxChars = item._ppMaxChars || item.maxChars || 15;
        const curChars = item._ppSlots.join('').length;
        const chunk = item.deck[idx];
        // Only prevent selection if already at cap; allow deselection
        if(item._ppSelectedDeckIdx!==idx && curChars + String(chunk).length > maxChars){
          // flash the count? just ignore tap - cap reached
          return;
        }
        // Tap the same tile again to deselect it without placing.
        item._ppSelectedDeckIdx = (item._ppSelectedDeckIdx===idx) ? null : idx;
        renderActivityItem();
      });
    });
  }
  if(slotsRow){
    // Filled tiles: tapping one removes it via splice (not a null-out) - everything after it
    // shifts down automatically, so the row can never show a gap where a chunk was.
    slotsRow.querySelectorAll('[data-filled]').forEach(el=>{
      el.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        const idx = Number(el.dataset.slotIdx);
        const ch = item._ppSlots[idx];
        item._ppSlots.splice(idx, 1);
        for(let i=0;i<item.deck.length;i++){ if(!item._ppDeckAvailable[i] && item.deck[i]===ch){ item._ppDeckAvailable[i]=true; break; } }
        renderActivityItem();
        ppSubmitBuild(item);
      });
    });
    // Empty slots are interchangeable - whichever one is tapped, a selected deck chunk always
    // appends to the end of the placed sequence, never at the tapped button's own position, so
    // placement order always matches the order chunks were actually picked.
    slotsRow.querySelectorAll('.pp-slot-empty').forEach(el=>{
      el.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        if(item._ppSelectedDeckIdx==null) return; // nothing selected - tapping an empty slot alone does nothing
        const dIdx = item._ppSelectedDeckIdx;
        const chunk = item.deck[dIdx];
        const maxChars = item._ppMaxChars || item.maxChars || 15;
        const curChars = item._ppSlots.join('').length;
        if(curChars + String(chunk).length > maxChars) return;
        item._ppSlots.push(chunk);
        item._ppDeckAvailable[dIdx] = false;
        item._ppSelectedDeckIdx = null;
        renderActivityItem();
        ppSubmitBuild(item);
      });
    });
  }
  // Shuffle deck — once per round, swaps 3-4 unused tiles
  const shuffleBtn = document.getElementById('ppShuffleBtn');
  if(shuffleBtn){
    shuffleBtn.addEventListener('click', ()=>{
      if(actIsSubmitted || item._ppShuffleUsed) return;
      if(item._ppDeckAvailable.filter(Boolean).length < 3) return;
      var unusedIdxs = [];
      for(var i=0;i<item.deck.length;i++) if(item._ppDeckAvailable[i]) unusedIdxs.push(i);
      // pick 3-4 to replace
      var count = 3 + Math.floor(Math.random()*2);
      count = Math.min(count, unusedIdxs.length);
      var fresh = [];
      var lowerPool = 'abcdefghijklmnopqrstuvwxyz'.split('');
      var symPool = ['!','@','#','$','%','^','&','*','-','_','+','=','?','~','<','>'];
      var numPool = '0123456789'.split('');
      var upperPool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      for(var c=0;c<count;c++){
        var r=Math.random();
        if(r<0.3) fresh.push(upperPool[Math.floor(Math.random()*upperPool.length)]);
        else if(r<0.55) fresh.push(symPool[Math.floor(Math.random()*symPool.length)]);
        else if(r<0.75) fresh.push(numPool[Math.floor(Math.random()*numPool.length)]);
        else fresh.push(lowerPool[Math.floor(Math.random()*lowerPool.length)]);
      }
      // shuffle indices
      for(var s=unusedIdxs.length-1;s>0;s--){ var j=Math.floor(Math.random()*(s+1)); var t=unusedIdxs[s]; unusedIdxs[s]=unusedIdxs[j]; unusedIdxs[j]=t; }
      for(var k=0;k<count;k++){
        var idx = unusedIdxs[k];
        item.deck[idx] = fresh[k];
        // ensure availability stays true
        item._ppDeckAvailable[idx]=true;
      }
      item._ppShuffleUsed = true;
      item._ppSelectedDeckIdx = null;
      renderActivityItem();
    });
  }
}
function renderGenericItem(item){
  const picked = item.myAnswer;
  return '<div class="prompt">'+esc(item.prompt||'')+'</div>'
    + '<div class="options">' + (item.options||[]).map(opt=>{
        const sel = picked!=null && String(picked)===String(opt.id);
        return '<button type="button" class="option-btn'+(sel?' selected picked':'')+'" data-answer-opt="'+esc(opt.id)+'">'+esc(opt.text)+'</button>';
      }).join('') + '</div>' + renderCorrectFeedback(item);
}
const ACTIVITY_RENDERERS = {
  'fault-finding': renderFaultFinding,
  'myth-vs-fact': renderMythVsFact,
  'decision-room': renderDecisionRoom,
  'clue-quest': renderClueQuest,
  'pass-phrase': renderPassPhrase,
};

// --- Crossword compact ---
function cwKey(r,c){ return r+','+c; }
function cwBuildModel(data){
  cwRows = data.grid.rows;
  cwCols = data.grid.cols;
  cwWords = data.grid.placements.map((p,i)=> Object.assign({}, p, {index:i}));
  cwCells.clear();
  cwWords.forEach(w=>{
    for(let i=0;i<w.answer.length;i++){
      const r = w.direction==='down' ? w.row+i : w.row;
      const c = w.direction==='across' ? w.col+i : w.col;
      const k = cwKey(r,c);
      let cell = cwCells.get(k);
      if(!cell) cell = {row:r,col:c,solution:w.answer[i],across:null,down:null,number:null};
      cell[w.direction]=w.index;
      if(i===0) cell.number=w.number;
      cwCells.set(k, cell);
    }
  });
}
function cwRenderGrid(){
  // Fill available width per cell, but never shrink below a tappable floor. A wide grid's
  // plain 1fr tracks compress to an unusably small per-cell width on a narrow phone, and
  // minmax(...,1fr) alone doesn't help here: a block-level grid's "auto" width just fills its
  // parent, so fr tracks still get squeezed to fit rather than growing the box. Fixed px
  // tracks avoid that ambiguity - once the grid's true content width (cols * cellPx) exceeds
  // the wrap, .cw-grid-wrap's overflow:auto takes over with a horizontal scroll instead of
  // squeezing cells below CELL_MIN.
  const CELL_MIN = 32, GAP = 1;
  const wrapEl = els.cwGrid.parentElement;
  const availWidth = (wrapEl ? wrapEl.clientWidth - 16 : 280); // minus .cw-grid-wrap's 8px+8px padding
  const fitCell = Math.floor((availWidth - (cwCols - 1) * GAP) / cwCols);
  const cellPx = Math.max(CELL_MIN, fitCell);
  els.cwGrid.style.gridTemplateColumns = 'repeat('+cwCols+', '+cellPx+'px)';
  els.cwGrid.style.gridTemplateRows = 'repeat('+cwRows+', '+cellPx+'px)';
  els.cwGrid.style.width = (cwCols * cellPx + (cwCols - 1) * GAP) + 'px';
  els.cwGrid.innerHTML = '';
  for(let r=0;r<cwRows;r++){
    for(let c=0;c<cwCols;c++){
      const k = cwKey(r,c);
      const cell = cwCells.get(k);
      const el = document.createElement('div');
      el.className = 'cw-cell';
      if(!cell){
        el.classList.add('cw-block');
        el.setAttribute('aria-hidden','true');
        els.cwGrid.appendChild(el);
        continue;
      }
      if(cell.number){
        const num = document.createElement('span');
        num.className = 'cw-num';
        num.textContent = cell.number;
        el.appendChild(num);
      }
      const input = document.createElement('input');
      input.className = 'cw-input';
      input.maxLength = 1;
      input.autocomplete='off';
      input.spellcheck=false;
      input.dataset.row=String(r);
      input.dataset.col=String(c);
      el.appendChild(input);
      els.cwGrid.appendChild(el);
      cell.el = el;
      cell.input = input;
      // wire
      let reclick=false;
      input.addEventListener('mousedown', ()=>{ reclick = (cwCurrentRow===r && cwCurrentCol===c); });
      input.addEventListener('focus', ()=>{
        if(reclick){ const other = cwCurrentDir==='across'?'down':'across'; if(cell[other]!=null) cwCurrentDir=other; cwHighlight(); }
        else cwSelect(r,c, cwPendingDir);
        cwPendingDir=null;
      });
      input.addEventListener('click', ()=>{ reclick=false; });
      input.addEventListener('blur', ()=> scheduleCwProgress());
      input.addEventListener('input', ()=> scheduleCwProgress());
      input.addEventListener('keydown', (e)=> cwHandleKey(e, cell, input));
    }
  }
}
function cwHandleKey(e, cell, input){
  if(cwIsSubmitted){ e.preventDefault(); return; }
  if(cwRevealed){ e.preventDefault(); return; }
  if(/^[a-zA-Z]$/.test(e.key)){
    e.preventDefault();
    input.value = e.key.toUpperCase();
    clearCwMark(cell);
    // Live per-keystroke feedback: confirm correct immediately (green), but a wrong letter
    // stays neutral rather than turning red - mid-puzzle typing shouldn't read as a penalty,
    // only the explicit Check button marks wrong cells red.
    if(input.value === cell.solution) cell.el.classList.add('correct');
    const nxt = cwNeighbor(cell, cwCurrentDir, 1);
    if(nxt) cwFocus(nxt.row, nxt.col, cwCurrentDir);
    cwUpdateStatus();
    return;
  }
  switch(e.key){
    case 'Backspace':
      e.preventDefault();
      if(input.value){ input.value=''; clearCwMark(cell); }
      else { const prev=cwNeighbor(cell,cwCurrentDir,-1); if(prev){ prev.input.value=''; clearCwMark(prev); cwFocus(prev.row, prev.col, cwCurrentDir); } }
      cwUpdateStatus(); break;
    case 'Delete': e.preventDefault(); input.value=''; clearCwMark(cell); cwUpdateStatus(); break;
    case 'ArrowLeft': e.preventDefault(); cwMoveFree(cell.row,cell.col,0,-1,'across'); break;
    case 'ArrowRight': e.preventDefault(); cwMoveFree(cell.row,cell.col,0,1,'across'); break;
    case 'ArrowUp': e.preventDefault(); cwMoveFree(cell.row,cell.col,-1,0,'down'); break;
    case 'ArrowDown': e.preventDefault(); cwMoveFree(cell.row,cell.col,1,0,'down'); break;
    case 'Enter': case ' ': e.preventDefault(); { const other=cwCurrentDir==='across'?'down':'across'; if(cell[other]!=null) cwCurrentDir=other; cwHighlight(); } break;
  }
}
function cwMoveFree(r,c,dr,dc,dir){
  let nr=r+dr,nc=c+dc;
  while(nr>=0&&nr<cwRows&&nc>=0&&nc<cwCols){
    if(cwCells.has(cwKey(nr,nc))){ cwFocus(nr,nc,dir); return; }
    nr+=dr; nc+=dc;
  }
}
function cwNeighbor(cell,dir,step){
  const idx=cell[dir];
  if(idx==null) return null;
  const r=dir==='down'?cell.row+step:cell.row;
  const c=dir==='across'?cell.col+step:cell.col;
  const nxt=cwCells.get(cwKey(r,c));
  if(nxt && nxt[dir]===idx) return nxt;
  return null;
}
function cwFocus(r,c,dir){
  const cell=cwCells.get(cwKey(r,c));
  if(!cell) return;
  cwPendingDir=dir;
  // preventScroll: true - without it, focusing a cell that's off the visible edge of the
  // horizontally-scrollable grid (see cwRenderGrid) triggers the browser's own "scroll this
  // into view" behavior, which on mobile can yank the whole page/grid far out of position
  // (especially once the on-screen keyboard is also resizing the viewport). The grid's own
  // .cw-grid-wrap scroll container is already sized correctly - we don't want the browser's
  // default scroll-into-view fighting it on every keystroke's auto-advance-to-next-cell.
  cell.input.focus({preventScroll: true});
}
function cwSelect(r,c,forceDir){
  const cell=cwCells.get(cwKey(r,c));
  if(!cell) return;
  cwCurrentRow=r; cwCurrentCol=c;
  if(forceDir && cell[forceDir]!=null) cwCurrentDir=forceDir;
  else if(cell[cwCurrentDir]!=null){} else cwCurrentDir=cell.across!=null?'across':'down';
  cwHighlight();
}
function cwHighlight(){
  cwCells.forEach(cell=> cell.el.classList.remove('active-cell','active-word'));
  document.querySelectorAll('#cwAcross li.active, #cwDown li.active').forEach(li=> li.classList.remove('active'));
  const cell=cwCells.get(cwKey(cwCurrentRow,cwCurrentCol));
  if(!cell) return;
  cell.el.classList.add('active-cell');
  const idx=cell[cwCurrentDir];
  if(idx!=null){
    const w=cwWords[idx];
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const wc=cwCells.get(cwKey(r,c));
      if(wc) wc.el.classList.add('active-word');
    }
    const li=document.querySelector('.cw-clue-list li[data-index="'+idx+'"]');
    if(li){
      li.classList.add('active');
      // Only scroll the clue list to reveal the active clue when the active WORD actually
      // changes (tapped a different cell/clue, or crossed into a new word) - not on every
      // single keystroke's auto-advance to the next cell within the SAME word. cwHighlight
      // re-runs on every cell focus change (see cwSelect), so without this guard, typing a
      // multi-letter word scrolled the page toward the clue list after every letter - the
      // grid (and the still-correctly-focused input in it) would scroll off the visible
      // viewport, which reads exactly like "focus jumped to the hints list" even though
      // document.activeElement never actually left the grid.
      if(idx !== cwLastActiveWordIdx){
        li.scrollIntoView({block:'nearest'});
        cwLastActiveWordIdx = idx;
      }
    }
  } else {
    cwLastActiveWordIdx = null;
  }
}
function clearCwMark(cell){ cell.el.classList.remove('correct','incorrect'); }
function cwRenderClues(){
  const across=cwWords.filter(w=>w.direction==='across').sort((a,b)=>a.number-b.number);
  const down=cwWords.filter(w=>w.direction==='down').sort((a,b)=>a.number-b.number);
  const render=(list,target)=>{
    // Hint is opt-in per clue: a small button that reveals just the first letter as a text
    // line, never shown by default and never touching the grid - tapping it can't be mistaken
    // for auto-filling progress, it's purely a nudge.
    target.innerHTML = list.map(w=> '<li data-index="'+w.index+'"><span class="cw-clue-num">'+w.number+'.</span>'+esc(w.clue)
      + '<button type="button" class="cw-hint-btn" data-hint-idx="'+w.index+'"><i class="fa-solid fa-lightbulb"></i> Hint</button>'
      + '<span class="cw-hint-text hidden" data-hint-text-idx="'+w.index+'">Starts with "'+esc(w.answer[0])+'"</span></li>').join('');
    Array.from(target.children).forEach(li=>{
      li.addEventListener('click', ()=>{
        const w=cwWords[Number(li.dataset.index)];
        cwFocus(w.row,w.col,w.direction);
      });
    });
    target.querySelectorAll('.cw-hint-btn').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const idx = btn.dataset.hintIdx;
        const span = target.querySelector('[data-hint-text-idx="'+idx+'"]');
        if(span) span.classList.remove('hidden');
        btn.disabled = true;
      });
    });
  };
  render(across, els.cwAcross);
  render(down, els.cwDown);
}
function cwUpdateStatus(){
  if(cwRevealed) return;
  let filled=0;
  cwCells.forEach(cell=>{ if(cell.input && cell.input.value) filled++; });
  els.cwStatus.textContent = filled + ' of ' + cwCells.size + ' letters filled';
  scheduleCwProgress();
}
function cwCheck(){
  if(cwIsSubmitted) return;
  let allFilled=true, allCorrect=true;
  cwCells.forEach(cell=>{
    if(!cell.input.value){ allFilled=false; allCorrect=false; return; }
    if(cell.input.value===cell.solution){ cell.el.classList.add('correct'); cell.el.classList.remove('incorrect'); }
    else { cell.el.classList.add('incorrect'); cell.el.classList.remove('correct'); allCorrect=false; }
  });
  // mark clues solved
  cwWords.forEach(w=>{
    let solved=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || cell.input.value!==cell.solution){ solved=false; break; }
    }
    const li=document.querySelector('.cw-clue-list li[data-index="'+w.index+'"]');
    if(li) li.classList.toggle('solved', solved);
  });
  if(allFilled && allCorrect){
    els.cwStatus.textContent='Every word is in place - nice work.';
    cwShowWrapUp();
  } else {
    cwUpdateStatus();
  }
}
function cwShowWrapUp(){
  if(els.cwSolvedBanner) els.cwSolvedBanner.classList.remove('hidden');
  if(cwRememberText && els.cwRememberCard){
    els.cwRememberCardText.textContent = cwRememberText;
    els.cwRememberCard.classList.remove('hidden');
  }
}
function cwReveal(){
  cwRevealed=true;
  cwCells.forEach(cell=>{
    cell.input.value=cell.solution;
    cell.input.readOnly=true;
    cell.el.classList.remove('correct','incorrect');
    cell.el.classList.add('revealed');
  });
  document.querySelectorAll('.cw-clue-list li').forEach(li=> li.classList.add('solved'));
  els.cwStatus.textContent='Answers revealed';
  cwShowWrapUp();
  scheduleCwProgress();
  setTimeout(sendCwProgress, 200);
}
function computeCwProgress(){
  const total=cwWords.length||0;
  if(!total) return {filled:0,total:0,correct:0};
  let filled=0, correct=0;
  for(const w of cwWords){
    let all=true, allCorrect=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || !cell.input || !cell.input.value.trim()){ all=false; allCorrect=false; break; }
      if(cell.input.value.trim().toUpperCase() !== cell.solution) allCorrect=false;
    }
    if(all) filled++;
    // correct entries are those where every cell matches solution (implies filled)
    let ok=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || !cell.input || cell.input.value.trim().toUpperCase() !== cell.solution){ ok=false; break; }
    }
    if(ok) correct++;
  }
  return {filled,total,correct};
}
async function sendCwProgress(){
  if(cwIsSubmitted) return;
  if(!participantId || !ROOM_CODE) return;
  if(document.getElementById('crosswordScreen').classList.contains('hidden')) return;
  const {filled,total,correct}=computeCwProgress();
  if(cwLastSent && cwLastSent.filled===filled && cwLastSent.total===total && cwLastSent.correct===correct) return;
  cwLastSent={filled,total,correct};
  try{
    await fetch('/api/session/'+ROOM_CODE+'/crossword/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:participantId, filledCount:filled, totalCount:total, correctCount:correct})});
  }catch(e){}
}
function scheduleCwProgress(){
  if(cwIsSubmitted) return;
  if(!participantId) return;
  if(cwProgressTimer) clearTimeout(cwProgressTimer);
  cwProgressTimer=setTimeout(sendCwProgress, CW_DEBOUNCE);
}
async function ensureCrossword(){
  if(cwInitialized) return;
  cwInitialized = true;
  els.cwStatus.textContent='Loading grid...';
  try{
    const r=await fetch('/live-event/content/crossword.json',{cache:'no-store'});
    const data=await r.json();
    cwRememberText = data.rememberThis || '';
    cwBuildModel(data);
    if(els.cwClueCountBadge) els.cwClueCountBadge.textContent = 'Crossword · ' + cwWords.length + ' clues';
    cwRenderGrid();
    cwRenderClues();
    cwUpdateStatus();
    // wire check/reveal - console gates Reveal behind an explicit Yes/Cancel confirm since
    // it's irreversible; a native confirm() gives the phone the same one-tap-can't-undo-it
    // safeguard without needing a whole extra confirm-panel screen.
    els.cwCheck.addEventListener('click', cwCheck);
    els.cwReveal.addEventListener('click', ()=>{
      if(confirm('Reveal every answer? This ends the puzzle and cannot be undone.')) cwReveal();
    });
    scheduleCwProgress();
  }catch(e){
    els.cwStatus.textContent='Failed to load grid';
  }
}

// --- Control Catch: falling-bubble reflex game ---
// The server never referees reflex timing - same "client-only clock" precedent as clue-quest's
// 30s-per-riddle countdown (see cqManageTimer above): all spawn/fall/tap/score/lives logic runs
// entirely in this browser tab, and only a periodic snapshot is pinged to the server (for the
// admin's live progress panel + the post-game ranked summary), mirroring crossword's own
// ensureCrossword/scheduleCwProgress debounced-ping pattern one section up.
const CC_DURATION_MS = 90000;       // 90s round - extended from 75s to match the slower pace below
const CC_SPAWN_START_MS = 1800;     // spawn cadence at round start
const CC_SPAWN_MIN_MS = 900;        // spawn cadence floor once fully ramped up
const CC_FALL_START_MS = 6000;      // how long a bubble takes top-to-bottom at round start
const CC_FALL_MIN_MS = 3500;        // fall-duration floor once fully ramped up
const CC_DEBOUNCE = 2000;
const CC_RING_REMOVE_MS = 280;
// Decorative palette only (see console.css's .cc-c1..c6 + the comment above them) - picked at
// random per bubble, with zero relationship to bubble.good, so color never hints at the right
// answer. Pop-outcome color (green/red) is separate and handled entirely by CSS via the
// .cc-pop-good/.cc-pop-bad classes added in ccPopBubble below.
const CC_COLOR_CLASSES = ['cc-c1','cc-c2','cc-c3','cc-c4','cc-c5','cc-c6'];
// Matches console.css's cc-burst-good/cc-burst-bad animation durations (280ms/320ms) so the
// pop animation is visible before the element is removed from the DOM.
const CC_POP_REMOVE_MS = 340;
let ccInitialized = false;
let ccContent = null;
let ccBubbles = [];       // [{el, bubble}] currently on screen
let ccScore = 0;          // good bubbles popped - this participant's own score, never synced from anyone else
let ccBadPops = 0;
let ccLives = 3;
let ccGameOver = false;
let ccStartTs = 0;
let ccSpawnTimer = null;
let ccHudTimer = null;
let ccProgressTimer = null;
let ccLastSentProgress = null;
let ccFinalResult = null; // {score, badPops, livesLeft, survivedMs} - "your result" only, see showSubmittedFor
// No-repeat spawning: ids of bubbles already popped GOOD (and thus scored) this round only - a
// bad pop or an untouched/fallen bubble does not retire its term, so it can still recur. Only
// 13 of the 28 terms are "good", so if untouched/bad terms retired too, the pool would run dry
// well before a 90s round ends. Reset fresh every ccStartRound() call (see below) so a new
// round always has the full 28-term pool again - purely client-side per participant, same as
// the rest of this module's state, so this never needs to be synced or reset server-side.
let ccScoredIds = new Set();

// --- Audio: background music + SFX, scoped entirely to this module. Off by default; a
// participant opts in with the mute button. Created/resumed only from a genuine tap (the
// intro Start button - see the control-catch branch in dismissParticipantIntro - or the mute
// button itself), never on page load or a poll tick, to respect mobile autoplay restrictions.
// Nothing here is shared with any other module's own audio (clue-quest/decision-room's tick
// sounds each have their own separate AudioContext in their own scope) and the music stops the
// instant the round ends or the module is torn down (see ccStopGame/ccEndGame).
let ccAudioCtx = null;
let ccMusicGain = null;
let ccSfxGain = null;
let ccMusicTimer = null;
let ccMusicStep = 0;
let ccSoundOn = false;
try{ ccSoundOn = localStorage.getItem('cc_sound_on') === '1'; }catch(e){}
const CC_MUSIC_NOTES = [392.00, 440.00, 523.25, 659.25, 523.25, 440.00, 392.00, 329.63];

function ccEnsureAudioCtx(){
  if(ccAudioCtx){ if(ccAudioCtx.state==='suspended') ccAudioCtx.resume(); return; }
  try{
    ccAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ccMusicGain = ccAudioCtx.createGain();
    ccMusicGain.gain.value = ccSoundOn ? 0.16 : 0;
    ccMusicGain.connect(ccAudioCtx.destination);
    ccSfxGain = ccAudioCtx.createGain();
    ccSfxGain.gain.value = ccSoundOn ? 0.4 : 0;
    ccSfxGain.connect(ccAudioCtx.destination);
  }catch(e){ ccAudioCtx = null; }
}
function ccMusicTick(){
  if(!ccAudioCtx) return;
  const freq = CC_MUSIC_NOTES[ccMusicStep % CC_MUSIC_NOTES.length];
  ccMusicStep++;
  const t = ccAudioCtx.currentTime;
  const osc = ccAudioCtx.createOscillator();
  const g = ccAudioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t+0.06);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.4);
  osc.connect(g).connect(ccMusicGain);
  osc.start(t);
  osc.stop(t+0.42);
}
function ccStartMusic(){
  if(ccMusicTimer || !ccAudioCtx) return;
  ccMusicTick();
  ccMusicTimer = setInterval(ccMusicTick, 430);
}
function ccStopMusic(){
  if(ccMusicTimer){ clearInterval(ccMusicTimer); ccMusicTimer = null; }
}
function ccPlayPopSound(good){
  if(!ccAudioCtx) return;
  const t = ccAudioCtx.currentTime;
  const osc = ccAudioCtx.createOscillator();
  const g = ccAudioCtx.createGain();
  osc.connect(g).connect(ccSfxGain);
  if(good){
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.exponentialRampToValueAtTime(1180, t+0.09);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+0.16);
    osc.start(t);
    osc.stop(t+0.18);
  } else {
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(105, t+0.16);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+0.2);
    osc.start(t);
    osc.stop(t+0.22);
  }
}
function ccUpdateMuteBtn(){
  if(!els.ccMuteBtn) return;
  els.ccMuteBtn.classList.toggle('cc-sound-on', ccSoundOn);
  els.ccMuteBtn.innerHTML = ccSoundOn ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
  els.ccMuteBtn.setAttribute('aria-label', ccSoundOn ? 'Mute sound' : 'Unmute sound');
}
function ccSetSoundOn(on){
  ccSoundOn = on;
  try{ localStorage.setItem('cc_sound_on', on ? '1' : '0'); }catch(e){}
  if(ccMusicGain) ccMusicGain.gain.value = on ? 0.16 : 0;
  if(ccSfxGain) ccSfxGain.gain.value = on ? 0.4 : 0;
  ccUpdateMuteBtn();
}
if(els.ccMuteBtn){
  ccUpdateMuteBtn();
  els.ccMuteBtn.addEventListener('click', ()=>{ ccEnsureAudioCtx(); ccSetSoundOn(!ccSoundOn); });
}

function ccElapsedMs(){ return ccStartTs ? (Date.now() - ccStartTs) : 0; }
function ccRampProgress(elapsed){ return Math.max(0, Math.min(1, elapsed / CC_DURATION_MS)); }
function ccSpawnIntervalFor(elapsed){ const t = ccRampProgress(elapsed); return CC_SPAWN_START_MS - t * (CC_SPAWN_START_MS - CC_SPAWN_MIN_MS); }
function ccFallDurationFor(elapsed){ const t = ccRampProgress(elapsed); return CC_FALL_START_MS - t * (CC_FALL_START_MS - CC_FALL_MIN_MS); }

function ccFormatClock(ms){
  const s = Math.max(0, ms);
  const mins = Math.floor(s/60000), secs = Math.floor((s%60000)/1000);
  return mins + ':' + String(secs).padStart(2,'0');
}

function ccUpdateHud(){
  if(els.ccScoreVal) els.ccScoreVal.textContent = String(ccScore);
  if(els.ccLivesVal){
    els.ccLivesVal.textContent = '❤'.repeat(ccLives) + '🖤'.repeat(Math.max(0, 3-ccLives));
    els.ccLivesVal.classList.toggle('cc-lives-low', ccLives<=1);
  }
  if(els.ccTimeVal) els.ccTimeVal.textContent = ccFormatClock(Math.max(0, CC_DURATION_MS - ccElapsedMs()));
}

async function sendCcProgress(immediate){
  if(ccIsSubmitted) return;
  if(!participantId || !ROOM_CODE) return;
  const snapshot = {score: ccScore, badPops: ccBadPops, livesLeft: ccLives, gameOver: ccGameOver};
  if(!immediate && ccLastSentProgress
     && ccLastSentProgress.score===snapshot.score
     && ccLastSentProgress.badPops===snapshot.badPops
     && ccLastSentProgress.livesLeft===snapshot.livesLeft
     && ccLastSentProgress.gameOver===snapshot.gameOver) return;
  ccLastSentProgress = snapshot;
  try{
    await fetch('/api/session/'+ROOM_CODE+'/control-catch/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({participantId:participantId}, snapshot))});
  }catch(e){}
}
function scheduleCcProgress(){
  if(ccIsSubmitted) return;
  if(!participantId) return;
  if(ccProgressTimer) clearTimeout(ccProgressTimer);
  ccProgressTimer = setTimeout(()=>sendCcProgress(false), CC_DEBOUNCE);
}

// A tapped bubble freezes at its current on-screen position (read via getBoundingClientRect,
// not left at whatever CSS-transition midpoint it happened to be at) before the pop animation
// plays - otherwise cancelling the falling `top` transition mid-flight can make the pop
// animation itself look like it jumps or stutters.
function ccFreezeBubbleAt(el){
  const rect = el.getBoundingClientRect();
  const arenaRect = els.ccArena.getBoundingClientRect();
  el.style.transition = 'none';
  el.style.top = (rect.top - arenaRect.top) + 'px';
}

// Small ring burst at the bubble's own center - see console.css's .cc-burst-ring.
function ccSpawnBurstRing(el, good){
  if(!els.ccArena) return;
  const rect = el.getBoundingClientRect();
  const arenaRect = els.ccArena.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'cc-burst-ring ' + (good ? 'cc-ring-good' : 'cc-ring-bad');
  ring.style.left = (rect.left - arenaRect.left + rect.width/2) + 'px';
  ring.style.top = (rect.top - arenaRect.top + rect.height/2) + 'px';
  els.ccArena.appendChild(ring);
  setTimeout(()=>ring.remove(), CC_RING_REMOVE_MS);
}

function ccPopBubble(el, bubble){
  if(ccGameOver) return;
  if(el.dataset.resolved==='1') return;
  el.dataset.resolved = '1';
  ccFreezeBubbleAt(el);
  void el.offsetHeight; // force the transition:none above to apply before the keyframe animation below starts
  ccSpawnBurstRing(el, bubble.good);
  ccPlayPopSound(bubble.good);
  // Outcome color/animation is CSS-driven (see console.css's cc-burst-good/cc-burst-bad)  -
  // no inline transform/opacity here, just add the class and let the keyframes take over.
  if(bubble.good){
    ccScore++;
    ccScoredIds.add(bubble.id);
    el.classList.add('cc-pop-good');
  } else {
    ccBadPops++;
    ccLives = Math.max(0, ccLives-1);
    el.classList.add('cc-pop-bad');
  }
  ccUpdateHud();
  scheduleCcProgress();
  setTimeout(()=>{ el.remove(); ccBubbles = ccBubbles.filter(b=>b.el!==el); }, CC_POP_REMOVE_MS);
  if(ccLives<=0) ccEndGame();
}

// Draws from the not-yet-scored pool first so a term already caught correctly this round
// doesn't cycle back through; falls back to the full pool only if every term has been scored
// (28 terms / 13 good ones and a ~90s round comfortably never hits this in practice - see the
// ccScoredIds declaration above).
function ccPickBubble(pool){
  const remaining = pool.filter(b => !ccScoredIds.has(b.id));
  return remaining.length ? remaining : pool;
}

function ccSpawnBubble(){
  if(ccGameOver || !els.ccArena) return;
  const pool = (ccContent && ccContent.bubbles) || [];
  if(!pool.length) return;
  const drawFrom = ccPickBubble(pool);
  const bubble = drawFrom[Math.floor(Math.random()*drawFrom.length)];
  const el = document.createElement('button');
  el.type = 'button';
  // Decorative color is random and independent of bubble.good - see CC_COLOR_CLASSES above.
  const colorClass = CC_COLOR_CLASSES[Math.floor(Math.random()*CC_COLOR_CLASSES.length)];
  el.className = 'cc-bubble ' + colorClass;
  el.textContent = bubble.text;
  el.style.left = (12 + Math.random()*76) + '%';
  el.style.top = '-15%';
  el.dataset.resolved = '0';
  els.ccArena.appendChild(el);
  const fallMs = ccFallDurationFor(ccElapsedMs());
  el.addEventListener('click', ()=> ccPopBubble(el, bubble));
  el.addEventListener('transitionend', (e)=>{
    if(e.propertyName!=='top') return;
    if(el.dataset.resolved==='1') return;
    // Reached the bottom untouched - bad bubbles SHOULD pass (dodging by inaction is correct,
    // no penalty); good bubbles just missed are also not penalized, only rewarded when popped.
    el.dataset.resolved = '1';
    el.remove();
    ccBubbles = ccBubbles.filter(b=>b.el!==el);
  });
  // Double rAF: let the browser paint the initial top:-15% first, then apply the transition  - 
  // changing transitionDuration and top in the same frame the element was created would collapse
  // the animation into an instant jump instead of a real fall.
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      el.style.transitionDuration = fallMs + 'ms';
      el.style.top = '104%';
    });
  });
  ccBubbles.push({el, bubble});
}

function ccSpawnLoop(){
  if(ccGameOver) return;
  ccSpawnBubble();
  const elapsed = ccElapsedMs();
  if(elapsed >= CC_DURATION_MS){ ccEndGame(); return; }
  ccSpawnTimer = setTimeout(ccSpawnLoop, ccSpawnIntervalFor(elapsed));
}

function ccEndGame(){
  if(ccGameOver) return;
  ccGameOver = true;
  if(ccSpawnTimer) clearTimeout(ccSpawnTimer);
  if(ccHudTimer) clearInterval(ccHudTimer);
  ccStopMusic();
  // Freeze whatever's still on screen in place rather than yanking it away mid-fall - reads as
  // "time's up", not a glitch - and disable further taps (game is over, no more scoring).
  ccBubbles.forEach(({el})=>{
    if(el.dataset.resolved==='1') return;
    ccFreezeBubbleAt(el);
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.4';
  });
  ccUpdateHud();
  const survivedMs = Math.min(ccElapsedMs(), CC_DURATION_MS);
  ccFinalResult = {score: ccScore, badPops: ccBadPops, livesLeft: ccLives, survivedMs: survivedMs};
  try{ localStorage.setItem('ccResult_'+ROOM_CODE, JSON.stringify(ccFinalResult)); }catch(e){}
  if(els.ccGameOverStats){
    els.ccGameOverStats.textContent = ccScore + ' good caught · ' + ccBadPops + ' bad popped · ' + ccLives + '/3 lives left · survived ' + ccFormatClock(survivedMs);
  }
  if(els.ccGameOverWrap) els.ccGameOverWrap.classList.remove('hidden');
  if(els.ccIntroHint) els.ccIntroHint.classList.add('hidden');
  sendCcProgress(true);
}

async function doCcSubmit(){
  if(ccIsSubmitted) return;
  const module = 'control-catch';
  if(!participantId) return;
  if(els.ccSubmitBtn) els.ccSubmitBtn.disabled = true;
  if(els.ccSubmitMsg) els.ccSubmitMsg.textContent = 'Submitting...';
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, module: module})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'Submit failed');
    ccIsSubmitted = true;
    mySubmission = {isSubmitted: true, submittedAt: j.submittedAt, module: module};
    showSubmittedFor(module, j.submittedAt);
    if(els.ccSubmitMsg) els.ccSubmitMsg.textContent = '';
  }catch(e){
    if(els.ccSubmitMsg) els.ccSubmitMsg.textContent = 'Submit failed: ' + (e.message||'');
    if(els.ccSubmitBtn) els.ccSubmitBtn.disabled = false;
  }
}

function ccStopGame(){
  if(ccSpawnTimer) clearTimeout(ccSpawnTimer);
  if(ccHudTimer) clearInterval(ccHudTimer);
  if(ccProgressTimer) clearTimeout(ccProgressTimer);
  ccStopMusic();
  ccSpawnTimer = null; ccHudTimer = null; ccProgressTimer = null;
  if(els.ccArena) els.ccArena.innerHTML = '';
  ccBubbles = [];
  // Reset so relaunching control-catch in the same room (no page reload) starts a fresh round
  // next time ensureControlCatch() runs, instead of silently no-op'ing like crossword's
  // cwInitialized (which never resets) would.
  ccInitialized = false;
}

async function ensureControlCatch(){
  if(ccInitialized) return;
  ccInitialized = true;
  ccScore = 0; ccBadPops = 0; ccLives = 3; ccGameOver = false; ccFinalResult = null;
  ccBubbles = []; ccLastSentProgress = null; ccScoredIds = new Set();
  if(els.ccGameOverWrap) els.ccGameOverWrap.classList.add('hidden');
  if(els.ccIntroHint) els.ccIntroHint.classList.remove('hidden');
  if(els.ccArena) els.ccArena.innerHTML = '';
  ccUpdateHud();
  try{
    const r = await fetch('/live-event/content/control-catch.json', {cache:'no-store'});
    ccContent = await r.json();
  }catch(e){
    ccContent = {bubbles: []};
  }
  ccStartTs = Date.now();
  ccSpawnTimer = setTimeout(ccSpawnLoop, 400);
  ccHudTimer = setInterval(()=>{
    if(ccGameOver) return;
    ccUpdateHud();
    if(ccElapsedMs() >= CC_DURATION_MS) ccEndGame();
  }, 300);
  // Defensive: the primary path (dismissParticipantIntro's control-catch branch) already
  // creates the AudioContext synchronously inside the Start tap before calling this function,
  // so this is normally a no-op re-check - see that branch for why audio must be anchored
  // there, not here, to respect mobile autoplay restrictions.
  ccEnsureAudioCtx();
  ccStartMusic();
}

// --- State polling - whole-activity flow (lobby/running/complete) ---
async function fetchState(){
  const mySeq = ++fetchSeq;
  try{
    const r=await fetch('/api/session/' + ROOM_CODE + '/state?participantId=' + encodeURIComponent(participantId||''), {cache:'no-store'});
    if(mySeq !== fetchSeq) return; // a newer poll started while this one was in flight - stale, discard
    if(r.status===404){
      // Covers the brief window right after a server restart where the process is back up
      // (persisted sessions reloading, or this poll landing before that finishes) but the
      // room isn't resolvable yet - retry a few times with a calm indicator before concluding
      // the room is genuinely gone, instead of dead-ending on the very first 404.
      notFoundCount++;
      if(notFoundCount<=NOT_FOUND_RETRY_LIMIT){
        els.reconnectBanner.classList.remove('hidden');
        return;
      }
      showScreen('error');
      els.errorMsg.textContent = 'This session has ended or the lab code is wrong. Please check with the facilitator or ask for a new QR.';
      stopPolling();
      return;
    }
    if(!r.ok){
      const j=await r.json().catch(()=>({}));
      throw new Error(j.error || 'State fetch failed');
    }
    const s=await r.json();
    notFoundCount=0;
    retryCount=0;
    els.reconnectBanner.classList.add('hidden');
    updateHeaderCount(s.participantCount||0);
    const curMod = s.activeModule || null;
    const state = s.state || null;
    const displayName = s.displayName || curMod || ' - ';

    // No module yet - waiting for host to pick
    if(!curMod || !state){
      actModuleLoaded = null; const _as=document.getElementById('activityScreen'); if(_as) delete _as.dataset.module; // so relaunching any module later re-initializes the activity
      ccStopGame();
      showScreen('waiting');
      els.waitingModule.textContent = 'No active activity';
      document.getElementById('waitingSub').textContent = "You're in. Waiting for the facilitator to pick an activity.";
      els.waitingNames.innerHTML = (s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:var(--fs-badge);color:#94a3b8">Share the room code to invite others</span>';
      return;
    }
    // Lobby - module chosen but not yet started, show waiting for start with module name
    if(state==='lobby'){
      actModuleLoaded = null; const _as2=document.getElementById('activityScreen'); if(_as2) delete _as2.dataset.module; // clears the PREVIOUS activity's local state before Start
      ccStopGame();
      showScreen('waiting');
      els.waitingModule.textContent = displayName + ' - lobby';
      document.getElementById('waitingSub').textContent = "You're in - waiting for the facilitator to start " + displayName;
      // Live joined count explicitly tied to chosen module
      els.waitingNames.innerHTML = '<div style="font-size:var(--fs-badge);color:#0c4a6e;font-weight:700;margin-bottom:6px">' + esc(displayName) + ' - ' + (s.totalItems||0) + ' items</div><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' + ((s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:var(--fs-badge);color:#94a3b8">No one yet - share QR</span>') + "</div><div style=\"margin-top:8px;font-family:'Space Mono',monospace;font-size:var(--fs-badge);color:#64748b\">" + (s.participantCount||0) + ' joined - waiting for Start</div>';
      return;
    }
    // Capture per-participant submission status + rememberThis for submitted confirmation
    lastRememberThis = s.rememberThis || null;
    mySubmission = s.mySubmission || null;
    actIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && MC_MODULES.includes(mySubmission.module) && mySubmission.module===curMod);
    cwIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && mySubmission.module==='crossword' && curMod==='crossword');
    ccIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && mySubmission.module==='control-catch' && curMod==='control-catch');
    // If already submitted for this running module, show locked confirmation (distinct from generic complete)
    // - unless participant tapped Review, in which case keep them on the read-only item view with facts.
    if(state==='running' && mySubmission && mySubmission.isSubmitted && mySubmission.module===curMod && !isReviewingAfterSubmit){
      showSubmittedFor(curMod, mySubmission.submittedAt);
      // Ensure crossword grid is locked if it's the crossword module
      if(curMod==='crossword'){
        actModuleLoaded = null; const _as3=document.getElementById('activityScreen'); if(_as3) delete _as3.dataset.module;
        // ensure grid exists then lock
        ensureCrossword();
        setTimeout(()=>{ cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; }); updateCwSubmitVisibility(); }, 300);
      }
      if(curMod==='control-catch'){
        actModuleLoaded = null; const _as3b=document.getElementById('activityScreen'); if(_as3b) delete _as3b.dataset.module;
        ccStopGame();
      }
      return;
    }
    // Running - crossword's own dedicated grid, or the self-paced full-sequence activity
    // Flow parity with console: intro/whyThisMatters before items (console le-intro-screen)
    if(state==='running'){
      if(curMod==='crossword'){
        if(showParticipantIntro(curMod, s.whyThisMatters, s.policyStatement)) return;
        actModuleLoaded = null; const _as4=document.getElementById('activityScreen'); if(_as4) delete _as4.dataset.module;
        showScreen('crossword');
        ensureCrossword();
        // Update submit visibility after grid ensured; handle review mode
        setTimeout(()=>{
          updateCwSubmitVisibility();
          if(isReviewingAfterSubmit && cwIsSubmitted){
            if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.remove('hidden');
            if(els.cwSubmitWrap) els.cwSubmitWrap.classList.add('hidden');
            cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
          } else {
            if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.add('hidden');
          }
        }, 400);
        return;
      }
      if(curMod==='control-catch'){
        if(showParticipantIntro(curMod, s.whyThisMatters, s.policyStatement)) return;
        actModuleLoaded = null; const _as4b=document.getElementById('activityScreen'); if(_as4b) delete _as4b.dataset.module;
        showScreen('control-catch');
        ensureControlCatch();
        return;
      }
      if(MC_MODULES.includes(curMod)){
        const items = s.items || [];
        if(!items.length){
          showScreen('waiting');
          els.waitingModule.textContent = displayName + ' - running';
          document.getElementById('waitingSub').textContent = 'Running ' + displayName + ' - no items to show.';
          return;
        }
        if(showParticipantIntro(curMod, s.whyThisMatters, s.policyStatement)) return;
        showScreen('activity');
        // Review mode: keep activity visible with facts, hide Submit, show Back to Confirmation
        if(isReviewingAfterSubmit && actIsSubmitted){
          if(els.reviewBackWrap) els.reviewBackWrap.classList.remove('hidden');
          if(els.actSubmitWrap) els.actSubmitWrap.classList.add('hidden');
        } else {
          if(els.reviewBackWrap) els.reviewBackWrap.classList.add('hidden');
        }
        // Only (re)initialize on an actual module change - a poll tick for the SAME module
        // must never re-run this, or it would reset the participant's own Prev/Next position
        // and interrupt any in-progress tap (see initActivity's own comment).
        if(actModuleLoaded !== curMod){
          initActivity(curMod, items);
        } else {
          // Same module - but items may have updated myAnswer/myBuild from server (e.g. after refresh)
          // Sync local actItems with fresh server items to keep submit visibility accurate,
          // without resetting actIndex. Also propagate fact (identification+recommendation) now visible after Submit.
          if(items.length === actItems.length){
            for(let i=0;i<items.length;i++){
              // Preserve local answer if server is stale (race: tap just happened,
              // poll that was already in flight still has null). Don't clobber a
              // locally-set myAnswer with a stale null, otherwise Prev/Next
              // navigation appears to lose the answer and dots flicker back to
              // unanswered, and isActivityAllAnswered would incorrectly fail.
              if(items[i].myAnswer != null) actItems[i].myAnswer = items[i].myAnswer;
              if(items[i].myAnswerCorrect != null) actItems[i].myAnswerCorrect = items[i].myAnswerCorrect;
              if(items[i].correctOptionId != null) actItems[i].correctOptionId = items[i].correctOptionId;
              if(items[i].myBuild != null) actItems[i].myBuild = items[i].myBuild;
              if(items[i].fact != null) actItems[i].fact = items[i].fact;
              if(items[i].whatIsWrong != null) actItems[i].whatIsWrong = items[i].whatIsWrong;
              if(items[i].detail != null) actItems[i].detail = items[i].detail;
              if(items[i].myOutcome != null) actItems[i].myOutcome = items[i].myOutcome;
              if(items[i].myFeedback != null) actItems[i].myFeedback = items[i].myFeedback;
              if(items[i].myDebrief != null) actItems[i].myDebrief = items[i].myDebrief;
              if(items[i].revealed != null) actItems[i].revealed = items[i].revealed;
            }
            // Re-render current item so fact detail appears in review mode
            if(isReviewingAfterSubmit && actIsSubmitted) renderActivityItem();
            else updateActivitySubmitVisibility();
          }
        }
        return;
      }
    }
    // Complete - same room stays, waiting for next pick
    if(state==='complete'){
      actModuleLoaded = null; const _as5=document.getElementById('activityScreen'); if(_as5) delete _as5.dataset.module;
      ccStopGame();
      showScreen('complete');
      if(els.completeModule) els.completeModule.textContent = displayName;
      return;
    }
    // Idle - host has returned to the picker after completion, next activity not chosen yet.
    // Same lobby-style "waiting for host" message as the no-module-yet case, but distinct
    // from it so the room/activity history isn't implied to be reset.
    if(state==='idle'){
      actModuleLoaded = null; const _as6=document.getElementById('activityScreen'); if(_as6) delete _as6.dataset.module;
      ccStopGame();
      showScreen('waiting');
      els.waitingModule.textContent = 'Choosing next activity';
      document.getElementById('waitingSub').textContent = "You're in - waiting for the facilitator to choose the next activity.";
      els.waitingNames.innerHTML = (s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:var(--fs-badge);color:#94a3b8">Share the room code to invite others</span>';
      return;
    }
    // Fallback
    showScreen('waiting');
    els.waitingModule.textContent = displayName;
    document.getElementById('waitingSub').textContent = 'Waiting...';
  }catch(e){
    if(mySeq !== fetchSeq) return;
    // Network-level failures (offline, DNS, etc.) - 404 is handled above and never reaches here.
    retryCount++;
    if(retryCount>=2) els.reconnectBanner.classList.remove('hidden');
  }
}
function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  fetchState();
  pollTimer = setInterval(fetchState, 1500);
}
function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

// Init: resume or join
(function init(){
  if(participantId && participantName){
    // Resumed session (survives refresh/sleep)
    showScreen('waiting');
    startPolling();
  }else{
    showScreen('join');
    els.nameInput.focus();
  }
  els.joinBtn.addEventListener('click', doJoin);
  els.nameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doJoin(); });
  els.retryBtn.addEventListener('click', ()=>{
    if(participantId) { startPolling(); showScreen('waiting'); }
    else showScreen('join');
    els.errorScreen.classList.add('hidden');
  });
})();
