// ============================================================
//  SUDOKU – full featured
//  IndexedDB persistence, note mode, smart annotations,
//  undo (3 rights), wrong-move lock, box-complete animation
// ============================================================

const DICT = {
    en: {
        title: 'Sudoku', easy: 'Easy', medium: 'Medium', hard: 'Hard',
        newGame: 'New Game', undo: 'Undo', noteMode: '✏️', smart: '💡',
        wrongTitle: 'Wrong Number!', wrongMsg: 'Undo your move to continue.',
        undosLeft: 'Undos left: ', undoBtn: 'Undo', newGameBtn: 'New Game', dangerNewGame: 'New Game',
        winTitle: '🎉 Solved!', winMsg: 'Amazing! You completed the puzzle!',
        noUndoTitle: 'No More Undos!',
        noUndoMsg: "You've used all your undo rights.",
        congrats: 'New Game', continueAnyway: 'Continue Anyway', timeLabel: 'Time: '
    },
    tr: {
        title: 'Sudoku', easy: 'Kolay', medium: 'Orta', hard: 'Zor',
        newGame: 'Yeni Oyun', undo: 'Geri Al', noteMode: '✏️', smart: '💡',
        wrongTitle: 'Yanlış Sayı!', wrongMsg: 'Devam etmek için hamlenizi geri alın.',
        undosLeft: 'Kalan geri alma hakkı: ', undoBtn: 'Geri Al', newGameBtn: 'Yeni Oyun', dangerNewGame: 'Yeni Oyun',
        winTitle: '🎉 Tamamlandı!', winMsg: 'Harika! Bulmacayı çözdünüz!',
        noUndoTitle: 'Geri Alma Hakkınız Kalmadı!',
        noUndoMsg: 'Tüm geri alma haklarınızı kullandınız.',
        congrats: 'Yeni Oyun', continueAnyway: 'Yine de Devam Et', timeLabel: 'Süre: '
    }
};

// Difficulty: clues removed
const DIFFICULTY = { easy: 30, medium: 46, hard: 56 };

// ── Timer ─────────────────────────────────────────────────────
function startSudokuTimer() {
    if (sudokuTimerInterval) return;
    state.timerStart = Date.now() - (state.timerElapsed * 1000);
    sudokuTimerInterval = setInterval(() => {
        state.timerElapsed = Math.floor((Date.now() - state.timerStart) / 1000);
        updateSudokuTimerDisplay();
    }, 500);
}

function stopSudokuTimer() {
    clearInterval(sudokuTimerInterval);
    sudokuTimerInterval = null;
}

function updateSudokuTimerDisplay() {
    const el = document.getElementById('sudoku-timer');
    if (el) el.textContent = '⏱ ' + formatSudokuTime(state.timerElapsed);
}

function formatSudokuTime(s) {
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

let db;
let lang = 'en';
let sudokuTimerInterval = null;
let state = {
    solution: null,
    puzzle: null,
    given: null,
    cells: null,
    selected: null,
    noteMode: false,
    smartMode: false,
    undosLeft: 3,
    history: [],
    difficulty: 'easy',
    gameOver: false,
    completedBoxes: Array(9).fill(false),
    timerElapsed: 0,
    timerStart: null
};

// ── Sudoku Generator ─────────────────────────────────────────

function generateSudoku(difficulty) {
    const sol = solveEmpty();
    const puz = sol.slice();
    const removals = DIFFICULTY[difficulty];

    const indices = shuffle([...Array(81).keys()]);
    let removed = 0;
    for (const idx of indices) {
        if (removed >= removals) break;
        const backup = puz[idx];
        puz[idx] = 0;
        if (!hasUniqueSolution(puz)) {
            puz[idx] = backup;
        } else {
            removed++;
        }
    }
    return { solution: sol, puzzle: puz };
}

function solveEmpty() {
    const grid = Array(81).fill(0);
    fillGrid(grid);
    return grid;
}

function fillGrid(grid) {
    const idx = grid.indexOf(0);
    if (idx === -1) return true;
    const nums = shuffle([1,2,3,4,5,6,7,8,9]);
    for (const n of nums) {
        if (isValid(grid, idx, n)) {
            grid[idx] = n;
            if (fillGrid(grid)) return true;
            grid[idx] = 0;
        }
    }
    return false;
}

function isValid(grid, idx, n) {
    const row = Math.floor(idx / 9);
    const col = idx % 9;
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let i = 0; i < 9; i++) {
        if (grid[row * 9 + i] === n) return false;
        if (grid[i * 9 + col] === n) return false;
        if (grid[(boxRow + Math.floor(i / 3)) * 9 + boxCol + (i % 3)] === n) return false;
    }
    return true;
}

// Count solutions (stop at 2)
function countSolutions(grid, limit = 2) {
    const g = grid.slice();
    let count = 0;
    function solve() {
        const idx = g.indexOf(0);
        if (idx === -1) { count++; return count >= limit; }
        for (let n = 1; n <= 9; n++) {
            if (isValid(g, idx, n)) {
                g[idx] = n;
                if (solve()) return true;
                g[idx] = 0;
            }
        }
        return false;
    }
    solve();
    return count;
}

function hasUniqueSolution(puz) {
    return countSolutions(puz) === 1;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ── State Init ───────────────────────────────────────────────

function initGame(difficulty) {
    stopSudokuTimer();
    const { solution, puzzle } = generateSudoku(difficulty);
    state.solution = solution;
    state.puzzle = puzzle;
    state.given = puzzle.map(v => v !== 0);
    state.cells = puzzle.map(v => ({ val: v, notes: new Set(), wrong: false }));
    state.selected = null;
    state.noteMode = false;
    state.smartMode = false;
    state.undosLeft = 3;
    state.history = [];
    state.difficulty = difficulty;
    state.gameOver = false;
    state.completedBoxes = Array(9).fill(false);
    state.timerElapsed = 0;
    state.timerStart = null;

    updateDiffButtons(difficulty);
    updateNoteBtn();
    updateSmartBtn();
    updateUndoBtn();
    updateSudokuTimerDisplay();
    render();
    saveState();
}

// ── Rendering ────────────────────────────────────────────────

function render() {
    const board = document.getElementById('sudoku-board');
    board.innerHTML = '';

    const sel = state.selected;

    // Compute smart notes if enabled
    let smartNotes = null;
    if (state.smartMode) {
        smartNotes = computeSmartNotes();
    }

    for (let i = 0; i < 81; i++) {
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        cell.dataset.idx = i;

        const row = Math.floor(i / 9);
        const col = i % 9;
        const boxIdx = Math.floor(row / 3) * 3 + Math.floor(col / 3);

        // Box borders
        if (col === 2 || col === 5) cell.classList.add('box-right');
        if (row === 2 || row === 5) cell.classList.add('box-bottom');

        const c = state.cells[i];

        if (state.given[i]) {
            cell.classList.add('given');
            cell.textContent = c.val;
        } else if (c.val !== 0) {
            cell.textContent = c.val;
            if (c.wrong) {
                cell.classList.add('wrong');
            } else {
                cell.classList.add('correct');
                cell.style.cursor = 'default';
            }
        } else {
            // Notes
            const userNotes = c.notes;
            const ghostNotes = smartNotes ? smartNotes[i] : new Set();

            if (userNotes.size > 0 || ghostNotes.size > 0) {
                const grid = document.createElement('div');
                grid.className = 'cell-notes';
                for (let n = 1; n <= 9; n++) {
                    const span = document.createElement('span');
                    span.className = 'cell-note-num';
                    if (userNotes.has(n)) {
                        span.textContent = n;
                        span.classList.add('user');
                    } else if (ghostNotes.has(n)) {
                        span.textContent = n;
                        span.classList.add('ghost');
                    }
                    grid.appendChild(span);
                }
                cell.appendChild(grid);
            }
        }

        // Highlights
        if (sel !== null) {
            const selRow = Math.floor(sel / 9);
            const selCol = sel % 9;
            const selBox = Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3);

            if (i === sel) {
                cell.classList.add('selected');
            } else if (row === selRow || col === selCol || boxIdx === selBox) {
                cell.classList.add('highlight-row');
            }

            const selVal = state.cells[sel].val || (state.given[sel] ? state.cells[sel].val : 0);
            if (selVal && c.val === selVal && i !== sel) {
                cell.classList.add('highlight-same');
            }
        }

        // Box complete
        if (state.completedBoxes[boxIdx]) {
            cell.classList.add('box-complete');
        }

        cell.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (state.gameOver) return;
            handleCellClick(i);
        });

        board.appendChild(cell);
    }

    updateUndoBtn();
    updateNumpadDisabled();
}

function computeSmartNotes() {
    const notes = Array(81).fill(null).map(() => new Set());
    for (let i = 0; i < 81; i++) {
        if (state.cells[i].val !== 0 || state.given[i]) continue;
        for (let n = 1; n <= 9; n++) {
            // Check if n is valid at position i based on current board (not solution)
            const row = Math.floor(i / 9);
            const col = i % 9;
            const boxRow = Math.floor(row / 3) * 3;
            const boxCol = Math.floor(col / 3) * 3;
            let ok = true;
            for (let j = 0; j < 9; j++) {
                const rv = state.cells[row * 9 + j].val;
                const cv = state.cells[j * 9 + col].val;
                const bv = state.cells[(boxRow + Math.floor(j / 3)) * 9 + boxCol + (j % 3)].val;
                if (rv === n || cv === n || bv === n) { ok = false; break; }
            }
            if (ok) notes[i].add(n);
        }
    }
    return notes;
}

function updateDiffButtons(diff) {
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.diff === diff);
    });
}

function updateNoteBtn() {
    const btn = document.getElementById('btn-note');
    btn.classList.toggle('active', state.noteMode);
}

function updateSmartBtn() {
    const btn = document.getElementById('btn-smart');
    btn.classList.toggle('active', state.smartMode);
}

function updateUndoBtn() {
    const btn = document.getElementById('btn-undo');
    btn.disabled = state.history.length === 0 || state.undosLeft <= 0;
    const d = DICT[lang];
    btn.textContent = `${d.undo} (${state.undosLeft})`;
}

function updateNumpadDisabled() {
    // Grey out numbers that are fully placed (9 times) in the valid cells
    const counts = Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
        const v = state.cells[i].val;
        if (v && !state.cells[i].wrong) counts[v]++;
    }
    document.querySelectorAll('.num-btn[data-num]').forEach(btn => {
        const n = parseInt(btn.dataset.num);
        if (n === 0) return;
        btn.classList.toggle('disabled-num', counts[n] >= 9);
    });
}

// ── Cell & Numpad Interaction ────────────────────────────────

function isLockedCell(idx) {
    if (state.given[idx]) return true;
    const c = state.cells[idx];
    return c.val !== 0 && !c.wrong && c.val === state.solution[idx];
}

function handleCellClick(idx) {
    if (state.gameOver) return;
    // Block interaction if there's a wrong cell that hasn't been undone
    if (hasWrongCell() && idx !== state.selected) return;

    state.selected = idx;
    render();
}

function handleNumpad(n) {
    if (state.gameOver) return;
    if (state.selected === null) return;
    const idx = state.selected;
    if (isLockedCell(idx)) return;

    // Block if wrong cell exists (must undo first)
    if (hasWrongCell()) return;

    // Start timer on first real input
    startSudokuTimer();

    if (state.noteMode) {
        const notes = state.cells[idx].notes;
        if (n === 0) {
            notes.clear();
        } else {
            if (notes.has(n)) {
                notes.delete(n);
            } else if (!numberExistsInPeers(idx, n)) {
                notes.add(n);
            }
        }
        saveState();
        render();
        return;
    }

    if (n === 0) {
        if (state.cells[idx].val === 0) return;
        pushHistory();
        state.cells[idx].val = 0;
        state.cells[idx].wrong = false;
        saveState();
        render();
        return;
    }

    if (state.cells[idx].val === n) return; // no change

    pushHistory();
    state.cells[idx].val = n;
    state.cells[idx].notes.clear();
    state.cells[idx].wrong = false;

    // Check correctness
    if (n !== state.solution[idx]) {
        state.cells[idx].wrong = true;
        saveState();
        render();
        showWrongModal();
        return;
    }

    // Correct placement - clear matching notes in row/col/box
    clearNotesForPlaced(idx, n);

    saveState();
    render();

    // Check box/row/col completion animations
    checkBoxCompletion(idx);
    checkRowCompletion(idx);
    checkColCompletion(idx);

    // Check win
    if (checkWin()) {
        state.gameOver = true;
        saveState();
        showWinModal();
    }
}

function hasWrongCell() {
    return state.cells.some(c => c.wrong);
}

function numberExistsInPeers(idx, n) {
    const row = Math.floor(idx / 9), col = idx % 9;
    const boxRow = Math.floor(row / 3) * 3, boxCol = Math.floor(col / 3) * 3;
    const validVal = (i) => {
        const c = state.cells[i];
        return !c.wrong && c.val === n;
    };
    for (let j = 0; j < 9; j++) {
        if (validVal(row * 9 + j)) return true;
        if (validVal(j * 9 + col)) return true;
        const bi = (boxRow + Math.floor(j / 3)) * 9 + boxCol + (j % 3);
        if (validVal(bi)) return true;
    }
    return false;
}

function clearNotesForPlaced(placedIdx, n) {
    const row = Math.floor(placedIdx / 9);
    const col = placedIdx % 9;
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let j = 0; j < 9; j++) {
        state.cells[row * 9 + j].notes.delete(n);
        state.cells[j * 9 + col].notes.delete(n);
        const bi = (boxRow + Math.floor(j / 3)) * 9 + boxCol + (j % 3);
        state.cells[bi].notes.delete(n);
    }
}

function checkBoxCompletion(placedIdx) {
    const row = Math.floor(placedIdx / 9);
    const col = placedIdx % 9;
    const boxIdx = Math.floor(row / 3) * 3 + Math.floor(col / 3);
    if (state.completedBoxes[boxIdx]) return;

    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let j = 0; j < 9; j++) {
        const ci = (boxRow + Math.floor(j / 3)) * 9 + boxCol + (j % 3);
        if (state.cells[ci].val !== state.solution[ci]) return;
    }
    state.completedBoxes[boxIdx] = true;

    // Animate the box cells
    requestAnimationFrame(() => {
        const cells = document.querySelectorAll('.sudoku-cell');
        const boxRowStart = Math.floor(row / 3) * 3;
        const boxColStart = Math.floor(col / 3) * 3;
        for (let r = boxRowStart; r < boxRowStart + 3; r++) {
            for (let c = boxColStart; c < boxColStart + 3; c++) {
                const el = cells[r * 9 + c];
                el.classList.add('box-animate');
                setTimeout(() => el.classList.remove('box-animate'), 600);
            }
        }
    });
}

function animateCells(indices) {
    requestAnimationFrame(() => {
        const cells = document.querySelectorAll('.sudoku-cell');
        indices.forEach(i => {
            const el = cells[i];
            el.classList.add('box-animate');
            setTimeout(() => el.classList.remove('box-animate'), 600);
        });
    });
}

function checkRowCompletion(placedIdx) {
    const row = Math.floor(placedIdx / 9);
    const indices = Array.from({length: 9}, (_, j) => row * 9 + j);
    if (indices.every(i => state.cells[i].val === state.solution[i])) {
        animateCells(indices);
    }
}

function checkColCompletion(placedIdx) {
    const col = placedIdx % 9;
    const indices = Array.from({length: 9}, (_, j) => j * 9 + col);
    if (indices.every(i => state.cells[i].val === state.solution[i])) {
        animateCells(indices);
    }
}

function checkWin() {
    for (let i = 0; i < 81; i++) {
        if (state.cells[i].val !== state.solution[i]) return false;
    }
    return true;
}

// ── Undo ─────────────────────────────────────────────────────

function pushHistory() {
    state.history.push(state.cells.map(c => ({
        val: c.val,
        notes: new Set(c.notes),
        wrong: c.wrong
    })));
    // Keep history bounded
    if (state.history.length > 50) state.history.shift();
}

function doUndo() {
    if (state.history.length === 0) return;
    if (state.undosLeft <= 0) {
        showNoUndoModal();
        return;
    }
    state.undosLeft--;
    const prev = state.history.pop();
    state.cells = prev;
    saveState();
    render();
    // Close wrong modal if open
    document.getElementById('wrongModal').style.display = 'none';
    updateUndoBtn();
}

// ── Modals ───────────────────────────────────────────────────

function showWrongModal() {
    const d = DICT[lang];
    document.getElementById('wrong-title').textContent = d.wrongTitle;
    document.getElementById('wrong-msg').textContent = d.wrongMsg;
    document.getElementById('wrong-undos').textContent = d.undosLeft + state.undosLeft;
    document.getElementById('btn-undo-modal').textContent = d.undoBtn;
    document.getElementById('btn-new-wrong').textContent = d.dangerNewGame;
    document.getElementById('wrongModal').style.display = 'flex';
}

function showWinModal() {
    stopSudokuTimer();
    const d = DICT[lang];
    document.getElementById('win-title').textContent = d.winTitle;
    document.getElementById('win-msg').textContent = d.winMsg + ' ' + d.timeLabel + formatSudokuTime(state.timerElapsed);
    document.getElementById('btn-new-win').textContent = d.congrats;
    document.getElementById('winModal').style.display = 'flex';
    clearSavedState();
}

function showNoUndoModal() {
    stopSudokuTimer();
    const d = DICT[lang];
    document.getElementById('noundo-title').textContent = d.noUndoTitle;
    document.getElementById('noundo-msg').textContent = d.noUndoMsg + ' ' + d.timeLabel + formatSudokuTime(state.timerElapsed);
    document.getElementById('btn-continue-noundo').textContent = d.continueAnyway;
    document.getElementById('btn-new-noundo').textContent = d.congrats;
    document.getElementById('noUndoModal').style.display = 'flex';
    clearSavedState();
}

// ── UI Setup ─────────────────────────────────────────────────

function updateUI() {
    const d = DICT[lang];
    document.getElementById('ui-title').textContent = d.title;
    document.getElementById('btn-easy').textContent = d.easy;
    document.getElementById('btn-medium').textContent = d.medium;
    document.getElementById('btn-hard').textContent = d.hard;
    document.getElementById('btn-new').textContent = d.newGame;
    document.getElementById('btn-note').textContent = d.noteMode;
    document.getElementById('btn-smart').textContent = d.smart;
    document.documentElement.lang = lang;
    updateUndoBtn();
}

// ── IndexedDB ─────────────────────────────────────────────────

function initDB() {
    return new Promise(res => {
        const req = indexedDB.open('sudokuGameDB', 1);
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
    // Serialize Sets to arrays
    const serialized = {
        solution: state.solution,
        puzzle: state.puzzle,
        given: state.given,
        cells: state.cells.map(c => ({ val: c.val, notes: [...c.notes], wrong: c.wrong })),
        selected: state.selected,
        noteMode: state.noteMode,
        smartMode: state.smartMode,
        undosLeft: state.undosLeft,
        history: state.history.map(snap => snap.map(c => ({ val: c.val, notes: [...c.notes], wrong: c.wrong }))),
        difficulty: state.difficulty,
        gameOver: state.gameOver,
        completedBoxes: state.completedBoxes,
        timerElapsed: state.timerElapsed,
        lang
    };
    db.transaction('saves', 'readwrite').objectStore('saves').put({ id: 'current', data: JSON.stringify(serialized) });
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
                state.solution = s.solution;
                state.puzzle = s.puzzle;
                state.given = s.given;
                state.cells = s.cells.map(c => ({ val: c.val, notes: new Set(c.notes), wrong: c.wrong }));
                state.selected = s.selected;
                state.noteMode = s.noteMode || false;
                state.smartMode = s.smartMode || false;
                state.undosLeft = s.undosLeft !== undefined ? s.undosLeft : 3;
                state.history = (s.history || []).map(snap => snap.map(c => ({ val: c.val, notes: new Set(c.notes), wrong: c.wrong })));
                state.difficulty = s.difficulty || 'easy';
                state.gameOver = s.gameOver || false;
                state.completedBoxes = s.completedBoxes || Array(9).fill(false);
                state.timerElapsed = s.timerElapsed || 0;
                // Remove any stale notes that conflict with placed values
                for (let i = 0; i < 81; i++) {
                    if (state.cells[i].val === 0) {
                        state.cells[i].notes.forEach(n => {
                            if (numberExistsInPeers(i, n)) state.cells[i].notes.delete(n);
                        });
                    }
                }
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
        if (loaded && state.solution) {
            updateDiffButtons(state.difficulty);
            updateNoteBtn();
            updateSmartBtn();
            updateSudokuTimerDisplay();
            render();
            // Resume timer if game was in progress
            if (!state.gameOver && state.timerElapsed > 0) startSudokuTimer();
        } else {
            initGame('easy');
        }
    }));

    // Language picker
    document.getElementById('langPicker').addEventListener('change', e => {
        lang = e.target.value;
        saveState();
        updateUI();
        render();
    });

    // Difficulty
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.difficulty === btn.dataset.diff) return;
            initGame(btn.dataset.diff);
        });
    });

    // New game
    document.getElementById('btn-new').addEventListener('click', () => {
        initGame(state.difficulty);
    });

    // Undo
    document.getElementById('btn-undo').addEventListener('click', doUndo);

    // Note mode toggle
    document.getElementById('btn-note').addEventListener('click', () => {
        state.noteMode = !state.noteMode;
        updateNoteBtn();
        saveState();
    });

    // Smart annotations toggle
    document.getElementById('btn-smart').addEventListener('click', () => {
        state.smartMode = !state.smartMode;
        updateSmartBtn();
        saveState();
        render();
    });

    // Numpad
    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            handleNumpad(parseInt(btn.dataset.num));
        });
    });

    // Prevent any keyboard input
    document.addEventListener('keydown', e => e.preventDefault());

    // Wrong modal buttons
    document.getElementById('btn-undo-modal').addEventListener('click', () => {
        if (state.undosLeft <= 0) {
            document.getElementById('wrongModal').style.display = 'none';
            showNoUndoModal();
        } else {
            doUndo();
        }
    });
    document.getElementById('btn-new-wrong').addEventListener('click', () => {
        document.getElementById('wrongModal').style.display = 'none';
        initGame(state.difficulty);
    });
    // Win modal
    document.getElementById('btn-new-win').addEventListener('click', () => {
        document.getElementById('winModal').style.display = 'none';
        initGame(state.difficulty);
    });

    // No undo modal
    document.getElementById('btn-continue-noundo').addEventListener('click', () => {
        document.getElementById('noUndoModal').style.display = 'none';
        // Timer already stopped; game is still playable (just no undos left)
        startSudokuTimer();
    });
    document.getElementById('btn-new-noundo').addEventListener('click', () => {
        document.getElementById('noUndoModal').style.display = 'none';
        initGame(state.difficulty);
    });
});
