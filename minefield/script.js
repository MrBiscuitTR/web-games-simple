// ============================================================
//  MINEFIELD – Classic Minesweeper
//  IndexedDB persistence, flagging, undo (1 right),
//  responsive board with inner scroll/zoom only
// ============================================================

const DICT = {
    en: {
        title: 'Minefield', easy: 'Easy', medium: 'Medium', hard: 'Hard', custom: 'Custom',
        rows: 'Rows:', cols: 'Cols:', mines: 'Mines:', apply: 'Apply',
        newGame: 'New Game', flag: '🚩 Flag', undo: '↩ Undo',
        winTitle: 'You Win! 🎉', winMsg: 'All mines cleared!', newGameBtn: 'New Game',
        loseTitle: '💥 Boom!', loseMsg: "You hit a mine. Undo or start over.",
        undoLose: '↩ Undo (1)', noUndoLose: 'No undos left!',
        continueAnyway: 'Continue Anyway', timeLabel: 'Time: ',
        rightClickFlag: '🖱️ Right-click flags', loseNewGame: 'New Game'
    },
    tr: {
        title: 'Mayın Tarlası', easy: 'Kolay', medium: 'Orta', hard: 'Zor', custom: 'Özel',
        rows: 'Satır:', cols: 'Sütun:', mines: 'Mayın:', apply: 'Uygula',
        newGame: 'Yeni Oyun', flag: '🚩 Bayrak', undo: '↩ Geri Al',
        winTitle: 'Kazandınız! 🎉', winMsg: 'Tüm mayınlar temizlendi!', newGameBtn: 'Yeni Oyun',
        loseTitle: '💥 Patlama!', loseMsg: 'Bir mayına bastınız. Geri alın ya da yeniden başlayın.',
        undoLose: '↩ Geri Al (1)', noUndoLose: 'Geri alma hakkınız kalmadı!',
        continueAnyway: 'Yine de Devam Et', timeLabel: 'Süre: ',
        rightClickFlag: '🖱️ Sağ tık bayrak', loseNewGame: 'Yeni Oyun'
    }
};

const PRESETS = {
    easy:   { rows: 9,  cols: 9,  mines: 10 },
    medium: { rows: 16, cols: 16, mines: 40 },
    hard:   { rows: 24, cols: 24, mines: 130 }
};

// Max mines = 35% of total cells (keeps the game solvable/playable)
function maxMines(rows, cols) {
    return Math.max(1, Math.floor(rows * cols * 0.35));
}

let db;
let lang = 'en';

let state = {
    rows: 9, cols: 9, mines: 10,
    cells: [],          // flat array of { mine, flagged, open, adj }
    gameStarted: false, // mines placed after first click
    gameOver: false,
    won: false,
    flagMode: false,
    undosLeft: 1,
    historySnapshot: null,  // one snapshot for single undo
    preset: 'easy',
    timerStart: null,
    timerElapsed: 0,
    rightClickFlag: false
};

let timerInterval = null;

// ── State helpers ─────────────────────────────────────────────

function idx(r, c) { return r * state.cols + c; }
function rc(i) { return { r: Math.floor(i / state.cols), c: i % state.cols }; }
function neighbors(i) {
    const { r, c } = rc(i);
    const ns = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) ns.push(idx(nr, nc));
    }
    return ns;
}

function newCells() {
    return Array(state.rows * state.cols).fill(null).map(() => ({
        mine: false, flagged: false, open: false, adj: 0
    }));
}

function placeMines(firstClick) {
    const total = state.rows * state.cols;
    const safe = new Set(neighbors(firstClick));
    safe.add(firstClick);
    const candidates = [];
    for (let i = 0; i < total; i++) if (!safe.has(i)) candidates.push(i);
    shuffle(candidates);
    const mineCount = Math.min(state.mines, candidates.length);
    for (let i = 0; i < mineCount; i++) state.cells[candidates[i]].mine = true;
    // Compute adjacency
    for (let i = 0; i < total; i++) {
        if (!state.cells[i].mine) {
            state.cells[i].adj = neighbors(i).filter(n => state.cells[n].mine).length;
        }
    }
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// ── Init game ─────────────────────────────────────────────────

function initGame(rows, cols, mines, preset) {
    state.rows = rows;
    state.cols = cols;
    state.mines = mines;
    state.preset = preset || 'custom';
    state.cells = newCells();
    state.gameStarted = false;
    state.gameOver = false;
    state.won = false;
    state.flagMode = false;
    state.undosLeft = 1;
    state.historySnapshot = null;
    state.timerStart = null;
    state.timerElapsed = 0;

    stopTimer();
    updateTimerDisplay(0);
    updateMinesLeft();
    updateFlagBtn();
    updateUndoBtn();
    _boardScale = 1;
    applyScale(1);
    render();
    saveState();
}

// ── Timer ─────────────────────────────────────────────────────

function startTimer() {
    if (timerInterval) return;
    state.timerStart = Date.now() - (state.timerElapsed * 1000);
    timerInterval = setInterval(() => {
        state.timerElapsed = Math.floor((Date.now() - state.timerStart) / 1000);
        updateTimerDisplay(state.timerElapsed);
    }, 500);
}

function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

function updateTimerDisplay(s) {
    document.getElementById('timer').textContent = s;
}

function formatTime(s) {
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// ── Rendering ─────────────────────────────────────────────────

function computeCellSize() {
    const outer = document.getElementById('board-scroll-outer');
    if (!outer || !outer.clientWidth) return 32;
    // Width-only sizing: always stable, never affected by layout shifts above.
    // Board scrolls vertically if it doesn't fit — that's acceptable.
    const GAP = 2;
    const PAD = 12;
    const avW = outer.clientWidth - PAD;
    const cW = Math.floor((avW - (state.cols - 1) * GAP) / state.cols);
    return Math.max(14, Math.min(48, cW));
}

function render() {
    const board = document.getElementById('mine-board');
    const s = computeCellSize();
    const GAP = 2;
    // Drive grid entirely from JS — no CSS track sizing involved
    board.style.gridTemplateColumns = `repeat(${state.cols}, ${s}px)`;
    board.style.gridTemplateRows    = `repeat(${state.rows}, ${s}px)`;
    board.style.gap = `${GAP}px`;
    board.style.setProperty('--cell', s + 'px');
    board.innerHTML = '';

    for (let i = 0; i < state.rows * state.cols; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        // Force exact square size — no CSS ambiguity
        cell.style.width  = s + 'px';
        cell.style.height = s + 'px';
        cell.style.fontSize = Math.floor(s * 0.48) + 'px';
        const c = state.cells[i];

        if (c.open) {
            cell.classList.add('open');
            if (c.mine) {
                cell.classList.add('mine-hit');
            } else if (c.adj > 0) {
                cell.textContent = c.adj;
                cell.classList.add(`num-${c.adj}`);
            }
        } else if (c.flagged) {
            cell.classList.add('flagged');
        }

        if (state.gameOver && !state.won && c.mine && !c.flagged && !c.open) {
            cell.classList.add('mine-revealed');
        }

        board.appendChild(cell);
    }
}

// ── Pan/zoom + tap handling ───────────────────────────────────
// The scroll container handles all pointer events.
// - Left-click tap on cell: open/flag (if no pan)
// - Middle-click drag / right-click drag / touch drag: pan the board
// - Pinch (touch): browser native pinch-zoom via touch-action
// - Mouse wheel: native scroll
// A tap is only fired if pointer moved < TAP_THRESHOLD px.

const TAP_THRESHOLD = 6;
let _pan = { active: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0, moved: false, button: -1 };
let _longPressTimer = null;
let _tapCellIdx = -1;

// Pinch zoom state
let _pinch = { active: false, startDist: 0, startScale: 1 };
let _boardScale = 1;

function pinchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function minScale() {
    const outer = document.getElementById('board-scroll-outer');
    const board = document.getElementById('mine-board');
    if (!outer || !board) return 0.5;
    const GAP = 2;
    const s = computeCellSize();
    const boardW = state.cols * s + (state.cols - 1) * GAP;
    const boardH = state.rows * s + (state.rows - 1) * GAP;
    const scaleW = (outer.clientWidth  - 12) / boardW;
    const scaleH = (outer.clientHeight - 12) / boardH;
    // Must fit both axes — use the smaller ratio, capped at 1 (never force zoom-in)
    return Math.min(1, scaleW, scaleH);
}

function applyScale(scale) {
    _boardScale = Math.max(minScale(), Math.min(4, scale));
    document.getElementById('mine-board').style.transform = `scale(${_boardScale})`;
    document.getElementById('mine-board').style.transformOrigin = 'top left';
}

function cellIndexOf(target) {
    const board = document.getElementById('mine-board');
    const cell = target.closest('.mine-cell');
    if (!cell) return -1;
    return [...board.children].indexOf(cell);
}

function setupBoardInteraction() {
    const inner = document.getElementById('board-scroll-inner');

    // ── Pinch zoom (touch events, two fingers) ────────────────
    inner.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
            _pinch.active = true;
            _pinch.startDist = pinchDist(e.touches);
            _pinch.startScale = _boardScale;
            // Cancel any pending pan/tap when second finger lands
            clearTimeout(_longPressTimer);
            _pan.active = false;
            _pan.moved = true;
            _tapCellIdx = -1;
            e.preventDefault();
        }
    }, { passive: false });

    inner.addEventListener('touchmove', e => {
        if (_pinch.active && e.touches.length === 2) {
            const dist = pinchDist(e.touches);
            applyScale(_pinch.startScale * (dist / _pinch.startDist));
            e.preventDefault();
        }
    }, { passive: false });

    inner.addEventListener('touchend', e => {
        if (e.touches.length < 2) _pinch.active = false;
    });

    // ── Pointer events: single-finger pan + tap ───────────────
    inner.addEventListener('pointerdown', e => {
        if (_pinch.active) return; // ignore pointer events during pinch
        const isPanButton = e.button === 1 || e.button === 2 || e.pointerType === 'touch';
        _pan.active   = isPanButton || e.button === 0;
        _pan.button   = e.button;
        _pan.startX   = e.clientX;
        _pan.startY   = e.clientY;
        _pan.scrollX  = inner.scrollLeft;
        _pan.scrollY  = inner.scrollTop;
        _pan.moved    = false;

        _tapCellIdx = cellIndexOf(e.target);

        // Long-press to flag (touch only)
        if (e.pointerType === 'touch' && _tapCellIdx !== -1) {
            _longPressTimer = setTimeout(() => {
                if (!_pan.moved) {
                    handleFlag(_tapCellIdx);
                    _tapCellIdx = -1;
                }
            }, 500);
        }

        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            inner.setPointerCapture(e.pointerId);
        }
    });

    inner.addEventListener('pointermove', e => {
        if (!_pan.active || _pinch.active) return;
        const dx = e.clientX - _pan.startX;
        const dy = e.clientY - _pan.startY;
        if (!_pan.moved && Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) {
            _pan.moved = true;
            clearTimeout(_longPressTimer);
        }
        if (_pan.moved && (_pan.button === 1 || _pan.button === 2)) {
            inner.scrollLeft = _pan.scrollX - dx;
            inner.scrollTop  = _pan.scrollY - dy;
        }
        if (_pan.moved && e.pointerType === 'touch') {
            inner.scrollLeft = _pan.scrollX - dx;
            inner.scrollTop  = _pan.scrollY - dy;
        }
    });

    inner.addEventListener('pointerup', e => {
        clearTimeout(_longPressTimer);
        _pan.active = false;
        if (_pinch.active) return;

        const wasPan = _pan.moved;
        _pan.moved = false; // reset so next contextmenu/tap starts fresh

        if (wasPan) { _tapCellIdx = -1; return; }

        const i = _tapCellIdx !== -1 ? _tapCellIdx : cellIndexOf(e.target);
        if (i !== -1 && e.button === 0 || e.pointerType === 'touch') {
            handleCellInteraction(i);
        }
        _tapCellIdx = -1;
    });

    inner.addEventListener('pointercancel', () => {
        clearTimeout(_longPressTimer);
        _pan.active = false;
        _pan.moved  = true;
        _tapCellIdx = -1;
    });

    // Right-click context menu: flag only when right-click-flag mode is on
    inner.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (_pan.moved) return;
        if (!state.rightClickFlag) return;
        const i = cellIndexOf(e.target);
        if (i !== -1) handleFlag(i);
    });

    // Mouse wheel zoom
    inner.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        applyScale(_boardScale * delta);
    }, { passive: false });
}

function updateMinesLeft() {
    const flagged = state.cells.filter(c => c.flagged).length;
    document.getElementById('mines-left').textContent = state.mines - flagged;
}

function updateFlagBtn() {
    document.getElementById('btn-flag').classList.toggle('active', state.flagMode);
}

function updateUndoBtn() {
    const btn = document.getElementById('btn-undo');
    btn.disabled = state.undosLeft <= 0 || state.historySnapshot === null || state.gameOver && state.won;
    btn.textContent = `↩ ${DICT[lang].undo.replace('↩ ', '')} (${state.undosLeft})`;
}

// ── Cell interaction ──────────────────────────────────────────

function handleCellInteraction(i) {
    if (state.gameOver) return;
    if (state.flagMode) {
        handleFlag(i);
    } else {
        handleOpen(i);
    }
}

function handleFlag(i) {
    if (state.gameOver) return;
    const c = state.cells[i];
    if (c.open) return;
    c.flagged = !c.flagged;
    updateMinesLeft();
    render();
    saveState();
    checkWin();
}

function handleOpen(i) {
    if (state.gameOver) return;
    const c = state.cells[i];
    if (c.flagged || c.open) return;

    if (!state.gameStarted) {
        state.gameStarted = true;
        placeMines(i);
        startTimer();
    }

    // Save snapshot before opening
    takeSnapshot();

    floodOpen(i);

    if (state.cells[i].mine) {
        state.cells[i].open = true;
        gameOver();
        return;
    }

    render();
    updateMinesLeft();
    saveState();
    checkWin();
}

function floodOpen(startIdx) {
    const queue = [startIdx];
    const visited = new Set();
    while (queue.length > 0) {
        const i = queue.shift();
        if (visited.has(i)) continue;
        visited.add(i);
        const c = state.cells[i];
        if (c.flagged || c.open) continue;
        if (c.mine) continue;
        c.open = true;
        c.flagged = false;
        if (c.adj === 0) {
            neighbors(i).forEach(n => {
                if (!visited.has(n)) queue.push(n);
            });
        }
    }
}

function gameOver() {
    state.gameOver = true;
    state.won = false;
    stopTimer();
    clearSavedState();
    render();
    showLoseModal();
}

function checkWin() {
    const allOpen = state.cells.every(c => c.mine || c.open);
    const allFlagged = state.cells.every(c => c.mine ? c.flagged : !c.flagged);
    if (allOpen || allFlagged) {
        state.gameOver = true;
        state.won = true;
        stopTimer();
        clearSavedState();
        render();
        showWinModal();
    }
}

// ── Undo ──────────────────────────────────────────────────────

function takeSnapshot() {
    if (state.undosLeft <= 0) return;
    state.historySnapshot = state.cells.map(c => ({ ...c }));
}

function doUndo() {
    if (state.undosLeft <= 0 || !state.historySnapshot) return;
    state.undosLeft--;
    state.cells = state.historySnapshot.map(c => ({ ...c }));
    state.historySnapshot = null;
    state.gameOver = false;
    state.won = false;
    document.getElementById('loseModal').style.display = 'none';
    startTimer(); // resume timer — undo doesn't end the game
    render();
    updateMinesLeft();
    updateUndoBtn();
    saveState();
}

// ── Modals ────────────────────────────────────────────────────

function showWinModal() {
    const d = DICT[lang];
    document.getElementById('win-title').textContent = d.winTitle;
    document.getElementById('win-msg').textContent = d.winMsg + ' ' + d.timeLabel + formatTime(state.timerElapsed);
    document.getElementById('btn-new-win').textContent = d.newGameBtn;
    document.getElementById('winModal').style.display = 'flex';
}

function showLoseModal() {
    const d = DICT[lang];
    document.getElementById('lose-title').textContent = d.loseTitle;
    document.getElementById('lose-msg').textContent = d.loseMsg + ' ' + d.timeLabel + formatTime(state.timerElapsed);
    const canUndo = state.undosLeft > 0 && state.historySnapshot;
    const undoBtn = document.getElementById('btn-undo-lose');
    if (canUndo) {
        undoBtn.textContent = d.undoLose;
        undoBtn.disabled = false;
    } else {
        undoBtn.textContent = d.noUndoLose;
        undoBtn.disabled = true;
    }
    document.getElementById('btn-new-lose').textContent = d.loseNewGame;
    document.getElementById('btn-continue-lose').textContent = d.continueAnyway;
    // Only show "Continue Anyway" when there's no undo option left
    document.getElementById('continue-lose-row').style.display = canUndo ? 'none' : 'flex';
    document.getElementById('loseModal').style.display = 'flex';
}

// ── UI Updates ────────────────────────────────────────────────

function updateRightClickFlagBtn() {
    const btn = document.getElementById('btn-rightclick-flag');
    if (btn) btn.classList.toggle('active', state.rightClickFlag);
}

function updateUI() {
    const d = DICT[lang];
    document.getElementById('ui-title').textContent = d.title;
    document.getElementById('btn-easy').textContent = d.easy;
    document.getElementById('btn-medium').textContent = d.medium;
    document.getElementById('btn-hard').textContent = d.hard;
    document.getElementById('btn-custom').textContent = d.custom;
    document.getElementById('lbl-rows').textContent = d.rows;
    document.getElementById('lbl-cols').textContent = d.cols;
    document.getElementById('lbl-mines').textContent = d.mines;
    document.getElementById('btn-apply').textContent = d.apply;
    document.getElementById('btn-new').textContent = d.newGame;
    document.getElementById('btn-flag').textContent = d.flag + (state.flagMode ? ' ✓' : '');
    const rcBtn = document.getElementById('btn-rightclick-flag');
    if (rcBtn) rcBtn.textContent = d.rightClickFlag + (state.rightClickFlag ? ' ✓' : '');
    document.documentElement.lang = lang;
    updateUndoBtn();
    updateRightClickFlagBtn();
}

function setActivePreset(preset) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    document.getElementById('custom-panel').style.display = preset === 'custom' ? 'flex' : 'none';
}

function updateMineSliderMax() {
    const rows = parseInt(document.getElementById('inp-rows').value);
    const cols = parseInt(document.getElementById('inp-cols').value);
    const max = maxMines(rows, cols);
    const mineSlider = document.getElementById('inp-mines');
    mineSlider.max = max;
    if (parseInt(mineSlider.value) > max) mineSlider.value = max;
    document.getElementById('val-mines').textContent = mineSlider.value;
}

// ── IndexedDB ─────────────────────────────────────────────────

function initDB() {
    return new Promise(res => {
        const req = indexedDB.open('minefieldGameDB', 1);
        req.onupgradeneeded = e => {
            db = e.target.result;
            db.createObjectStore('saves', { keyPath: 'id' });
        };
        req.onsuccess = e => { db = e.target.result; res(); };
        req.onerror = () => res();
    });
}

function saveState() {
    if (!db) return;
    const s = {
        rows: state.rows, cols: state.cols, mines: state.mines,
        cells: state.cells,
        gameStarted: state.gameStarted, gameOver: state.gameOver, won: state.won,
        flagMode: state.flagMode, rightClickFlag: state.rightClickFlag, undosLeft: state.undosLeft,
        historySnapshot: state.historySnapshot,
        preset: state.preset,
        timerElapsed: state.timerElapsed,
        lang
    };
    db.transaction('saves', 'readwrite').objectStore('saves').put({ id: 'current', data: JSON.stringify(s) });
}

function clearSavedState() {
    if (!db) return;
    db.transaction('saves', 'readwrite').objectStore('saves').delete('current');
}

function loadState() {
    return new Promise(res => {
        if (!db) { res(false); return; }
        const req = db.transaction('saves', 'readonly').objectStore('saves').get('current');
        req.onsuccess = () => {
            if (!req.result) { res(false); return; }
            try {
                const s = JSON.parse(req.result.data);
                lang = s.lang || 'en';
                state.rows = s.rows; state.cols = s.cols; state.mines = s.mines;
                state.cells = s.cells;
                state.gameStarted = s.gameStarted; state.gameOver = s.gameOver; state.won = s.won;
                state.flagMode = s.flagMode; state.rightClickFlag = s.rightClickFlag || false; state.undosLeft = s.undosLeft;
                state.historySnapshot = s.historySnapshot;
                state.preset = s.preset;
                state.timerElapsed = s.timerElapsed || 0;
                res(true);
            } catch(e) { res(false); }
        };
        req.onerror = () => res(false);
    });
}

// ── Bootstrap ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => loadState().then(loaded => {
        document.getElementById('langPicker').value = lang;
        updateUI();

        const doRender = () => {
            if (loaded && state.cells.length > 0) {
                setActivePreset(state.preset);
                document.getElementById('inp-rows').value = state.rows;
                document.getElementById('inp-cols').value = state.cols;
                document.getElementById('inp-mines').value = state.mines;
                document.getElementById('val-rows').textContent = state.rows;
                document.getElementById('val-cols').textContent = state.cols;
                document.getElementById('val-mines').textContent = state.mines;
                updateTimerDisplay(state.timerElapsed);
                updateMinesLeft();
                updateFlagBtn();
                updateUndoBtn();
                render();
                if (state.gameStarted && !state.gameOver) startTimer();
            } else {
                const p = PRESETS.easy;
                initGame(p.rows, p.cols, p.mines, 'easy');
            }
        };

        // Defer render until layout is painted so clientWidth/Height are correct
        requestAnimationFrame(() => requestAnimationFrame(doRender));
    }));

    // Language
    document.getElementById('langPicker').addEventListener('change', e => {
        lang = e.target.value;
        saveState();
        updateUI();
    });

    // Preset tabs
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            setActivePreset(preset);
            if (preset !== 'custom') {
                const p = PRESETS[preset];
                initGame(p.rows, p.cols, p.mines, preset);
            }
        });
    });

    // Custom sliders
    ['rows', 'cols', 'mines'].forEach(key => {
        const inp = document.getElementById(`inp-${key}`);
        const val = document.getElementById(`val-${key}`);
        inp.addEventListener('input', () => {
            val.textContent = inp.value;
            if (key !== 'mines') updateMineSliderMax();
        });
    });

    // Apply custom
    document.getElementById('btn-apply').addEventListener('click', () => {
        const rows = parseInt(document.getElementById('inp-rows').value);
        const cols = parseInt(document.getElementById('inp-cols').value);
        const mines = parseInt(document.getElementById('inp-mines').value);
        initGame(rows, cols, mines, 'custom');
    });

    // New game
    document.getElementById('btn-new').addEventListener('click', () => {
        initGame(state.rows, state.cols, state.mines, state.preset);
    });

    // Flag toggle
    document.getElementById('btn-flag').addEventListener('click', () => {
        state.flagMode = !state.flagMode;
        updateFlagBtn();
        updateUI();
        saveState();
    });

    // Right-click-to-flag toggle (desktop only — hide on touch devices)
    const rcBtn = document.getElementById('btn-rightclick-flag');
    if (rcBtn) {
        const isTouch = window.matchMedia('(hover: none)').matches;
        rcBtn.style.display = isTouch ? 'none' : '';
        rcBtn.addEventListener('click', () => {
            state.rightClickFlag = !state.rightClickFlag;
            updateUI();
            saveState();
        });
    }

    // Undo
    document.getElementById('btn-undo').addEventListener('click', doUndo);

    // Win modal
    document.getElementById('btn-new-win').addEventListener('click', () => {
        document.getElementById('winModal').style.display = 'none';
        initGame(state.rows, state.cols, state.mines, state.preset);
    });

    // Lose modal
    document.getElementById('btn-undo-lose').addEventListener('click', () => {
        doUndo();
    });
    document.getElementById('btn-new-lose').addEventListener('click', () => {
        document.getElementById('loseModal').style.display = 'none';
        initGame(state.rows, state.cols, state.mines, state.preset);
    });

    // Board interaction (pan + tap)
    setupBoardInteraction();

    // Re-fit cells on resize/orientation change
    let _resizeTimer = null;
    window.addEventListener('resize', () => { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(render, 100); });

    // Prevent keyboard
    document.addEventListener('keydown', e => e.preventDefault());

    // Initialise mine slider max based on default/loaded rows+cols
    updateMineSliderMax();

    // Continue anyway (lose)
    document.getElementById('btn-continue-lose').addEventListener('click', () => {
        document.getElementById('loseModal').style.display = 'none';
        // Restore state so game is playable again (undo already used or not)
        state.gameOver = false;
        state.won = false;
        startTimer();
        render();
        saveState();
    });
});
