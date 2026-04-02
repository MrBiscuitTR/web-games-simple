/**
 * TAVLA ONLINE — Firebase Firestore real-time multiplayer
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getFirestore, doc, setDoc, updateDoc, onSnapshot, serverTimestamp, getDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyAqELbK3THW2rmnKW4jsrEUijXuxx3bFDU",
    authDomain: "online-games-sync.firebaseapp.com",
    projectId: "online-games-sync",
    storageBucket: "online-games-sync.firebasestorage.app",
    messagingSenderId: "405886206510",
    appId: "1:405886206510:web:03cce79d338056381395bf"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ─── State ────────────────────────────────────────────────────────────────────
let myName = '';
let myPlayerNum = null;  // 1 or 2
let lobbyId = null;
let gameMode = 'erkek';
let unsubLobby = null;
let gameStarted = false;
let iAmPushing = false;  // true while we are mid-push, to skip echo

let gameState = {
    mode: 'erkek', turn: 1,
    board: Array(25).fill(null).map(() => ({ 1: 0, 2: 0 })),
    bar: { 1: 0, 2: 0 }, bearOff: { 1: 0, 2: 0 },
    dice: [], movesLeft: [], moveLog: [],
    scores: { 1: 0, 2: 0 }, gameOver: false
};
let selectedPoint = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function myTurn() { return gameState.turn === myPlayerNum; }
function oppNum() { return myPlayerNum === 1 ? 2 : 1; }

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
window.setMode = function(m) {
    gameMode = m;
    document.getElementById('btnErkek').className = m === 'erkek' ? 'active' : '';
    document.getElementById('btnKiz').className   = m === 'kiz'   ? 'active' : '';
};

window.createLobby = async function() {
    myName = document.getElementById('playerNameInput').value.trim() || 'Player 1';
    myPlayerNum = 1;
    lobbyId = genCode();
    setStatus('Creating...');
    try {
        await setDoc(doc(db, 'tavla_lobbies', lobbyId), {
            mode: gameMode, player1: myName, player2: null,
            state: null, newGameRequests: {}, createdAt: serverTimestamp()
        });
        document.getElementById('lobbyCode').style.display = 'flex';
        document.getElementById('lobbyCodeVal').innerText = lobbyId;
        document.getElementById('waitingMsg').style.display = 'flex';
        setStatus('');
        subscribe();
    } catch (e) { setStatus('Error: ' + e.message); }
};

window.joinLobby = async function() {
    const name = document.getElementById('playerNameInput').value.trim() || 'Player 2';
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (!code) { setStatus('Enter a code.'); return; }
    setStatus('Joining...');
    try {
        const snap = await getDoc(doc(db, 'tavla_lobbies', code));
        if (!snap.exists()) { setStatus('Lobby not found.'); return; }
        const d = snap.data();
        if (d.player2) { setStatus('Lobby full.'); return; }
        myName = name; myPlayerNum = 2; lobbyId = code; gameMode = d.mode;
        await updateDoc(doc(db, 'tavla_lobbies', code), { player2: name });
        setStatus('');
        subscribe();
    } catch (e) { setStatus('Error: ' + e.message); }
};

window.copyCode = function() {
    navigator.clipboard?.writeText(lobbyId).catch(() => {});
    const b = document.querySelector('.copy-btn');
    b.innerText = 'Copied!'; setTimeout(() => b.innerText = 'Copy', 1500);
};

function setStatus(msg) { document.getElementById('lobbyStatus').innerText = msg; }

// ─── Subscription ─────────────────────────────────────────────────────────────
function subscribe() {
    if (unsubLobby) unsubLobby();
    unsubLobby = onSnapshot(doc(db, 'tavla_lobbies', lobbyId), snap => {
        if (!snap.exists()) {
            if (document.getElementById('gameScreen').style.display !== 'none') {
                alert('Opponent left.'); window.leaveGame();
            }
            return;
        }
        const data = snap.data();

        if (!gameStarted) {
            if (data.player1 && data.player2) startGame(data);
            return;
        }

        // ── in-game ──
        if (iAmPushing) return; // skip our own echo

        // new-game request handling
        const oppKey = `p${oppNum()}`, myKey = `p${myPlayerNum}`;
        if (data.newGameRequests?.[oppKey] && !data.newGameRequests?.[myKey]) {
            const m = document.getElementById('newGameModal');
            if (m.style.display !== 'flex') m.style.display = 'flex';
        }
        if (data.newGameRequests?.[oppKey] && data.newGameRequests?.[myKey]) {
            document.getElementById('newGameModal').style.display = 'none';
            document.getElementById('winModal').style.display = 'none';
            if (myPlayerNum === 1) {
                initBoard(true); pushState();
                updateDoc(doc(db, 'tavla_lobbies', lobbyId), { newGameRequests: {} });
            }
            return;
        }

        if (!data.state) return;
        applyRemoteState(data.state);
    }, err => { setBadge(false); console.error(err); });
}

// ─── Game start ───────────────────────────────────────────────────────────────
function startGame(lobbyData) {
    gameStarted = true;
    gameMode = lobbyData.mode || gameMode;

    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display  = 'flex';
    document.getElementById('modeDisplay').innerText =
        gameMode === 'erkek' ? 'Erkek Tavlası' : 'Kız Tavlası';

    const p1 = lobbyData.player1, p2 = lobbyData.player2;
    document.getElementById('scoreLabel1').innerText = myPlayerNum === 1 ? `${p1} (You)` : p1;
    document.getElementById('scoreLabel2').innerText = myPlayerNum === 2 ? `${p2} (You)` : p2;

    if (window.innerWidth > 768)
        document.querySelectorAll('details.mobile-details').forEach(d => d.open = true);

    // attach non-roll listeners once
    document.getElementById('rulesIcon').onclick = () =>
        document.getElementById('rulesModal').style.display = 'flex';
    window.addEventListener('click', e => {
        if (e.target === document.getElementById('rulesModal'))
            document.getElementById('rulesModal').style.display = 'none';
    });
    document.getElementById('off-p1').onclick = () => handlePointClick('off-1');
    document.getElementById('off-p2').onclick = () => handlePointClick('off-2');

    if (lobbyData.state) {
        applyRemoteState(lobbyData.state);
    } else if (myPlayerNum === 1) {
        // host: init board immediately (gameScreen is already visible)
        initBoard();
        pushState();
    }
    // guest with no state: waits for next snapshot
}

// ─── Push / apply ─────────────────────────────────────────────────────────────
async function pushState() {
    if (!lobbyId) return;
    iAmPushing = true;
    const s = {
        mode: gameState.mode, turn: gameState.turn,
        board: gameState.board, bar: gameState.bar, bearOff: gameState.bearOff,
        dice: gameState.dice, movesLeft: gameState.movesLeft,
        moveLog: gameState.moveLog.slice(-30),
        scores: gameState.scores, gameOver: gameState.gameOver
    };
    try { await updateDoc(doc(db, 'tavla_lobbies', lobbyId), { state: s }); }
    catch (e) { console.error('push failed:', e); }
    // Give Firestore time to deliver the echo, then re-open for opponent updates
    setTimeout(() => { iAmPushing = false; }, 1000);
}

function applyRemoteState(r) {
    const prevDice = JSON.stringify(gameState.dice);
    gameState.mode     = r.mode || gameMode;
    gameState.turn     = r.turn;
    // Firestore may return board as array or object — normalise to array of {1,2}
    gameState.board    = normaliseBoard(r.board);
    gameState.bar      = normalise12(r.bar);
    gameState.bearOff  = normalise12(r.bearOff);
    gameState.dice     = Array.isArray(r.dice)      ? r.dice      : [];
    gameState.movesLeft = Array.isArray(r.movesLeft) ? r.movesLeft : [];
    gameState.moveLog  = Array.isArray(r.moveLog)   ? r.moveLog   : [];
    gameState.scores   = normalise12(r.scores) || { 1: 0, 2: 0 };
    gameState.gameOver = r.gameOver || false;

    const diceChanged  = prevDice !== JSON.stringify(gameState.dice) && gameState.dice.length === 2;
    selectedPoint = null;
    renderAll(diceChanged && !myTurn());

    if (gameState.gameOver) showWinModal(gameState.bearOff[1] === 15 ? 1 : 2);
}

// Firestore returns map keys as strings; coerce back to numeric so {1:n,2:n} works
function normalise12(obj) {
    if (!obj) return { 1: 0, 2: 0 };
    return { 1: obj[1] ?? obj['1'] ?? 0, 2: obj[2] ?? obj['2'] ?? 0 };
}

function normaliseBoard(board) {
    const arr = Array(25).fill(null).map(() => ({ 1: 0, 2: 0 }));
    if (!board) return arr;
    // board may be a Firestore array or an object with string/numeric indices
    const src = Array.isArray(board) ? board : Object.values(board);
    src.forEach((cell, i) => {
        if (i < 25 && cell) arr[i] = { 1: cell[1] ?? cell['1'] ?? 0, 2: cell[2] ?? cell['2'] ?? 0 };
    });
    return arr;
}

// ─── Board init ───────────────────────────────────────────────────────────────
function initBoard(keepScores = false) {
    const scores = keepScores ? { ...gameState.scores } : { 1: 0, 2: 0 };
    gameState = {
        mode: gameMode, turn: 1,
        board: Array(25).fill(null).map(() => ({ 1: 0, 2: 0 })),
        bar: { 1: 0, 2: 0 }, bearOff: { 1: 0, 2: 0 },
        dice: [], movesLeft: [], moveLog: [],
        scores, gameOver: false
    };
    selectedPoint = null;
    [
        { pt: 24, p: 1, c: 2 }, { pt: 13, p: 1, c: 5 },
        { pt:  8, p: 1, c: 3 }, { pt:  6, p: 1, c: 5 },
        { pt:  1, p: 2, c: 2 }, { pt: 12, p: 2, c: 5 },
        { pt: 17, p: 2, c: 3 }, { pt: 19, p: 2, c: 5 }
    ].forEach(s => { gameState.board[s.pt][s.p] = s.c; });
    renderAll(false);
}

// ─── Roll dice ────────────────────────────────────────────────────────────────
window.rollDice = function() {
    if (!myTurn() || gameState.gameOver || gameState.movesLeft.length > 0) return;
    const d1 = Math.ceil(Math.random() * 6), d2 = Math.ceil(Math.random() * 6);
    gameState.dice     = [d1, d2];
    gameState.movesLeft = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    logMove(`${myName} rolled ${d1}-${d2}`);

    const dd = document.getElementById('diceDisplay');
    dd.innerHTML = '';
    dd.appendChild(makeDie(d1, true));
    dd.appendChild(makeDie(d2, true));

    setTimeout(() => { checkNoMoves(); renderAll(false); pushState(); }, 500);
};

// ─── Point click ──────────────────────────────────────────────────────────────
function handlePointClick(pointId) {
    if (!myTurn() || gameState.gameOver || gameState.movesLeft.length === 0) return;
    const p = gameState.turn;

    if (selectedPoint) {
        if (legalMovesFrom(selectedPoint).includes(pointId)) {
            moveChecker(selectedPoint, pointId);
            return;
        }
    }

    let own = false;
    if (pointId === `bar-${p}` && gameState.bar[p] > 0) own = true;
    else if (!pointId.startsWith('bar') && !pointId.startsWith('off')) {
        if (gameState.board[+pointId]?.[p] > 0) own = true;
    }
    if (own) { selectedPoint = selectedPoint === pointId ? null : pointId; renderAll(false); }
}

function moveChecker(from, to) {
    const p = gameState.turn;
    const fi = from.startsWith('bar') ? (p === 1 ? 25 : 0) : +from;
    const ti = to.startsWith('off')   ? (p === 1 ?  0 : 25) : +to;
    const dist = Math.abs(fi - ti);

    let di = gameState.movesLeft.indexOf(dist);
    if (di === -1 && to.startsWith('off')) di = gameState.movesLeft.findIndex(d => d >= dist);
    if (di === -1) di = 0;
    gameState.movesLeft.splice(di, 1);

    if (from.startsWith('bar')) gameState.bar[p]--;
    else gameState.board[fi][p]--;

    if (to.startsWith('off')) {
        gameState.bearOff[p]++;
    } else {
        const dest = gameState.board[ti], opp = p === 1 ? 2 : 1;
        if (gameState.mode === 'erkek' && dest[opp] === 1) { gameState.bar[opp]++; dest[opp] = 0; }
        dest[p]++;
    }

    logMove(`P${p}: ${from} → ${to}`);
    selectedPoint = null;
    if (checkWin(p)) return;
    checkNoMoves();
    renderAll(false);
    pushState();
}

function legalMovesFrom(pt) {
    if (gameState.movesLeft.length === 0) return [];
    const p = gameState.turn;
    let si;
    if (gameState.bar[p] > 0) {
        if (!pt.startsWith('bar')) return [];
        si = p === 1 ? 25 : 0;
    } else {
        if (pt.startsWith('bar')) return [];
        si = +pt;
        if (!gameState.board[si]?.[p]) return [];
    }
    const dir = p === 1 ? -1 : 1;
    const dests = [];
    [...new Set(gameState.movesLeft)].forEach(die => {
        const dest = si + dir * die;
        if ((p === 1 && dest <= 0) || (p === 2 && dest >= 25)) {
            if (canBearOff(p)) dests.push(`off-${p}`);
        } else if (dest >= 1 && dest <= 24) {
            const cell = gameState.board[dest], opp = p === 1 ? 2 : 1;
            if (gameState.mode === 'kiz' || cell[opp] <= 1) dests.push(String(dest));
        }
    });
    return dests;
}

function canBearOff(p) {
    if (gameState.bar[p] > 0) return false;
    for (let i = 1; i <= 24; i++) {
        if (gameState.board[i][p] > 0) {
            if (p === 1 && i > 6)  return false;
            if (p === 2 && i < 19) return false;
        }
    }
    return true;
}

function checkWin(p) {
    if (gameState.bearOff[p] !== 15) return false;
    const opp = p === 1 ? 2 : 1;
    let pts = 1, label = 'Normal win (+1)';
    if (gameState.bearOff[opp] === 0) {
        let katmerli = gameState.bar[opp] > 0;
        if (!katmerli) {
            const [s, e] = p === 1 ? [19, 24] : [1, 6];
            for (let i = s; i <= e; i++) if (gameState.board[i][opp] > 0) { katmerli = true; break; }
        }
        pts = katmerli ? 3 : 2; label = katmerli ? 'Katmerli Mars! (+3)' : 'Mars! (+2)';
    }
    gameState.scores[p] += pts;
    gameState.gameOver = true;
    gameState.movesLeft = [];
    logMove(`Player ${p} wins! ${label}`);
    pushState();
    showWinModal(p, label);
    return true;
}

function checkNoMoves() {
    if (gameState.movesLeft.length === 0) { endTurn(); return; }
    const p = gameState.turn;
    let has = gameState.bar[p] > 0
        ? legalMovesFrom(`bar-${p}`).length > 0
        : Array.from({ length: 24 }, (_, i) => i + 1)
            .some(i => gameState.board[i][p] > 0 && legalMovesFrom(String(i)).length > 0);
    if (!has) { logMove(`Player ${p} has no moves.`); gameState.movesLeft = []; endTurn(); }
}

function endTurn() { gameState.turn = gameState.turn === 1 ? 2 : 1; }
function logMove(msg) { gameState.moveLog.push(msg); }

function showWinModal(p, detail) {
    document.getElementById('winModalTitle').innerText = p === myPlayerNum ? '🏆 You Win!' : 'Opponent Wins!';
    document.getElementById('winModalMsg').innerText = detail || '';
    document.getElementById('winModal').style.display = 'flex';
}

// ─── New game ─────────────────────────────────────────────────────────────────
window.requestNewGame = async function() {
    if (!lobbyId) return;
    const upd = {}; upd[`newGameRequests.p${myPlayerNum}`] = true;
    await updateDoc(doc(db, 'tavla_lobbies', lobbyId), upd);
    document.getElementById('winModal').style.display = 'none';
};
window.respondNewGame = async function(accept) {
    document.getElementById('newGameModal').style.display = 'none';
    if (accept) await window.requestNewGame();
};
window.leaveGame = async function() {
    if (unsubLobby) { unsubLobby(); unsubLobby = null; }
    if (lobbyId) { try { await deleteDoc(doc(db, 'tavla_lobbies', lobbyId)); } catch (_) {} lobbyId = null; }
    gameStarted = false;
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('lobbyScreen').style.display = 'flex';
    myPlayerNum = null;
};

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll(animDice = false) {
    renderBoard();
    updateUI(animDice);
}

function renderBoard() {
    document.querySelectorAll('.row').forEach(el => el.innerHTML = '');
    ['bar-p1','bar-p2','off-p1','off-p2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = ''; el.classList.remove('highlight'); }
    });

    const quads = {
        'quad-tl': [13,14,15,16,17,18], 'quad-tr': [19,20,21,22,23,24],
        'quad-bl': [12,11,10, 9, 8, 7], 'quad-br': [ 6, 5, 4, 3, 2, 1]
    };
    const legal = selectedPoint ? legalMovesFrom(selectedPoint) : [];

    for (const [qId, idxs] of Object.entries(quads)) {
        const container = document.getElementById(qId);
        idxs.forEach((idx, pos) => {
            const pt = document.createElement('div');
            pt.className = `point ${pos % 2 === 0 ? 'dark' : 'light'}`;
            if (legal.includes(String(idx))) pt.classList.add('highlight');

            const num = document.createElement('span');
            num.className = 'point-number'; num.innerText = idx;
            pt.appendChild(num);
            pt.onclick = () => handlePointClick(String(idx));

            const cell = gameState.board[idx];
            const cc = document.createElement('div');
            cc.className = 'checker-container';
            let has = false;
            [1, 2].forEach(pn => {
                for (let c = 0; c < cell[pn]; c++) {
                    has = true;
                    const ch = document.createElement('div');
                    ch.className = `checker p${pn}`;
                    if (selectedPoint === String(idx) && pn === gameState.turn && c === cell[pn]-1) ch.classList.add('selected');
                    cc.appendChild(ch);
                }
            });
            if (has) pt.appendChild(cc);
            container.appendChild(pt);
        });
    }

    // bar
    [1, 2].forEach(p => {
        const el = document.getElementById(`bar-p${p}`);
        if (!el) return;
        const id = `bar-${p}`;
        if (legal.includes(id)) el.classList.add('highlight');
        for (let i = 0; i < gameState.bar[p]; i++) {
            const ch = document.createElement('div');
            ch.className = `checker p${p}`;
            if (selectedPoint === id && i === gameState.bar[p]-1) ch.classList.add('selected');
            ch.onclick = e => { e.stopPropagation(); handlePointClick(id); };
            el.appendChild(ch);
        }
    });

    // bear-off
    [1, 2].forEach(p => {
        const el = document.getElementById(`off-p${p}`);
        if (!el) return;
        const id = `off-${p}`;
        if (legal.includes(id)) el.classList.add('highlight');
        if (gameState.bearOff[p] > 0) {
            const lbl = document.createElement('div');
            lbl.className = 'bear-off-count';
            lbl.innerText = `${gameState.bearOff[p]}/15`;
            el.appendChild(lbl);
        }
    });
}

function updateUI(animDice = false) {
    const isMe = myTurn();

    const btn = document.getElementById('btnRoll');
    if (btn) {
        btn.disabled  = !isMe || gameState.movesLeft.length > 0 || gameState.gameOver;
        btn.className = 'action-btn' + (isMe && !gameState.movesLeft.length && !gameState.gameOver ? ' highlight' : '');
    }

    const ti = document.getElementById('turnIndicator');
    if (ti) ti.innerText = isMe ? 'Your turn' : "Opponent's turn";

    const sp1 = document.getElementById('scoreP1');
    if (sp1) sp1.innerText = gameState.scores[1];

    const sp2 = document.getElementById('scoreP2');
    if (sp2) sp2.innerText = gameState.scores[2];

    const log = document.getElementById('historyLog');
    if (log) log.innerHTML = gameState.moveLog.slice(-15).reverse().join('<br>');

    const dd = document.getElementById('diceDisplay');
    if (dd) {
        dd.innerHTML = '';
        if (gameState.dice.length === 2) {
            const rem = [...gameState.movesLeft];
            gameState.dice.forEach(v => {
                const el = makeDie(v, animDice);
                const i = rem.indexOf(v);
                if (i === -1) el.classList.add('used'); else rem.splice(i, 1);
                dd.appendChild(el);
            });
        }
    }
}

function makeDie(v, animate) {
    const d = document.createElement('div');
    d.className = 'die' + (animate ? ' rolling' : '');
    const dots = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };
    for (let i = 0; i < 9; i++) {
        const s = document.createElement('span');
        if (!dots[v].includes(i)) s.style.opacity = 0;
        d.appendChild(s);
    }
    return d;
}

function setBadge(ok) {
    const b = document.getElementById('connectionBadge');
    if (!b) return;
    b.className = 'conn-badge ' + (ok ? 'conn-ok' : 'conn-warn');
    b.innerText  = ok ? '● Connected' : '● Reconnecting...';
}
