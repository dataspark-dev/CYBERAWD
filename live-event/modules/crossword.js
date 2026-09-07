/* Cybersecurity Crossword — vocabulary reinforcement, room-paced.
   Grid layout is precomputed at build time (content/crossword.json);
   this file only renders it and handles fill-in-the-grid interaction.
   Self-contained: no teams, no scoring, no timer pressure to "win". */
(function () {
  let words = [];               // [{ index, answer, clue, row, col, direction, number }]
  let cells = new Map();        // "r,c" -> { row, col, solution, number, across, down, el, input }
  let rows = 0, cols = 0;
  let rememberThisText = '';
  let introDismissed = false;
  let currentRow = -1, currentCol = -1, currentDirection = 'across';
  let pendingFocusDirection = null;
  let revealed = false;

  // --- Phone-synced lighter sync (additive): debounced progress ping ---
  // When opened via join flow, room code + participantId are in URL/localStorage.
  // Standalone (no participantId) → no network calls, original behavior unchanged.
  let crosswordSyncRoomCode = null;
  let crosswordSyncParticipantId = null;
  let crosswordSyncEnabled = false;
  let crosswordProgressTimer = null;
  let crosswordLastSent = null;
  const CROSSWORD_SYNC_DEBOUNCE_MS = 3500;

  function detectCrosswordSync() {
    try {
      const params = new URLSearchParams(location.search);
      let code = params.get('code') || params.get('room') || params.get('roomCode') || '';
      code = code ? code.trim().toUpperCase() : '';
      if (code) {
        let pid = localStorage.getItem('participantId_' + code) || localStorage.getItem('participantId_' + code.toLowerCase());
        if (pid) return { roomCode: code, participantId: pid };
        // also try generic
        const gPid = localStorage.getItem('participantId');
        if (gPid) return { roomCode: code, participantId: gPid };
      }
      // Scan for any participantId_* (join page stores per-code)
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('participantId_')) {
          const c = key.slice('participantId_'.length).toUpperCase();
          const val = localStorage.getItem(key);
          if (val && c) return { roomCode: c, participantId: val };
        }
      }
      const genericPid = localStorage.getItem('participantId') || sessionStorage.getItem('participantId');
      const genericCode = localStorage.getItem('currentRoomCode') || sessionStorage.getItem('currentRoomCode') || localStorage.getItem('roomCode');
      if (genericPid && genericCode) return { roomCode: String(genericCode).toUpperCase(), participantId: genericPid };
    } catch (e) {}
    return { roomCode: null, participantId: null };
  }

  function computeCrosswordProgress() {
    const total = words.length || 0;
    if (!total) return { filled: 0, total: 0, correct: 0 };
    let filled = 0, correct = 0;
    for (const w of words) {
      let allFilled = true;
      let allCorrect = true;
      for (let i = 0; i < w.answer.length; i++) {
        const r = w.direction === 'down' ? w.row + i : w.row;
        const c = w.direction === 'across' ? w.col + i : w.col;
        const cell = cells.get(cellKey(r, c));
        if (!cell || !cell.input || !cell.input.value.trim()) { allFilled = false; allCorrect = false; break; }
        if (cell.input.value.trim().toUpperCase() !== cell.solution) allCorrect = false;
      }
      if (allFilled) filled++;
      if (allFilled && allCorrect) correct++;
      else if (allCorrect) correct++; // already ensures filled, but keep for safety
    }
    // De-dupe: correct already implies filled, so recount correctly
    // Recompute correct as words where every cell matches solution (regardless of filled? same)
    let correct2 = 0;
    for (const w of words) {
      let ok = true;
      for (let i = 0; i < w.answer.length; i++) {
        const r = w.direction === 'down' ? w.row + i : w.row;
        const c = w.direction === 'across' ? w.col + i : w.col;
        const cell = cells.get(cellKey(r, c));
        if (!cell || !cell.input || cell.input.value.trim().toUpperCase() !== cell.solution) { ok = false; break; }
      }
      if (ok) correct2++;
    }
    return { filled, total, correct: correct2 };
  }

  async function sendCrosswordProgress() {
    if (!crosswordSyncEnabled || !crosswordSyncRoomCode || !crosswordSyncParticipantId) return;
    const { filled, total, correct } = computeCrosswordProgress();
    if (crosswordLastSent && crosswordLastSent.filled === filled && crosswordLastSent.total === total && crosswordLastSent.correct === correct) return;
    crosswordLastSent = { filled, total, correct };
    try {
      await fetch('/api/session/' + encodeURIComponent(crosswordSyncRoomCode) + '/crossword/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: crosswordSyncParticipantId, filledCount: filled, totalCount: total, correctCount: correct }),
      });
    } catch (e) { /* offline — ignore */ }
  }

  function scheduleCrosswordProgress() {
    if (!crosswordSyncEnabled) return;
    if (crosswordProgressTimer) clearTimeout(crosswordProgressTimer);
    crosswordProgressTimer = setTimeout(sendCrosswordProgress, CROSSWORD_SYNC_DEBOUNCE_MS);
  }

  const els = {
    introScreen: document.getElementById('introScreen'),
    introText: document.getElementById('introText'),
    introStartBtn: document.getElementById('introStartBtn'),
    activityBody: document.getElementById('activityBody'),
    grid: document.getElementById('cwGrid'),
    acrossList: document.getElementById('acrossList'),
    downList: document.getElementById('downList'),
    status: document.getElementById('cwStatus'),
    checkBtn: document.getElementById('checkBtn'),
    revealBtn: document.getElementById('revealBtn'),
    revealConfirm: document.getElementById('revealConfirm'),
    revealConfirmYes: document.getElementById('revealConfirmYes'),
    revealConfirmNo: document.getElementById('revealConfirmNo'),
    rememberCard: document.getElementById('rememberCard'),
    rememberText: document.getElementById('rememberText'),
    wrapRow: document.getElementById('wrapRow')
  };

  function cellKey(r, c) { return r + ',' + c; }

  function buildModel(data) {
    rows = data.grid.rows;
    cols = data.grid.cols;
    words = data.grid.placements.map((p, i) => ({ ...p, index: i }));

    words.forEach((w) => {
      for (let i = 0; i < w.answer.length; i++) {
        const r = w.direction === 'down' ? w.row + i : w.row;
        const c = w.direction === 'across' ? w.col + i : w.col;
        const key = cellKey(r, c);
        let cell = cells.get(key);
        if (!cell) {
          cell = { row: r, col: c, solution: w.answer[i], across: null, down: null, number: null };
          cells.set(key, cell);
        }
        cell[w.direction] = w.index;
        if (i === 0) cell.number = w.number;
      }
    });
  }

  function renderGrid() {
    els.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    els.grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    els.grid.innerHTML = '';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = cellKey(r, c);
        const cell = cells.get(key);
        const cellEl = document.createElement('div');
        cellEl.className = 'cw-cell';

        if (!cell) {
          cellEl.classList.add('cw-block');
          cellEl.setAttribute('aria-hidden', 'true');
          els.grid.appendChild(cellEl);
          continue;
        }

        if (cell.number) {
          const num = document.createElement('span');
          num.className = 'cw-num';
          num.textContent = cell.number;
          cellEl.appendChild(num);
        }

        const input = document.createElement('input');
        input.className = 'cw-input';
        input.maxLength = 1;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.inputMode = 'text';
        input.dataset.row = String(r);
        input.dataset.col = String(c);
        cellEl.appendChild(input);
        els.grid.appendChild(cellEl);

        cell.el = cellEl;
        cell.input = input;
        wireCellEvents(cell, input);
      }
    }
  }

  function wireCellEvents(cell, input) {
    let reclick = false;

    input.addEventListener('mousedown', () => {
      reclick = (currentRow === cell.row && currentCol === cell.col);
    });

    input.addEventListener('focus', () => {
      if (reclick) {
        toggleDirection(cell);
      } else {
        selectCell(cell.row, cell.col, pendingFocusDirection);
      }
      pendingFocusDirection = null;
    });

    input.addEventListener('click', () => {
      reclick = false;
    });

    input.addEventListener('blur', () => scheduleCrosswordProgress());
    input.addEventListener('input', () => scheduleCrosswordProgress());

    input.addEventListener('keydown', (e) => handleKeydown(e, cell, input));
  }

  function handleKeydown(e, cell, input) {
    if (revealed) { e.preventDefault(); return; }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      input.value = e.key.toUpperCase();
      clearMark(cell);
      // Live per-keystroke feedback: confirm correct immediately (green), but a wrong letter
      // stays neutral rather than turning red — mid-puzzle typing shouldn't read as a penalty,
      // only the explicit Check button marks wrong cells red.
      if (input.value === cell.solution) cell.el.classList.add('correct');
      advance(cell, currentDirection);
      updateStatus();
      return;
    }

    switch (e.key) {
      case 'Backspace': {
        e.preventDefault();
        if (input.value) {
          input.value = '';
          clearMark(cell);
        } else {
          const prev = neighborInWord(cell, currentDirection, -1);
          if (prev) {
            prev.input.value = '';
            clearMark(prev);
            focusCell(prev.row, prev.col, currentDirection);
          }
        }
        updateStatus();
        break;
      }
      case 'Delete':
        e.preventDefault();
        input.value = '';
        clearMark(cell);
        updateStatus();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveFree(cell.row, cell.col, 0, -1, 'across');
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFree(cell.row, cell.col, 0, 1, 'across');
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFree(cell.row, cell.col, -1, 0, 'down');
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFree(cell.row, cell.col, 1, 0, 'down');
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        toggleDirection(cell);
        break;
      default:
        break;
    }
  }

  function moveFree(row, col, dr, dc, dir) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      if (cells.has(cellKey(r, c))) {
        focusCell(r, c, dir);
        return;
      }
      r += dr; c += dc;
    }
  }

  function neighborInWord(cell, dir, step) {
    const wordIdx = cell[dir];
    if (wordIdx == null) return null;
    const r = dir === 'down' ? cell.row + step : cell.row;
    const c = dir === 'across' ? cell.col + step : cell.col;
    const next = cells.get(cellKey(r, c));
    if (next && next[dir] === wordIdx) return next;
    return null;
  }

  function advance(cell, dir) {
    const next = neighborInWord(cell, dir, 1);
    if (next) focusCell(next.row, next.col, dir);
  }

  function focusCell(row, col, dir) {
    const cell = cells.get(cellKey(row, col));
    if (!cell) return;
    pendingFocusDirection = dir;
    cell.input.focus();
  }

  function selectCell(row, col, forceDir) {
    const cell = cells.get(cellKey(row, col));
    if (!cell) return;
    currentRow = row; currentCol = col;
    if (forceDir && cell[forceDir] != null) {
      currentDirection = forceDir;
    } else if (currentDirection && cell[currentDirection] != null) {
      // keep current direction
    } else {
      currentDirection = cell.across != null ? 'across' : 'down';
    }
    highlight();
  }

  function toggleDirection(cell) {
    const other = currentDirection === 'across' ? 'down' : 'across';
    if (cell[other] != null) currentDirection = other;
    highlight();
  }

  function highlight() {
    cells.forEach((cell) => {
      cell.el.classList.remove('active-cell', 'active-word');
    });
    document.querySelectorAll('.cw-clue-list li.active').forEach((li) => li.classList.remove('active'));

    const cell = cells.get(cellKey(currentRow, currentCol));
    if (!cell) return;
    cell.el.classList.add('active-cell');

    const wordIdx = cell[currentDirection];
    if (wordIdx != null) {
      const word = words[wordIdx];
      for (let i = 0; i < word.answer.length; i++) {
        const r = word.direction === 'down' ? word.row + i : word.row;
        const c = word.direction === 'across' ? word.col + i : word.col;
        const wc = cells.get(cellKey(r, c));
        if (wc) wc.el.classList.add('active-word');
      }
      const li = document.querySelector(`.cw-clue-list li[data-index="${wordIdx}"]`);
      if (li) {
        li.classList.add('active');
        li.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function clearMark(cell) {
    cell.el.classList.remove('correct', 'incorrect');
  }

  function renderClues() {
    const across = words.filter((w) => w.direction === 'across').sort((a, b) => a.number - b.number);
    const down = words.filter((w) => w.direction === 'down').sort((a, b) => a.number - b.number);

    const renderList = (list, target) => {
      // Hint is opt-in per clue: a small button that reveals just the first letter as a text
      // line, never shown by default and never touching the grid itself — clicking it can't be
      // mistaken for auto-filling progress, it's purely a nudge.
      target.innerHTML = list.map((w) => (
        `<li data-index="${w.index}"><span class="cw-clue-num">${w.number}.</span>${LiveEvent.escapeHtml(w.clue)}`
        + `<button type="button" class="cw-hint-btn" data-hint-idx="${w.index}"><i class="fa-solid fa-lightbulb"></i> Hint</button>`
        + `<span class="cw-hint-text le-hidden" data-hint-text-idx="${w.index}">Starts with "${LiveEvent.escapeHtml(w.answer[0])}"</span></li>`
      )).join('');
      Array.from(target.children).forEach((li) => {
        li.addEventListener('click', () => {
          const w = words[Number(li.dataset.index)];
          focusCell(w.row, w.col, w.direction);
        });
      });
      target.querySelectorAll('.cw-hint-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = btn.dataset.hintIdx;
          const span = target.querySelector(`[data-hint-text-idx="${idx}"]`);
          if (span) span.classList.remove('le-hidden');
          btn.disabled = true;
        });
      });
    };

    renderList(across, els.acrossList);
    renderList(down, els.downList);
  }

  function updateStatus() {
    if (revealed) return;
    let filled = 0;
    cells.forEach((cell) => { if (cell.input.value) filled++; });
    els.status.textContent = `${filled} of ${cells.size} letters filled`;
    scheduleCrosswordProgress();
  }

  function checkAnswers() {
    let allFilled = true;
    let allCorrect = true;
    cells.forEach((cell) => {
      const val = cell.input.value;
      if (!val) { allFilled = false; return; }
      if (val === cell.solution) {
        cell.el.classList.add('correct');
        cell.el.classList.remove('incorrect');
      } else {
        cell.el.classList.add('incorrect');
        cell.el.classList.remove('correct');
        allCorrect = false;
      }
    });
    markSolvedClues();
    if (allFilled && allCorrect) {
      els.status.textContent = 'Every word is in place — nice work.';
      showWrapUp();
    } else {
      updateStatus();
    }
    scheduleCrosswordProgress();
  }

  function markSolvedClues() {
    words.forEach((w) => {
      let solved = true;
      for (let i = 0; i < w.answer.length; i++) {
        const r = w.direction === 'down' ? w.row + i : w.row;
        const c = w.direction === 'across' ? w.col + i : w.col;
        const cell = cells.get(cellKey(r, c));
        if (!cell || cell.input.value !== cell.solution) { solved = false; break; }
      }
      const li = document.querySelector(`.cw-clue-list li[data-index="${w.index}"]`);
      if (li) li.classList.toggle('solved', solved);
    });
  }

  function revealAll() {
    revealed = true;
    cells.forEach((cell) => {
      cell.input.value = cell.solution;
      cell.input.readOnly = true;
      cell.el.classList.remove('correct', 'incorrect');
      cell.el.classList.add('revealed');
    });
    document.querySelectorAll('.cw-clue-list li').forEach((li) => li.classList.add('solved'));
    els.checkBtn.disabled = true;
    els.revealBtn.disabled = true;
    els.status.textContent = 'Answers revealed.';
    showWrapUp();
    scheduleCrosswordProgress();
    // Immediate ping for reveal (full)
    if (crosswordSyncEnabled) setTimeout(sendCrosswordProgress, 200);
  }

  function showWrapUp() {
    if (els.rememberCard) {
      els.rememberText.textContent = rememberThisText;
      els.rememberCard.classList.remove('le-hidden');
    }
    if (els.wrapRow) els.wrapRow.classList.remove('le-hidden');
  }

  function openRevealConfirm() {
    if (revealed) return;
    els.revealConfirm.classList.remove('le-hidden');
  }
  function closeRevealConfirm() {
    els.revealConfirm.classList.add('le-hidden');
  }

  function beginActivity() {
    els.introScreen.classList.add('le-hidden');
    els.activityBody.classList.remove('le-hidden');
    updateStatus();
    if (crosswordSyncEnabled) scheduleCrosswordProgress();
  }

  function dismissIntro() {
    if (introDismissed) return;
    introDismissed = true;
    beginActivity();
  }

  if (els.introStartBtn) els.introStartBtn.addEventListener('click', dismissIntro);
  els.checkBtn.addEventListener('click', checkAnswers);
  els.revealBtn.addEventListener('click', openRevealConfirm);
  els.revealConfirmYes.addEventListener('click', () => { closeRevealConfirm(); revealAll(); });
  els.revealConfirmNo.addEventListener('click', closeRevealConfirm);

  LiveEvent.onAction({
    advance: () => { if (!introDismissed) dismissIntro(); },
    next: () => { if (!introDismissed) dismissIntro(); },
    reveal: () => { if (introDismissed) openRevealConfirm(); }
  });

  fetch('../content/crossword.json')
    .then((r) => r.json())
    .then((data) => {
      if (els.introText) els.introText.textContent = data.whyThisMatters || '';
      rememberThisText = data.rememberThis || '';
      buildModel(data);
      renderGrid();
      renderClues();
      updateStatus();
      // Init phone-synced mode if participantId present (additive, no impact standalone)
      const ctx = detectCrosswordSync();
      crosswordSyncRoomCode = ctx.roomCode;
      crosswordSyncParticipantId = ctx.participantId;
      crosswordSyncEnabled = !!(crosswordSyncRoomCode && crosswordSyncParticipantId);
      if (crosswordSyncEnabled) scheduleCrosswordProgress();
    })
    .catch((err) => {
      els.status.textContent = "Couldn't load this activity's content — check your connection or refresh.";
      console.error(err);
    });
})();
