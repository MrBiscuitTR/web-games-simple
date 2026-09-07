/**
 * TEXAS HOLD'EM POKER — Offline + Firebase Online Multiplayer
 * Features: offline bots, online lobbies, session tracking, full hand eval,
 * side pots, showdown, chip animations, move logging to Firestore.
 *
 * Online authority model:
 *   - Host is the authoritative dealer: runs all game logic, pushes state.
 *   - Non-hosts only apply remote state from Firestore; they never run game logic.
 *   - Each non-host shows their own action bar only when `activeIdx === myUID`.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getFirestore, doc, setDoc, updateDoc, onSnapshot, serverTimestamp,
    getDoc, deleteDoc, addDoc, collection
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─── Firebase ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAqELbK3THW2rmnKW4jsrEUijXuxx3bFDU",
    authDomain: "online-games-sync.firebaseapp.com",
    projectId: "online-games-sync",
    storageBucket: "online-games-sync.firebasestorage.app",
    messagingSenderId: "405886206510",
    appId: "1:405886206510:web:03cce79d338056381395bf"
};
const fbApp = initializeApp(firebaseConfig);
const fdb = getFirestore(fbApp);

// ─── Constants ────────────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const SMALL_BLIND = 25;
const BIG_BLIND = 50;
const BOT_THINK_MS = 900;
const TURN_TIMEOUT_S = 30;

// ─── Modes ────────────────────────────────────────────────────────────────────
let isOnline = false;
let amHost = false;
let myUID = null;       // seat index in online game
let myName = '';
let lobbyId = null;
let unsubLobby = null;
// Track last pushed state string to skip echo-backs
let lastPushedStateStr = '';
// Track last processed pending action timestamp (host only)
let lastProcessedActionTs = 0;

// ─── Game state ───────────────────────────────────────────────────────────────
let G = null;          // Full game state object
let gameStarted = false; // Whether game has transitioned from lobby to play
let turnTimer = null;
let sessionMoves = []; // For Firestore logging
let sessionStartTime = null;
let botTimeouts = [];

// ─── IndexedDB (offline only) ─────────────────────────────────────────────────
let pokerDB = null;
function initPokerDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open('pokerGameDB', 1);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore('saves', { keyPath: 'id' });
        };
        req.onsuccess = (e) => { pokerDB = e.target.result; resolve(); };
        req.onerror = () => resolve(); // non-fatal
    });
}
function savePokerState() {
    if (!pokerDB || isOnline || !G) return;
    // Don't persist mid-showdown — restore to start of next round
    if (G.stage === 'showdown') return;
    const tx = pokerDB.transaction('saves', 'readwrite');
    tx.objectStore('saves').put({ id: 'current', myUID, myName, state: JSON.stringify(G) });
}
function loadPokerState() {
    return new Promise((resolve) => {
        if (!pokerDB) return resolve(null);
        const tx = pokerDB.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get('current');
        req.onsuccess = () => {
            if (req.result) {
                try { resolve({ myUID: req.result.myUID, myName: req.result.myName, state: JSON.parse(req.result.state) }); }
                catch { resolve(null); }
            } else resolve(null);
        };
        req.onerror = () => resolve(null);
    });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
window.showTab = (tab) => {
    document.getElementById('tabOfflineContent').style.display = tab === 'offline' ? 'flex' : 'none';
    document.getElementById('tabOnlineContent').style.display = tab === 'online' ? 'flex' : 'none';
    document.getElementById('tabOffline').className = tab === 'offline' ? 'tab-btn active' : 'tab-btn';
    document.getElementById('tabOnline').className = tab === 'online' ? 'tab-btn active' : 'tab-btn';
};

window.toggleMenu = () => {
    const o = document.getElementById('menuOverlay');
    o.style.display = o.style.display === 'none' ? 'flex' : 'none';
};

window.showRules = () => {
    document.getElementById('menuOverlay').style.display = 'none';
    document.getElementById('rulesModal').style.display = 'flex';
};

window.confirmRestart = () => {
    if (confirm('Start a new session? Current stacks will reset.')) {
        document.getElementById('menuOverlay').style.display = 'none';
        if (isOnline) {
            if (amHost) hostStartOnlineGame();
        } else {
            startOfflineGame();
        }
    }
};

// ─── OFFLINE START ────────────────────────────────────────────────────────────
window.startOfflineGame = async () => {
    const name = document.getElementById('offlineName').value.trim() || 'You';
    const stack = parseInt(document.getElementById('startingStack').value) || 1000;
    const bots = parseInt(document.getElementById('botCount').value) || 2;
    isOnline = false;
    myUID = 0;
    myName = name;

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';
    document.getElementById('menuLeave').style.display = 'none';
    document.getElementById('onlineIndicator').style.display = 'none';

    await initPokerDB();

    // Try to restore saved session
    const saved = await loadPokerState();
    if (saved && saved.state && saved.state.players) {
        myUID = saved.myUID;
        myName = saved.myName;
        G = saved.state;
        G.stage = 'preflop';
        sessionMoves = [];
        sessionStartTime = Date.now();
        renderGame();
        startRound();
        return;
    }

    const players = [{ id: 0, name, stack, isBot: false, isHuman: true }];
    const botNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy'];
    for (let i = 0; i < bots; i++) {
        players.push({ id: i + 1, name: botNames[i], stack, isBot: true, isHuman: false });
    }
    initSession(players);
};

// ─── ONLINE LOBBY ─────────────────────────────────────────────────────────────
window.createOnlineLobby = async () => {
    const name = document.getElementById('onlineName').value.trim() || 'Host';
    myName = name;
    amHost = true;
    myUID = 0;
    isOnline = true;
    lobbyId = genCode();

    setOnlineStatus('Creating lobby...');
    try {
        await setDoc(doc(fdb, 'poker_lobbies', lobbyId), {
            host: name,
            players: [{ id: 0, name, isBot: false }],
            started: false,
            state: null,
            pendingAction: null,
            createdAt: serverTimestamp()
        });
        document.getElementById('onlineLobbyCode').style.display = 'flex';
        document.getElementById('onlineLobbyCodeVal').innerText = lobbyId;
        document.getElementById('onlineBotRow').style.display = 'flex';
        document.getElementById('onlineStartGameBtn').style.display = 'block';
        document.getElementById('onlinePlayerList').style.display = 'flex';
        setOnlineStatus('');
        subscribeLobby(lobbyId);
    } catch (e) { setOnlineStatus('Error: ' + e.message); }
};

window.joinOnlineLobby = async () => {
    const name = document.getElementById('onlineName').value.trim() || 'Player';
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    if (!code) { setOnlineStatus('Enter a lobby code.'); return; }
    setOnlineStatus('Joining...');
    try {
        const ref = doc(fdb, 'poker_lobbies', code);
        const snap = await getDoc(ref);
        if (!snap.exists()) { setOnlineStatus('Lobby not found.'); return; }
        const data = snap.data();
        if (data.started) { setOnlineStatus('Game already started.'); return; }
        if (data.players.length >= 10) { setOnlineStatus('Lobby is full (10 players max).'); return; }

        myUID = data.players.length;
        myName = name;
        amHost = false;
        isOnline = true;
        lobbyId = code;

        const newPlayers = [...data.players, { id: myUID, name, isBot: false }];
        await updateDoc(ref, { players: newPlayers });
        setOnlineStatus('');
        document.getElementById('onlinePlayerList').style.display = 'flex';
        document.getElementById('onlineWaitMsg').style.display = 'flex';
        subscribeLobby(code);
    } catch (e) { setOnlineStatus('Error: ' + e.message); }
};

window.hostStartOnlineGame = async () => {
    if (!lobbyId || !amHost) return;
    const stack = 1000;
    const snap = await getDoc(doc(fdb, 'poker_lobbies', lobbyId));
    const data = snap.data();
    let players = data.players.map((p, i) => ({ id: i, name: p.name, stack, isBot: p.isBot || false, isHuman: !p.isBot }));

    const botCount = parseInt(document.getElementById('onlineBotCount').value) || 0;
    const botNames = ['Bot-A', 'Bot-B', 'Bot-C', 'Bot-D', 'Bot-E', 'Bot-F', 'Bot-G', 'Bot-H'];
    for (let i = 0; i < botCount && players.length < 10; i++) {
        players.push({ id: players.length, name: botNames[i], stack, isBot: true, isHuman: false });
    }

    await updateDoc(doc(fdb, 'poker_lobbies', lobbyId), { started: true, players });
};

// ─── SINGLE SUBSCRIBE FUNCTION ────────────────────────────────────────────────
// Both createOnlineLobby and joinOnlineLobby call this.
// Host: processes pendingAction from non-host players.
// Non-host: applies remote state from host.
function subscribeLobby(code) {
    if (unsubLobby) unsubLobby();

    unsubLobby = onSnapshot(doc(fdb, 'poker_lobbies', code), (snap) => {
        if (!snap.exists()) {
            alert('Lobby closed.'); window.location.reload(); return;
        }
        const data = snap.data();

        // Update player list while still on the lobby/start screen
        if (document.getElementById('startScreen').style.display !== 'none') {
            updateOnlinePlayerList(data.players || []);
        }

        if (!gameStarted) {
            // Waiting for host to mark the game started
            if (data.started) {
                gameStarted = true;
                startOnlineGame(data);
            }
            return;
        }

        // Game is running
        if (document.getElementById('gameScreen').style.display !== 'none') {
            if (amHost) {
                // Host processes pending actions submitted by non-host human players
                if (data.pendingAction) {
                    handlePendingAction(data);
                }
            } else {
                // Non-host: apply whatever state the host just pushed
                if (data.state) {
                    applyRemoteState(data.state);
                }
            }
        }
    });
}

// Transition from lobby to game screen and initialise the session
function startOnlineGame(data) {
    const stack = 1000;
    const players = (data.players || []).map((p, i) => ({
        id: i, name: p.name, stack,
        isBot: p.isBot || false, isHuman: !p.isBot
    }));
    console.log('[startOnlineGame] amHost=', amHost, 'myUID=', myUID, 'players=', players.map(p => p.name));

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';
    document.getElementById('menuLeave').style.display = 'block';
    document.getElementById('onlineIndicator').style.display = 'flex';

    if (amHost) {
        // Host runs full game logic — shuffle, deal, advance stages, run bots
        initSession(players);
    } else {
        // Non-host: set up G skeleton, wait for host to push state
        initSessionPassive(players);
    }
}

// Non-host initializes G with player skeletons, waits for host state
function initSessionPassive(players) {
    sessionMoves = [];
    sessionStartTime = Date.now();
    G = {
        players: players.map(p => ({ ...p, holeCards: [], bet: 0, folded: false, allIn: false, showHand: false, _actedThisStreet: false })),
        deck: [],
        community: [],
        pot: 0,
        sidePots: [],
        dealerIdx: 0,
        stage: 'waiting',
        activeIdx: -1,
        currentBet: 0,
        round: 0,
        sessionOver: false
    };
    renderGame();
}

function updateOnlinePlayerList(players) {
    const list = document.getElementById('onlinePlayerList');
    if (!list || list.style.display === 'none') return;
    list.innerHTML = players.map(p =>
        `<div class="player-list-item"><div class="player-dot"></div>${p.name}${p.isBot ? ' 🤖' : ''}</div>`
    ).join('');
}

window.copyOnlineCode = () => {
    navigator.clipboard?.writeText(lobbyId).catch(() => {});
    const btn = document.querySelector('.copy-btn');
    if (btn) { btn.innerText = 'Copied!'; setTimeout(() => btn.innerText = 'Copy', 1500); }
};

window.leaveOnlineGame = async () => {
    if (confirm('Leave the game?')) {
        if (unsubLobby) { unsubLobby(); unsubLobby = null; }
        if (lobbyId && amHost) {
            try { await deleteDoc(doc(fdb, 'poker_lobbies', lobbyId)); } catch (_) {}
        }
        window.location.reload();
    }
};

function setOnlineStatus(msg) {
    const el = document.getElementById('onlineStatus');
    if (el) el.innerText = msg;
}

// ─── SESSION INIT ─────────────────────────────────────────────────────────────
function initSession(players) {
    sessionMoves = [];
    sessionStartTime = Date.now();
    G = {
        players: players.map(p => ({ ...p, holeCards: [], bet: 0, folded: false, allIn: false, showHand: false })),
        deck: [],
        community: [],
        pot: 0,
        sidePots: [],
        dealerIdx: 0,
        stage: 'waiting',
        activeIdx: -1,
        currentBet: 0,
        round: 0,
        sessionOver: false
    };
    startRound();
}

// ─── ROUND MANAGEMENT ─────────────────────────────────────────────────────────
function startRound() {
    lastPushedStateStr = '';
    // Reset render caches so new cards are drawn fresh
    const area = document.getElementById('myCardsArea');
    if (area) { area.innerHTML = ''; area.dataset.cardKey = ''; }
    const ring = document.getElementById('playersRing');
    if (ring) ring.innerHTML = ''; // force skeleton rebuild on new round
    clearBotTimeouts();
    clearTurnTimer();
    G.round++;
    G.deck = shuffle(buildDeck());
    G.community = [];
    G.pot = 0;
    G.sidePots = [];
    G.stage = 'preflop';
    G.currentBet = BIG_BLIND;

    G.players.forEach(p => {
        p.holeCards = [];
        p.bet = 0;
        p.folded = p.stack <= 0;
        p.allIn = false;
        p.showHand = false;
        p._actedThisStreet = false;
    });

    const alive = G.players.filter(p => p.stack > 0);
    if (alive.length <= 1) { endSession(); return; }

    do { G.dealerIdx = (G.dealerIdx + 1) % G.players.length; }
    while (G.players[G.dealerIdx].stack <= 0);

    const activePlayers = getActivePlayers();
    if (activePlayers.length < 2) { endSession(); return; }

    const sbIdx = nextActiveFrom((G.dealerIdx + 1) % G.players.length);
    const bbIdx = nextActiveFrom((sbIdx + 1) % G.players.length);

    postBlind(sbIdx, SMALL_BLIND);
    postBlind(bbIdx, BIG_BLIND);

    G.players.forEach(p => {
        if (!p.folded) { p.holeCards = [dealCard(), dealCard()]; }
    });

    G.players.forEach(p => { p._actedThisStreet = false; });

    G.activeIdx = nextActiveFrom((bbIdx + 1) % G.players.length);

    if (isOnline) pushOnlineState();
    else savePokerState();
    renderGame();
    scheduleCurrentAction();
}

function postBlind(idx, amount) {
    const p = G.players[idx];
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.bet += actual;
    G.pot += actual;
    if (p.stack === 0) p.allIn = true;
    logMove(p.name, actual === amount ? `posts blind ¤${amount}` : `posts blind ¤${actual} (all-in)`);
}

function getActivePlayers() {
    return G.players.filter(p => !p.folded && p.stack > 0);
}

function nextActiveFrom(startIdx) {
    let idx = startIdx % G.players.length;
    for (let i = 0; i < G.players.length; i++) {
        const p = G.players[idx];
        if (!p.folded && (p.stack > 0 || p.allIn)) return idx;
        idx = (idx + 1) % G.players.length;
    }
    return startIdx;
}

// ─── ACTION DISPATCH ──────────────────────────────────────────────────────────
function scheduleCurrentAction() {
    const p = G.players[G.activeIdx];
    console.log('[scheduleCurrentAction] activeIdx=', G.activeIdx, 'player=', p?.name, 'isBot=', p?.isBot, 'folded=', p?.folded, 'allIn=', p?.allIn, 'amHost=', amHost, 'myUID=', myUID);
    if (!p || p.folded || p.allIn) { advanceAction(); return; }

    if (p.isBot) {
        // In online mode, only host schedules bot actions
        if (isOnline && !amHost) return;
        const t = setTimeout(() => executeBotAction(G.activeIdx), BOT_THINK_MS);
        botTimeouts.push(t);
        return;
    }

    // Human player's turn
    if (!isOnline || p.id === myUID) {
        console.log('[scheduleCurrentAction] showing action bar for seat', p.id);
        showActionBar(G.activeIdx);
        startTurnTimer(TURN_TIMEOUT_S, () => playerAction('fold'));
    } else {
        // Online: non-host human — action bar shown when guest receives state update
        console.log('[scheduleCurrentAction] waiting for remote player', p.id, 'to act');
        hideActionBar();
    }
}

function showActionBar(idx) {
    const p = G.players[idx];
    const callAmt = G.currentBet - p.bet;
    const bar = document.getElementById('actionBar');
    bar.style.display = 'flex';

    const checkCallBtn = document.getElementById('checkCallBtn');
    if (callAmt <= 0) {
        checkCallBtn.innerText = 'Check';
        checkCallBtn.className = 'act-btn check-btn';
    } else {
        const actual = Math.min(callAmt, p.stack);
        checkCallBtn.innerText = `Call ¤${actual}`;
        checkCallBtn.className = 'act-btn check-btn';
    }

    const minRaise = G.currentBet + Math.max(BIG_BLIND, G.currentBet);
    const maxRaise = p.stack + p.bet;
    const slider = document.getElementById('raiseSlider');
    slider.min = Math.min(minRaise, maxRaise);
    slider.max = maxRaise;
    slider.value = Math.min(minRaise, maxRaise);
    syncRaiseInput(slider.value);

    const raiseBtn = document.getElementById('raiseBtn');
    if (p.stack + p.bet <= G.currentBet) {
        raiseBtn.style.display = 'none';
    } else {
        raiseBtn.style.display = 'flex';
        raiseBtn.innerText = G.currentBet > 0 ? 'Raise' : 'Bet';
    }

    document.getElementById('callAmount').innerText = callAmt > 0 ? `To call: ¤${Math.min(callAmt, p.stack)}` : 'Your turn';
    document.getElementById('myStack').innerText = `Chips: ¤${p.stack}`;
}

function hideActionBar() {
    document.getElementById('actionBar').style.display = 'none';
    document.getElementById('raisePanel').style.display = 'none';
}

window.openRaisePanel = () => {
    const rp = document.getElementById('raisePanel');
    rp.style.display = rp.style.display === 'none' ? 'flex' : 'none';
};

window.setRaisePct = (pct) => {
    const p = G.players[G.activeIdx];
    const potBet = Math.round(G.pot * pct / 100) + G.currentBet;
    const capped = Math.min(potBet, p.stack + p.bet);
    document.getElementById('raiseSlider').value = capped;
    syncRaiseInput(capped);
};

window.setRaiseAllIn = () => {
    const p = G.players[G.activeIdx];
    const val = p.stack + p.bet;
    document.getElementById('raiseSlider').value = val;
    syncRaiseInput(val);
};

window.syncRaiseInput = (val) => {
    document.getElementById('raiseInput').value = val;
};
window.syncRaiseSlider = (val) => {
    document.getElementById('raiseSlider').value = val;
    syncRaiseInput(val);
};

window.confirmRaise = () => {
    const amount = parseInt(document.getElementById('raiseInput').value);
    if (!isNaN(amount)) playerAction('raise', amount);
};

window.playerAction = (type, raiseToAmount) => {
    if (!G) return;
    const idx = G.activeIdx;
    const p = G.players[idx];
    if (!p || p.folded || p.allIn) return;
    // In online mode, only act if it's this client's seat
    if (isOnline && p.id !== myUID) return;

    hideActionBar();
    clearTurnTimer();
    document.getElementById('raisePanel').style.display = 'none';

    if (isOnline && !amHost) {
        // Non-host: push action to Firestore for host to process
        pushPlayerAction(type, raiseToAmount);
    } else {
        executeAction(idx, type, raiseToAmount);
    }
};

// Non-host pushes their action; host picks it up in the snapshot and executes it
async function pushPlayerAction(type, raiseToAmount) {
    if (!lobbyId) return;
    const action = { uid: myUID, type, raiseToAmount: raiseToAmount || null, ts: Date.now() };
    console.log('[GUEST] pushPlayerAction', action);
    try {
        await updateDoc(doc(fdb, 'poker_lobbies', lobbyId), { pendingAction: action });
    } catch (e) { console.error('pushPlayerAction failed:', e); }
}

// Called by host's snapshot when a pendingAction arrives
function handlePendingAction(data) {
    if (!amHost || !G || !data.pendingAction) return;
    const pa = data.pendingAction;
    console.log('[HOST] pendingAction received uid=', pa.uid, 'type=', pa.type, 'activeIdx=', G.activeIdx, 'activePlayer.id=', G.players[G.activeIdx]?.id);
    // Only process if it's for the current active player
    if (pa.uid !== G.players[G.activeIdx]?.id) {
        console.warn('[HOST] pendingAction uid mismatch, ignoring');
        return;
    }
    // Prevent processing the same action twice (dedup by timestamp)
    if (pa.ts === lastProcessedActionTs) {
        console.warn('[HOST] duplicate pendingAction ts, ignoring');
        return;
    }
    lastProcessedActionTs = pa.ts;

    clearTurnTimer();
    hideActionBar();
    executeAction(G.activeIdx, pa.type, pa.raiseToAmount);
}

function executeAction(idx, type, raiseToAmount) {
    const p = G.players[idx];
    const callAmt = G.currentBet - p.bet;

    p._actedThisStreet = true;

    if (type === 'fold') {
        p.folded = true;
        showActionIndicator(idx, 'fold', 'Fold');
        logMove(p.name, 'folds');

    } else if (type === 'check-call') {
        if (callAmt <= 0) {
            showActionIndicator(idx, 'check', 'Check');
            logMove(p.name, 'checks');
        } else {
            const actual = Math.min(callAmt, p.stack);
            p.stack -= actual;
            p.bet += actual;
            G.pot += actual;
            if (p.stack === 0) { p.allIn = true; showActionIndicator(idx, 'allin', 'All-in'); }
            else showActionIndicator(idx, 'call', `Call ¤${actual}`);
            logMove(p.name, `calls ¤${actual}`);
        }

    } else if (type === 'raise') {
        const raiseTo = Math.max(raiseToAmount || G.currentBet * 2, G.currentBet + BIG_BLIND);
        const raiseAmt = Math.min(raiseTo - p.bet, p.stack);
        p.stack -= raiseAmt;
        p.bet += raiseAmt;
        G.pot += raiseAmt;
        G.currentBet = Math.max(G.currentBet, p.bet);
        G.players.forEach((op, oi) => { if (oi !== idx) op._actedThisStreet = false; });
        if (p.stack === 0) { p.allIn = true; showActionIndicator(idx, 'allin', `All-in ¤${p.bet}`); }
        else showActionIndicator(idx, 'raise', `Raise ¤${p.bet}`);
        logMove(p.name, `raises to ¤${p.bet}`);
    }

    if (!isOnline) savePokerState();
    // Online: do NOT push state here — activeIdx still points to the player who just acted.
    // Push happens inside advanceAction/advanceStage once the NEW activeIdx is known.
    renderGame();

    setTimeout(() => advanceAction(), 200);
}

function advanceAction() {
    const notFolded = G.players.filter(p => !p.folded);
    if (notFolded.length === 1) { endRound([notFolded[0].id]); return; }

    const n = G.players.length;
    let nextIdx = (G.activeIdx + 1) % n;

    for (let i = 0; i < n; i++) {
        const p = G.players[nextIdx];

        if (!p.folded && !p.allIn) {
            const owes = G.currentBet - p.bet;
            const hasNotActed = !p._actedThisStreet;

            if (owes > 0 || hasNotActed) {
                G.activeIdx = nextIdx;
                // Push AFTER updating activeIdx so guest sees the correct next player
                if (isOnline) pushOnlineState();
                renderGame();
                scheduleCurrentAction();
                return;
            }
        }

        nextIdx = (nextIdx + 1) % n;
    }

    G.players.forEach(p => { p._actedThisStreet = false; });
    advanceStage();
}

function advanceStage() {
    clearBotTimeouts();
    clearTurnTimer();

    G.players.forEach(p => { p.bet = 0; p._actedThisStreet = false; });
    G.currentBet = 0;

    if (G.stage === 'preflop') {
        G.stage = 'flop';
        G.community.push(dealCard(), dealCard(), dealCard());
    } else if (G.stage === 'flop') {
        G.stage = 'turn';
        G.community.push(dealCard());
    } else if (G.stage === 'turn') {
        G.stage = 'river';
        G.community.push(dealCard());
    } else if (G.stage === 'river') {
        doShowdown();
        return;
    }

    G.activeIdx = nextActiveFrom((G.dealerIdx + 1) % G.players.length);

    if (isOnline) pushOnlineState();
    renderGame();

    const canAct = G.players.filter(p => !p.folded && !p.allIn);
    if (canAct.length <= 1 && G.stage !== 'river') {
        setTimeout(advanceStage, 800);
        return;
    }

    scheduleCurrentAction();
}

// ─── SHOWDOWN ─────────────────────────────────────────────────────────────────
function doShowdown() {
    G.stage = 'showdown';
    clearBotTimeouts();
    clearTurnTimer();
    hideActionBar();

    const contenders = G.players.filter(p => !p.folded);
    contenders.forEach(p => { p.showHand = true; });

    const ranked = contenders.map(p => ({
        p,
        result: bestHand([...p.holeCards, ...G.community])
    })).sort((a, b) => compareHands(b.result, a.result));

    const topScore = ranked[0].result.score;
    const winners = ranked.filter(r => r.result.score === topScore).map(r => r.p);

    const payout = distributePot(winners, contenders);

    logMove('---', `Showdown — ${winners.map(w => w.name).join(', ')} win${winners.length > 1 ? '' : 's'}`);

    if (isOnline) { pushOnlineState(); logSessionToFirestore(); }

    renderGame();
    showShowdownModal(ranked, payout, winners);
    animateChips(winners);

    if (isOnline) pushOnlineState();
}

function distributePot(winners, contenders) {
    const payout = {};
    G.players.forEach(p => { payout[p.id] = 0; });
    const share = Math.floor(G.pot / winners.length);
    const remainder = G.pot - share * winners.length;
    winners.forEach(w => { w.stack += share; payout[w.id] = (payout[w.id] || 0) + share; });
    if (remainder > 0) { winners[0].stack += remainder; payout[winners[0].id] += remainder; }
    G.pot = 0;
    return payout;
}

function endRound(winnerIds) {
    G.stage = 'showdown';
    clearBotTimeouts();
    clearTurnTimer();
    hideActionBar();

    const winners = G.players.filter(p => winnerIds.includes(p.id));
    const payout = distributePot(winners, G.players.filter(p => !p.folded));

    logMove('---', `${winners.map(w => w.name).join(', ')} win${winners.length > 1 ? '' : 's'} uncontested`);

    if (isOnline) { pushOnlineState(); logSessionToFirestore(); }
    renderGame();

    const showdown = G.players.filter(p => !p.folded).map(p => ({
        p, result: bestHand([...p.holeCards, ...G.community])
    })).sort((a, b) => compareHands(b.result, a.result));

    showShowdownModal(showdown, payout, winners);
    animateChips(winners);
}

window.nextRound = () => {
    document.getElementById('showdownModal').style.display = 'none';
    if (isOnline && !amHost) return; // only host drives next round
    const alive = G.players.filter(p => p.stack > 0);
    if (alive.length <= 1) { endSession(); return; }
    startRound();
    if (isOnline) pushOnlineState();
};

function endSession() {
    G.sessionOver = true;
    if (isOnline) logSessionToFirestore();
    showSessionModal();
}

window.startNewSession = () => {
    document.getElementById('sessionModal').style.display = 'none';
    if (isOnline) { window.location.reload(); return; }
    startOfflineGame();
};

// ─── BOT AI ───────────────────────────────────────────────────────────────────
function executeBotAction(idx) {
    const p = G.players[idx];
    if (!p || p.folded || p.allIn) { advanceAction(); return; }

    const callAmt = G.currentBet - p.bet;
    const hs = estimateHandStrength(p.holeCards, G.community);
    const rand = Math.random();
    // Pot odds: how much of the pot are we calling?
    const potOdds = G.pot > 0 ? callAmt / (G.pot + callAmt) : 0;

    let action = 'fold';
    let raiseAmt;

    if (callAmt <= 0) {
        // Free check — mostly check, sometimes bet with decent hand
        if (hs > 0.65 && rand < 0.55) {
            action = 'raise';
        } else if (hs > 0.4 && rand < 0.25) {
            action = 'raise'; // bluff / semi-bluff
        } else {
            action = 'check-call';
        }
    } else {
        // Has to pay to continue
        const callFraction = callAmt / (p.stack || 1);

        if (callFraction > 0.6) {
            // Large bet relative to stack — need strong hand
            if (hs > 0.72) action = 'check-call';
            else if (hs > 0.5 && rand < 0.3) action = 'check-call'; // gamble sometimes
            else action = 'fold';
        } else if (hs > potOdds + 0.15) {
            // Hand strength significantly exceeds pot odds
            if (hs > 0.78 && rand < 0.5) action = 'raise';
            else action = 'check-call';
        } else if (hs > potOdds - 0.05) {
            // Marginal call
            if (rand < 0.55) action = 'check-call';
            else action = 'fold';
        } else {
            // Bad pot odds
            if (rand < 0.12) action = 'check-call'; // occasional bluff-catch
            else action = 'fold';
        }
    }

    if (action === 'raise') {
        // Bet sizing: 50–120% pot with strong hands, 33–66% pot as bluff/value
        const sizePct = hs > 0.75
            ? [0.66, 0.75, 1.0, 1.2][Math.floor(rand * 4)]
            : [0.33, 0.5, 0.66][Math.floor(rand * 3)];
        raiseAmt = Math.min(Math.round(G.pot * sizePct) + G.currentBet, p.stack + p.bet);
        // Must be at least minRaise
        const minRaise = G.currentBet + Math.max(BIG_BLIND, G.currentBet);
        raiseAmt = Math.max(raiseAmt, Math.min(minRaise, p.stack + p.bet));
    }

    executeAction(idx, action, raiseAmt);
}

function estimateHandStrength(hole, community) {
    if (!hole || hole.length < 2) return 0.3;
    const r1 = RANK_VAL[hole[0].rank], r2 = RANK_VAL[hole[1].rank];
    const suited = hole[0].suit === hole[1].suit;
    const paired = hole[0].rank === hole[1].rank;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const gap = hi - lo;

    let base;
    if (paired) {
        base = 0.5 + (r1 - 2) / 24; // pairs: 0.5 (22) to 0.96 (AA)
    } else {
        // High card strength scaled 0.2–0.6
        base = 0.2 + (hi + lo - 4) / 48;
        if (suited) base += 0.06;
        if (gap <= 1) base += 0.07; // connected
        else if (gap <= 2) base += 0.04;
        if (hi === 14) base += 0.05; // ace high
    }
    base = Math.max(0.1, Math.min(0.95, base));

    if (community.length > 0) {
        const all = [...hole, ...community];
        const h = bestHand(all);
        // Map hand type (0–9) to strength
        const typeStrength = [0.15, 0.38, 0.52, 0.65, 0.72, 0.80, 0.88, 0.93, 0.97, 0.99];
        base = Math.max(base, typeStrength[h.type] || 0);
    }
    return base;
}

// ─── HAND EVALUATION ──────────────────────────────────────────────────────────
function buildDeck() {
    const deck = [];
    SUITS.forEach(suit => RANKS.forEach(rank => deck.push({ suit, rank })));
    return deck;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function dealCard() {
    return G.deck.pop();
}

function bestHand(cards) {
    if (!cards || cards.length < 5) return { type: 0, score: 0, name: 'High Card' };
    const combos = getCombinations(cards, 5);
    let best = null;
    for (const combo of combos) {
        const h = evalFiveCard(combo);
        if (!best || compareHands(h, best) > 0) best = h;
    }
    return best || { type: 0, score: 0, name: 'High Card' };
}

function getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = getCombinations(rest, k);
    return [...withFirst, ...withoutFirst];
}

function evalFiveCard(cards) {
    const vals = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const flush = suits.every(s => s === suits[0]);
    const straight = isStraight(vals);
    const counts = {};
    vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const topGroup = parseInt(groups[0][1]);

    let type = 0, name = 'High Card';

    if (flush && straight && vals[0] === 14 && vals[4] === 10) { type = 9; name = 'Royal Flush'; }
    else if (flush && straight) { type = 8; name = 'Straight Flush'; }
    else if (topGroup === 4) { type = 7; name = 'Four of a Kind'; }
    else if (topGroup === 3 && parseInt(groups[1][1]) === 2) { type = 6; name = 'Full House'; }
    else if (flush) { type = 5; name = 'Flush'; }
    else if (straight) { type = 4; name = 'Straight'; }
    else if (topGroup === 3) { type = 3; name = 'Three of a Kind'; }
    else if (topGroup === 2 && parseInt(groups[1][1]) === 2) { type = 2; name = 'Two Pair'; }
    else if (topGroup === 2) { type = 1; name = 'One Pair'; }
    else { type = 0; name = 'High Card'; }

    let score = type * 1e10;
    vals.forEach((v2, i) => { score += v2 * Math.pow(100, 4 - i); });

    return { type, score, name, cards };
}

function isStraight(sortedVals) {
    if (sortedVals[0] === 14) {
        if (JSON.stringify(sortedVals.slice(1)) === JSON.stringify([5, 4, 3, 2])) return true;
    }
    for (let i = 0; i < 4; i++) {
        if (sortedVals[i] - sortedVals[i + 1] !== 1) return false;
    }
    return true;
}

function compareHands(a, b) {
    if (a.score > b.score) return 1;
    if (a.score < b.score) return -1;
    return 0;
}

// ─── RENDERING ────────────────────────────────────────────────────────────────
function renderGame() {
    renderCommunityCards();
    renderPlayersRing();
    renderPot();
    renderMyCards();
}

function renderCommunityCards() {
    const cc = document.getElementById('communityCards');
    // Always rebuild — simple and flicker-free since community cards only change a few times per round
    cc.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        if (i < G.community.length) {
            cc.appendChild(makeCardEl(G.community[i], false));
        } else {
            const ph = document.createElement('div');
            ph.className = 'playing-card face-down';
            cc.appendChild(ph);
        }
    }
    document.getElementById('stageLabel').innerText = G.stage.toUpperCase();
}

function renderPot() {
    document.getElementById('potAmount').innerText = `¤${G.pot}`;
    const totalBets = G.players.reduce((sum, p) => sum + (p.bet || 0), 0);
    const betsEl = document.getElementById('totalBetsDisplay');
    if (betsEl) {
        betsEl.innerText = totalBets > 0 ? `+ ¤${totalBets} in play` : '';
    }
}

function renderPlayersRing() {
    const ring = document.getElementById('playersRing');
    const W = ring.clientWidth || 360;
    const H = ring.clientHeight || 200;
    const n = G.players.length;
    // Shrink ellipse so edge players have padding
    const rx = W * 0.38, ry = H * 0.38;
    const cx = W / 2, cy = H / 2;

    const needsFullRebuild = ring.children.length !== n;
    if (needsFullRebuild) ring.innerHTML = '';

    G.players.forEach((p, i) => {
        // Rotate so myUID is always at the bottom (angle = PI/2 = bottom)
        const myOffset = myUID != null ? myUID : 0;
        const rotatedI = (i - myOffset + n) % n;
        // Start at bottom (Math.PI/2), go clockwise
        const angle = (Math.PI / 2) + (2 * Math.PI * rotatedI) / n;
        const x = cx + rx * Math.cos(angle);
        const y = cy + ry * Math.sin(angle);

        let slot = needsFullRebuild ? null : ring.querySelector(`.player-slot[data-pid="${p.id}"]`);
        const isNewSlot = !slot;

        if (isNewSlot) {
            slot = document.createElement('div');
            slot.className = 'player-slot';
            slot.dataset.pid = p.id;
            slot.style.left = x + 'px';
            slot.style.top = y + 'px';
        }

        const isActive = i === G.activeIdx && !p.folded;

        if (isNewSlot) {
            const cardsDiv = document.createElement('div');
            cardsDiv.className = 'player-cards'; cardsDiv.dataset.role = 'cards';
            const avatar = document.createElement('div');
            avatar.dataset.role = 'avatar';
            avatar.innerText = p.name.charAt(0).toUpperCase() + (p.isBot ? '🤖' : '');
            const nameEl = document.createElement('div');
            nameEl.className = 'player-name'; nameEl.dataset.role = 'name';
            nameEl.innerText = p.name + (p.id === myUID ? ' (You)' : '');
            const stackEl = document.createElement('div');
            stackEl.className = 'player-stack'; stackEl.dataset.role = 'stack';
            const betEl = document.createElement('div');
            betEl.className = 'player-bet'; betEl.dataset.role = 'bet';
            slot.appendChild(cardsDiv);
            slot.appendChild(avatar);
            slot.appendChild(nameEl);
            slot.appendChild(stackEl);
            slot.appendChild(betEl);
            ring.appendChild(slot);
        }

        const avatar = slot.querySelector('[data-role="avatar"]');
        const stackEl = slot.querySelector('[data-role="stack"]');
        const betEl = slot.querySelector('[data-role="bet"]');
        const cardsDiv = slot.querySelector('[data-role="cards"]');

        avatar.className = 'player-avatar' +
            (isActive ? ' active-turn' : '') +
            (p.folded ? ' folded' : '') +
            (p.allIn ? ' all-in' : '');

        let dealerBadge = avatar.querySelector('.badge-dealer');
        if (i === G.dealerIdx && !dealerBadge) {
            dealerBadge = document.createElement('div');
            dealerBadge.className = 'player-status-badge badge-dealer';
            dealerBadge.innerText = 'D';
            avatar.appendChild(dealerBadge);
        } else if (i !== G.dealerIdx && dealerBadge) {
            dealerBadge.remove();
        }

        stackEl.innerText = p.allIn ? 'ALL-IN' : `¤${p.stack}`;
        betEl.innerText = p.bet > 0 ? `Bet: ¤${p.bet}` : '';

        // Show cards for: me (always), showdown reveal, offline (all visible)
        const showCards = p.showHand || p.id === myUID || (!isOnline && !p.isBot && p.holeCards && p.holeCards[0]);
        const wantReveal = showCards && p.holeCards && p.holeCards.length === 2;
        const currentReveal = cardsDiv.dataset.revealed === '1';
        if (wantReveal !== currentReveal || (wantReveal && cardsDiv.children.length !== 2)) {
            cardsDiv.innerHTML = '';
            cardsDiv.dataset.revealed = wantReveal ? '1' : '0';
            if (p.holeCards && p.holeCards.length === 2) {
                p.holeCards.forEach(card => {
                    const mini = document.createElement('div');
                    mini.className = 'mini-card' + (wantReveal && card ? ' revealed ' + getCardColor(card) : '');
                    mini.innerText = wantReveal && card ? cardLabel(card) : '';
                    cardsDiv.appendChild(mini);
                });
            }
        }
    });
}

function renderMyCards() {
    const area = document.getElementById('myCardsArea');
    if (!G) return;
    const me = G.players.find(p => p.id === myUID);
    const cardKey = me && me.holeCards && me.holeCards.length === 2
        ? me.holeCards.map(c => c ? c.rank + c.suit : '?').join(',')
        : 'empty';
    if (area.dataset.cardKey === cardKey) return;
    area.dataset.cardKey = cardKey;
    area.innerHTML = '';

    const hasCards = me && me.holeCards && me.holeCards.length === 2 && me.holeCards[0];
    if (hasCards && !me.folded) {
        me.holeCards.forEach(card => area.appendChild(makeCardEl(card, true)));
    } else {
        // Always show two face-down placeholders so the area never collapses
        area.appendChild(makeCardEl(null));
        area.appendChild(makeCardEl(null));
    }
}

function makeCardEl(card, dealt = false) {
    if (!card) {
        const el = document.createElement('div');
        el.className = 'playing-card face-down';
        return el;
    }
    const el = document.createElement('div');
    const color = getCardColor(card);
    el.className = `playing-card ${color}` + (dealt ? ' dealt' : '');
    el.innerHTML = `
        <div class="card-corner card-corner-tl">
            <div class="card-rank">${card.rank}</div>
            <div class="card-suit">${card.suit}</div>
        </div>
        <div class="card-center">${card.suit}</div>
        <div class="card-corner card-corner-br">
            <div class="card-rank">${card.rank}</div>
            <div class="card-suit">${card.suit}</div>
        </div>`;
    return el;
}

function getCardColor(card) {
    return (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
}

function cardLabel(card) {
    return card.rank + card.suit;
}

// ─── SHOWDOWN MODAL ───────────────────────────────────────────────────────────
function showShowdownModal(ranked, payout, winners) {
    const modal = document.getElementById('showdownModal');
    const content = document.getElementById('showdownContent');
    content.innerHTML = '';

    ranked.forEach(({ p, result }) => {
        const won = payout[p.id] || 0;
        const isWinner = winners.some(w => w.id === p.id);
        const row = document.createElement('div');
        row.className = 'showdown-player' + (isWinner ? ' winner' : '');

        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'showdown-cards';
        if (p.holeCards) p.holeCards.forEach(c => cardsDiv.appendChild(makeCardEl(c)));

        const info = document.createElement('div');
        info.className = 'showdown-info';
        info.innerHTML = `
            <div class="showdown-name">${p.name}${p.id === myUID ? ' (You)' : ''}</div>
            <div class="showdown-hand">${result ? result.name : 'Folded'}</div>
            ${won > 0 ? `<div class="showdown-won">+¤${won}</div>` : ''}`;

        row.appendChild(cardsDiv);
        row.appendChild(info);
        content.appendChild(row);
    });

    document.getElementById('showdownTitle').innerText =
        winners.length > 1 ? 'Split Pot!' :
        winners[0].id === myUID ? '🏆 You Win!' : `${winners[0].name} Wins!`;

    const chipArea = document.getElementById('chipAnimation');
    chipArea.innerHTML = '';
    const potAmt = Object.values(payout).reduce((a, b) => a + b, 0);
    const chips = getChipBreakdown(potAmt);
    chips.forEach((chip, i) => {
        const el = document.createElement('div');
        el.className = `chip chip-${chip.denom}`;
        el.style.animationDelay = (i * 50) + 'ms';
        el.innerText = chip.denom >= 100 ? chip.denom : '';
        chipArea.appendChild(el);
    });

    document.getElementById('showHandBtn').style.display = 'none';
    modal.style.display = 'flex';
}

window.toggleShowHands = () => {};

function getChipBreakdown(amount) {
    const denoms = [500, 100, 25, 5, 1];
    const chips = [];
    let rem = Math.min(amount, 1000);
    denoms.forEach(d => {
        while (rem >= d && chips.length < 20) {
            chips.push({ denom: d });
            rem -= d;
        }
    });
    return chips;
}

// ─── CHIP ANIMATION ───────────────────────────────────────────────────────────
function animateChips(winners) {
    const overlay = document.getElementById('chipsOverlay');
    overlay.innerHTML = '';
    overlay.style.display = 'block';

    const potEl = document.getElementById('potAmount');
    if (!potEl) return;
    const potRect = potEl.getBoundingClientRect();

    const ring = document.getElementById('playersRing');
    const ringRect = ring.getBoundingClientRect();
    const W = ring.clientWidth, H = ring.clientHeight;
    const n = G.players.length;
    const rx = W * 0.42, ry = H * 0.42;
    const cx = W / 2, cy = H / 2;

    winners.forEach(winner => {
        const i = winner.id;
        const angle = ((2 * Math.PI * i) / n) - Math.PI / 2;
        const wx = ringRect.left + cx + rx * Math.cos(angle);
        const wy = ringRect.top + cy + ry * Math.sin(angle);

        for (let j = 0; j < 8; j++) {
            const chip = document.createElement('div');
            chip.className = `flying-chip chip-${[1, 5, 25, 100, 500][j % 5]}`;
            chip.style.cssText = `
                left: ${potRect.left + potRect.width / 2}px;
                top: ${potRect.top + potRect.height / 2}px;
                --sx: 0px; --sy: 0px;
                --ex: ${wx - (potRect.left + potRect.width / 2)}px;
                --ey: ${wy - (potRect.top + potRect.height / 2)}px;
                --duration: ${0.5 + j * 0.08}s;
                animation-delay: ${j * 60}ms;
            `;
            overlay.appendChild(chip);
        }
    });

    setTimeout(() => { overlay.style.display = 'none'; overlay.innerHTML = ''; }, 2000);
}

// ─── SESSION MODAL ────────────────────────────────────────────────────────────
function showSessionModal() {
    const content = document.getElementById('sessionContent');
    content.innerHTML = '';
    const sorted = [...G.players].sort((a, b) => b.stack - a.stack);
    sorted.forEach(p => {
        const row = document.createElement('div');
        row.className = 'session-row' + (p.id === myUID ? ' winner' : '');
        row.innerHTML = `<span>${p.name}${p.id === myUID ? ' (You)' : ''}</span><span>¤${p.stack}</span>`;
        content.appendChild(row);
    });
    document.getElementById('sessionModal').style.display = 'flex';
}

// ─── ACTION INDICATOR ────────────────────────────────────────────────────────
function showActionIndicator(idx, type, text) {
    const slots = document.querySelectorAll('.player-slot');
    if (!slots[idx]) return;
    const old = slots[idx].querySelector('.action-indicator');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = `action-indicator ${type}`;
    el.innerText = text;
    const avatarEl = slots[idx].querySelector('.player-avatar');
    if (avatarEl) avatarEl.appendChild(el);
    setTimeout(() => el.remove(), 1800);
}

// ─── TURN TIMER ──────────────────────────────────────────────────────────────
function startTurnTimer(seconds, onExpire) {
    clearTurnTimer();
    let remaining = seconds;
    turnTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) { clearTurnTimer(); onExpire(); }
    }, 1000);
}

function clearTurnTimer() {
    if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
}

function clearBotTimeouts() {
    botTimeouts.forEach(t => clearTimeout(t));
    botTimeouts = [];
}

// ─── MOVE LOGGING ─────────────────────────────────────────────────────────────
function logMove(playerName, action) {
    sessionMoves.push({ player: playerName, action, ts: Date.now(), round: G.round });
}

async function logSessionToFirestore() {
    if (!isOnline || !lobbyId) return;
    try {
        await addDoc(collection(fdb, 'poker_sessions'), {
            lobbyId,
            startedAt: sessionStartTime,
            endedAt: Date.now(),
            players: G.players.map(p => ({ name: p.name, finalStack: p.stack })),
            moves: sessionMoves.slice(-200),
            rounds: G.round,
            timestamp: serverTimestamp()
        });
    } catch (e) { console.error('Failed to log session:', e); }
}

// ─── ONLINE STATE SYNC ────────────────────────────────────────────────────────
async function pushOnlineState() {
    if (!lobbyId || !isOnline) return;
    const stateToSync = {
        players: G.players.map(p => ({
            id: p.id, name: p.name, stack: p.stack, bet: p.bet,
            folded: p.folded, allIn: p.allIn, showHand: p.showHand,
            // Always send hole cards — each client needs their own cards.
            // Opponent cards are masked client-side in renderPlayersRing.
            holeCards: p.holeCards
        })),
        community: G.community,
        pot: G.pot,
        stage: G.stage,
        activeIdx: G.activeIdx,
        currentBet: G.currentBet,
        dealerIdx: G.dealerIdx,
        round: G.round,
        sessionOver: G.sessionOver || false,
    };
    const stateStr = JSON.stringify(stateToSync);
    lastPushedStateStr = stateStr;
    console.log('[HOST] pushOnlineState stage=', stateToSync.stage, 'activeIdx=', stateToSync.activeIdx, 'round=', stateToSync.round);
    try {
        // Also clear pendingAction so the host's own push doesn't re-trigger it
        await updateDoc(doc(fdb, 'poker_lobbies', lobbyId), { state: stateToSync, pendingAction: null });
    } catch (e) { console.error('pushOnlineState failed:', e); }
}

function applyRemoteState(remote) {
    if (!G) return;

    console.log('[GUEST] applyRemoteState stage=', remote.stage, 'activeIdx=', remote.activeIdx, 'round=', remote.round, 'myUID=', myUID);

    // Reset render caches on round change so new cards are drawn fresh
    const roundChanged = remote.round && remote.round !== G.round;
    if (roundChanged) {
        console.log('[GUEST] round changed', G.round, '->', remote.round, '— clearing render caches');
        const area = document.getElementById('myCardsArea');
        if (area) { area.innerHTML = ''; area.dataset.cardKey = ''; }
        const ring = document.getElementById('playersRing');
        if (ring) ring.innerHTML = '';
        lastPushedStateStr = '';
    }

    const prevStage = G.stage;

    G.community = remote.community || G.community;
    G.pot = remote.pot ?? G.pot;
    G.stage = remote.stage || G.stage;
    G.activeIdx = remote.activeIdx ?? G.activeIdx;
    G.currentBet = remote.currentBet ?? G.currentBet;
    G.dealerIdx = remote.dealerIdx ?? G.dealerIdx;
    G.round = remote.round ?? G.round;

    // Update all player state from host (host sends full holeCards now)
    remote.players.forEach(rp => {
        const p = G.players.find(lp => lp.id === rp.id);
        if (!p) return;
        p.stack = rp.stack;
        p.bet = rp.bet;
        p.folded = rp.folded;
        p.allIn = rp.allIn;
        p.showHand = rp.showHand;
        // Accept hole cards from host (they know all cards)
        // Opponent cards masked in renderPlayersRing by checking p.id !== myUID
        if (rp.holeCards && rp.holeCards.length > 0 && rp.holeCards[0]) {
            p.holeCards = rp.holeCards;
        }
    });

    console.log('[GUEST] my cards:', G.players[myUID]?.holeCards);

    renderGame();

    // Show/hide action bar based on whether it's my turn
    const me = G.players.find(p => p.id === myUID);
    console.log('[GUEST] myTurn=', G.activeIdx === myUID, 'stage=', G.stage, 'me.folded=', me?.folded, 'me.allIn=', me?.allIn);
    if (me && !me.folded && !me.allIn && G.activeIdx === myUID && G.stage !== 'showdown' && G.stage !== 'waiting') {
        console.log('[GUEST] showing action bar');
        showActionBar(G.activeIdx);
        startTurnTimer(TURN_TIMEOUT_S, () => playerAction('fold'));
    } else {
        hideActionBar();
    }

    if (remote.sessionOver) { endSession(); }

    // Show showdown modal for non-host when stage becomes showdown
    if (remote.stage === 'showdown' && prevStage !== 'showdown') {
        const contenders = G.players.filter(p => !p.folded);
        if (contenders.length > 0 && contenders[0].holeCards && contenders[0].holeCards[0]) {
            const ranked = contenders.map(p => ({
                p, result: bestHand([...p.holeCards, ...G.community])
            })).sort((a, b) => compareHands(b.result, a.result));
            const topScore = ranked[0].result.score;
            const winners = ranked.filter(r => r.result.score === topScore).map(r => r.p);
            const payout = {};
            G.players.forEach(p => { payout[p.id] = 0; });
            // Payout was already applied by host; just show modal
            const alreadyShowing = document.getElementById('showdownModal').style.display === 'flex';
            if (!alreadyShowing) {
                showShowdownModal(ranked, payout, winners);
                animateChips(winners);
            }
        }
    }
}

// ─── WINDOW EVENTS ───────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    if (G) renderPlayersRing();
});

function genCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}
