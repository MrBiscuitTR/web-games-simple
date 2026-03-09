/**
 * TÜRK TAVLASI MOTORU
 * Modlar: Erkek Tavlası, Kız Tavlası
 * IndexedDB, Drag & Drop, Legal Hamle Doğrulaması.
 */

// --- STATE MANAGEMENT ---
let gameState = {
    mode: 'erkek', // 'erkek' veya 'kiz'
    turn: 1,       // 1 (Beyaz) veya 2 (Siyah)
    board: Array(25).fill(null), // 1-24 haneler. Index 0 kullanılmaz.
    bar: { 1: 0, 2: 0 },         // Kırık pullar
    bearOff: { 1: 0, 2: 0 },     // Toplanan pullar
    dice: [],                    // Atılan zarlar [örn: 3, 5]
    movesLeft: [],               // Oynanacak kalan zarlar
    history: [],                 // Geri al (Undo) için state kopyaları
    scores: { 1: 0, 2: 0 },
    moveLog: []                  // Metin geçmişi
};

let selectedPoint = null;
let db;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    initIndexedDB().then(() => {
        loadGameState().then(savedState => {
            if (savedState) {
                gameState = savedState;
                renderAll();
            } else {
                initBoard();
            }
        });
    });

    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('btnRoll').addEventListener('click', rollDice);
    document.getElementById('btnNewGame').addEventListener('click', () => { initBoard(); saveGameState(); });
    document.getElementById('btnUndo').addEventListener('click', undoMove);
    document.getElementById('btnResetDB').addEventListener('click', resetIndexedDB);
    
    document.getElementById('btnErkek').addEventListener('click', () => switchMode('erkek'));
    document.getElementById('btnKiz').addEventListener('click', () => switchMode('kiz'));

    const modal = document.getElementById('rulesModal');
    document.getElementById('rulesIcon').addEventListener('click', () => modal.style.display = 'flex');
    document.querySelector('.close-btn').addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });

    document.getElementById('off-p1').addEventListener('click', () => handlePointClick('off-1'));
    document.getElementById('off-p2').addEventListener('click', () => handlePointClick('off-2'));
}

function switchMode(mode) {
    if(gameState.history.length > 0 && gameState.movesLeft.length > 0) {
        if(!confirm("Oyun devam ediyor. Modu değiştirirseniz oyun sıfırlanır. Onaylıyor musunuz?")) return;
    }
    gameState.mode = mode;
    document.getElementById('btnErkek').className = mode === 'erkek' ? 'active' : '';
    document.getElementById('btnKiz').className = mode === 'kiz' ? 'active' : '';
    initBoard();
}

// --- GAME LOGIC ---

function initBoard() {
    // YENİ VERİ YAPISI: Her hane her iki oyuncunun da pul sayısını ayrı ayrı tutar.
    gameState.board = Array(25).fill(null).map(() => ({ 1: 0, 2: 0 }));
    gameState.bar = { 1: 0, 2: 0 };
    gameState.bearOff = { 1: 0, 2: 0 };
    gameState.dice = [];
    gameState.movesLeft = [];
    gameState.history = [];
    gameState.moveLog = [];
    gameState.turn = 1;
    selectedPoint = null;

    const setup = [
        { pt: 24, p: 1, c: 2 }, { pt: 13, p: 1, c: 5 }, { pt: 8, p: 1, c: 3 }, { pt: 6, p: 1, c: 5 },
        { pt: 1, p: 2, c: 2 }, { pt: 12, p: 2, c: 5 }, { pt: 17, p: 2, c: 3 }, { pt: 19, p: 2, c: 5 }
    ];

    setup.forEach(s => {
        gameState.board[s.pt][s.p] = s.c;
    });

    saveGameState();
    renderAll();
}

function rollDice() {
    if (gameState.movesLeft.length > 0) return; 
    
    saveHistoryState();

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    gameState.dice = [d1, d2];
    
    if (d1 === d2) {
        gameState.movesLeft = [d1, d1, d1, d1];
    } else {
        gameState.movesLeft = [d1, d2];
    }
    
    logMove(`Zar atıldı: ${d1}-${d2}`);
    
    const diceArea = document.getElementById('diceDisplay');
    diceArea.innerHTML = '';
    diceArea.appendChild(createDieElement(d1, true));
    diceArea.appendChild(createDieElement(d2, true));
    
    document.getElementById('btnRoll').classList.remove('highlight');

    setTimeout(() => {
        checkNoMovesPossible();
        saveGameState();
        renderAll();
    }, 500);
}

function createDieElement(value, animate) {
    const die = document.createElement('div');
    die.className = 'die' + (animate ? ' rolling' : '');
    const dotPositions = {
        1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
    };
    for(let i=0; i<9; i++) {
        const dot = document.createElement('span');
        if(!dotPositions[value].includes(i)) dot.style.opacity = 0;
        die.appendChild(dot);
    }
    return die;
}

// --- MOVE CALCULATION ---

function calculateLegalMoves(startPointStr) {
    let legalDests = [];
    if (gameState.movesLeft.length === 0) return legalDests;

    const p = gameState.turn;
    let startIdx = null;

    if (gameState.bar[p] > 0) {
        if (!startPointStr.startsWith('bar')) return []; 
        startIdx = p === 1 ? 25 : 0; 
    } else {
        if (startPointStr.startsWith('bar')) return [];
        startIdx = parseInt(startPointStr);
        if (gameState.board[startIdx][p] === 0) return []; // Kendi pulu yok
    }

    const direction = p === 1 ? -1 : 1;
    let uniqueDice = [...new Set(gameState.movesLeft)];

    uniqueDice.forEach(die => {
        let destIdx = startIdx + (direction * die);
        
        if ((p === 1 && destIdx <= 0) || (p === 2 && destIdx >= 25)) {
            if (canBearOff(p)) {
                legalDests.push(`off-${p}`); 
            }
        } else {
            if (isValidDestination(destIdx, p)) {
                legalDests.push(destIdx.toString());
            }
        }
    });

    return legalDests;
}

function isValidDestination(idx, player) {
    if (idx < 1 || idx > 24) return false;
    const dest = gameState.board[idx];
    let opp = player === 1 ? 2 : 1;
    
    // Kız Tavlası: Her yere inilebilir (Kapı alma yok, pullar yan yana durabilir)
    if (gameState.mode === 'kiz') return true;

    // Erkek Tavlası:
    if (dest[opp] === 0) return true; // Hane boş veya sadece kendi pulumuz var
    if (dest[opp] === 1) return true; // Kırma (Rakibin tek pulu var)
    if (dest[opp] >= 2) return false; // Kapı (Rakibin 2 veya daha fazla pulu var - KESİNLİKLE KIRILAMAZ)

    return false;
}

function canBearOff(player) {
    if (gameState.bar[player] > 0) return false;
    
    for (let i = 1; i <= 24; i++) {
        if (gameState.board[i][player] > 0) {
            if (player === 1 && i > 6) return false;
            if (player === 2 && i < 19) return false;
        }
    }
    return true;
}

// --- EXECUTING MOVES ---

function handlePointClick(pointId) {
    if (gameState.movesLeft.length === 0) return;

    let p = gameState.turn;

    // 1. ÖNCE KONTROL: Hamle yapılıyorsa yap ve çık
    if (selectedPoint) {
        let legalMoves = calculateLegalMoves(selectedPoint);
        if (legalMoves.includes(pointId)) {
            moveChecker(selectedPoint, pointId);
            return; 
        }
    }

    // 2. HAMLE DEĞİLSE: Yeni pul seçimi
    let isOwnChecker = false;
    
    if (pointId.startsWith('bar') && gameState.bar[p] > 0 && pointId === `bar-${p}`) {
        isOwnChecker = true;
    } else if (!pointId.startsWith('bar') && !pointId.startsWith('off')) {
        let idx = parseInt(pointId);
        if (gameState.board[idx][p] > 0) isOwnChecker = true;
    }

    if (isOwnChecker) {
        if (selectedPoint === pointId) {
            selectedPoint = null;
        } else {
            selectedPoint = pointId;
        }
        renderAll();
    }
}

function moveChecker(startStr, endStr) {
    saveHistoryState(); 

    let p = gameState.turn;
    let startIdx = startStr.startsWith('bar') ? (p === 1 ? 25 : 0) : parseInt(startStr);
    let endIdx = endStr.startsWith('off') ? (p === 1 ? 0 : 25) : parseInt(endStr);
    
    let distance = Math.abs(startIdx - endIdx);
    let usedDieIndex = gameState.movesLeft.indexOf(distance);
    if (usedDieIndex === -1 && endStr.startsWith('off')) {
        usedDieIndex = gameState.movesLeft.findIndex(d => d >= distance);
    }
    if(usedDieIndex === -1) usedDieIndex = 0; 
    
    let playedDie = gameState.movesLeft.splice(usedDieIndex, 1)[0];

    // Kaynaktan çıkar
    if (startStr.startsWith('bar')) {
        gameState.bar[p]--;
    } else {
        gameState.board[startIdx][p]--;
    }

    // Hedefe ekle (veya vur veya topla)
    if (endStr.startsWith('off')) {
        bearOff(p);
    } else {
        let dest = gameState.board[endIdx];
        let opp = p === 1 ? 2 : 1;

        // SADECE Erkek tavlasında ve SADECE rakibin tek pulu varsa kırılır
        if (gameState.mode === 'erkek' && dest[opp] === 1) {
            hitChecker(opp);
            dest[opp] = 0; // Kırılan pulu tahtadan sil
        }
        dest[p]++; // Kendi pulunu ekle
    }

    logMove(`Oyuncu ${p}: ${startStr.replace('bar-','Bar ').replace('off-','Toplama')} -> ${endIdx}`);
    selectedPoint = null;

    if (checkWin(p)) return;

    checkNoMovesPossible();
    saveGameState();
    renderAll();
}

function hitChecker(oppPlayer) {
    gameState.bar[oppPlayer]++;
}

function bearOff(player) {
    gameState.bearOff[player]++;
}

function checkWin(player) {
    if (gameState.bearOff[player] === 15) {
        let opp = player === 1 ? 2 : 1;
        let msg = `Oyuncu ${player} Kazandı!`;
        
        if (gameState.bearOff[opp] === 0) {
            let isKatmerli = gameState.bar[opp] > 0;
            if (!isKatmerli) {
                let start = player === 1 ? 19 : 1;
                let end = player === 1 ? 24 : 6;
                for(let i=start; i<=end; i++) {
                    if(gameState.board[i][opp] > 0) isKatmerli = true;
                }
            }
            if(isKatmerli) {
                msg += " (Katmerli Mars - 3 Puan)";
                gameState.scores[player] += 3;
            } else {
                msg += " (Mars - 2 Puan)";
                gameState.scores[player] += 2;
            }
        } else {
            msg += " (Normal Kazanç - 1 Puan)";
            gameState.scores[player] += 1;
        }

        alert(msg);
        gameState.movesLeft = []; 
        renderAll();
        return true;
    }
    return false;
}

function checkNoMovesPossible() {
    if (gameState.movesLeft.length === 0) {
        endTurn();
        return;
    }

    let p = gameState.turn;
    let hasMove = false;
    
    if (gameState.bar[p] > 0) {
        hasMove = calculateLegalMoves(`bar-${p}`).length > 0;
    } else {
        for (let i = 1; i <= 24; i++) {
            if (gameState.board[i][p] > 0) {
                if (calculateLegalMoves(i.toString()).length > 0) {
                    hasMove = true;
                    break;
                }
            }
        }
    }

    if (!hasMove) {
        logMove(`Oyuncu ${p} oynayacak hamle bulamadı.`);
        gameState.movesLeft = [];
        endTurn();
    }
}

function endTurn() {
    gameState.turn = gameState.turn === 1 ? 2 : 1;
    document.getElementById('btnRoll').classList.add('highlight');
}

// --- RENDERING ---

function renderAll() {
    renderBoard();
    updateUI();
}

function renderBoard() {
    document.querySelectorAll('.row').forEach(el => el.innerHTML = '');
    document.getElementById('bar-p1').innerHTML = '';
    document.getElementById('bar-p2').innerHTML = '';
    document.getElementById('off-p1').innerHTML = '';
    document.getElementById('off-p2').innerHTML = '';

    const quads = {
        'quad-tl': [13,14,15,16,17,18],
        'quad-tr': [19,20,21,22,23,24],
        'quad-bl': [12,11,10,9,8,7],
        'quad-br': [6,5,4,3,2,1]
    };

    let legalMoves = selectedPoint ? calculateLegalMoves(selectedPoint) : [];

    for (const [qId, indices] of Object.entries(quads)) {
        const container = document.getElementById(qId);
        indices.forEach((idx, i) => {
            const pointDiv = document.createElement('div');
            pointDiv.className = `point ${(indices.indexOf(idx) % 2 === 0) ? 'dark' : 'light'}`;
            if (legalMoves.includes(idx.toString())) pointDiv.classList.add('highlight');
            
            pointDiv.onclick = () => handlePointClick(idx.toString());

            pointDiv.ondragover = (e) => e.preventDefault();
            pointDiv.ondrop = (e) => { e.preventDefault(); handlePointClick(idx.toString()); };

            const cellData = gameState.board[idx];
            let hasCheckers = false;
            const checkerContainer = document.createElement('div');
            checkerContainer.className = 'checker-container';

            // Her iki oyuncunun pullarını da render et (Kız Tavlasında aynı hanede birikebilirler)
            [1, 2].forEach(playerNum => {
                if (cellData[playerNum] > 0) {
                    hasCheckers = true;
                    for(let c=0; c<cellData[playerNum]; c++) {
                        const checker = document.createElement('div');
                        checker.className = `checker p${playerNum}`;
                        
                        if (selectedPoint === idx.toString() && playerNum === gameState.turn && c === cellData[playerNum] - 1) {
                            checker.classList.add('selected');
                        }
                        
                        if (playerNum === gameState.turn && c === cellData[playerNum] - 1) {
                            checker.draggable = true;
                            checker.ondragstart = (e) => { selectedPoint = idx.toString(); renderAll(); };
                        }
                        checkerContainer.appendChild(checker);
                    }
                }
            });

            if (hasCheckers) {
                pointDiv.appendChild(checkerContainer);
            }
            container.appendChild(pointDiv);
        });
    }

    renderSideZone('bar', gameState.bar, legalMoves);
    renderSideZone('off', gameState.bearOff, legalMoves, true);
}

function renderSideZone(type, data, legalMoves, isBearOff = false) {
    [1, 2].forEach(p => {
        const container = document.getElementById(`${type}-p${p}`);
        const idStr = `${type}-${p}`;
        
        if (legalMoves.includes(idStr)) container.classList.add('highlight');

        for(let i=0; i<data[p]; i++) {
            const checker = document.createElement('div');
            checker.className = `checker p${p}`;
            if (selectedPoint === idStr && i === data[p]-1) checker.classList.add('selected');
            
            if (!isBearOff && p === gameState.turn && i === data[p]-1) {
                checker.draggable = true;
                checker.onclick = (e) => { e.stopPropagation(); handlePointClick(idStr); };
                checker.ondragstart = () => { selectedPoint = idStr; renderAll(); };
            }
            container.appendChild(checker);
        }
    });
}

function updateUI() {
    document.getElementById('turnIndicator').innerText = `Sıra: Oyuncu ${gameState.turn} (${gameState.turn === 1 ? 'Beyaz' : 'Siyah'})`;
    document.getElementById('btnUndo').disabled = gameState.history.length === 0;
    document.getElementById('scoreP1').innerText = gameState.scores[1];
    document.getElementById('scoreP2').innerText = gameState.scores[2];
    
    const log = document.getElementById('historyLog');
    log.innerHTML = gameState.moveLog.slice(-10).reverse().join('<br>');
}

function logMove(msg) {
    gameState.moveLog.push(msg);
}

// --- UNDO & DB ---

function saveHistoryState() {
    gameState.history.push(JSON.stringify({
        board: gameState.board, bar: gameState.bar, bearOff: gameState.bearOff, 
        dice: gameState.dice, movesLeft: gameState.movesLeft, turn: gameState.turn
    }));
}

function undoMove() {
    if (gameState.history.length === 0) return;
    const lastState = JSON.parse(gameState.history.pop());
    gameState.board = lastState.board;
    gameState.bar = lastState.bar;
    gameState.bearOff = lastState.bearOff;
    gameState.dice = lastState.dice;
    gameState.movesLeft = lastState.movesLeft;
    gameState.turn = lastState.turn;
    selectedPoint = null;
    gameState.moveLog.pop();
    saveGameState();
    renderAll();
}

// --- INDEXED DB ---

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('tavlaGameDB', 1);
        req.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('saves')) {
                db.createObjectStore('saves', { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function saveGameState() {
    if(!db) return;
    const tx = db.transaction('saves', 'readwrite');
    tx.objectStore('saves').put({ id: 'current', state: JSON.stringify(gameState) });
}

function loadGameState() {
    return new Promise((resolve) => {
        if(!db) resolve(null);
        const tx = db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get('current');
        req.onsuccess = () => {
            if (req.result) resolve(JSON.parse(req.result.state));
            else resolve(null);
        };
    });
}

function resetIndexedDB() {
    if(confirm("Tüm tavla verileri (kayıtlı oyun ve skorlar) silinecek. Emin misiniz?")) {
        if(db) db.close();
        const req = indexedDB.deleteDatabase('tavlaGameDB');
        req.onsuccess = () => {
            alert('Veriler başarıyla silindi. Sayfa yenileniyor...');
            window.location.reload();
        };
    }
}