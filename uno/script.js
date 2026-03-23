const DICT = {
    en: {
        setup: "Setup Game", players: "Players: ", start: "Start", del: "Delete Data", newGame: "New Game", pTurn: "Player {n} Turn",
        showCards: "Tap to show cards", endTurn: "End Turn", passPhone: "Pass Phone", rulesTitle: "Rules", win: "Player {n} Wins!",
        menu: "Menu", forgot: "Forgot UNO! Drew 2 cards.", undo: "Undo", drawBtn: "+ Draw",
        unoCall: "UNO! Player {n} has one card left!",
        rules: `
            <ul>
                <li><strong>Goal:</strong> Be the first player to get rid of all your cards.</li>
                <li><strong>Gameplay:</strong> Match the top card on the discard pile by Color or Number/Symbol. Play ONE card per turn.</li>
                <li><strong>Draw Card:</strong> Tap the <strong>[+ 🃏]</strong> button to draw a card. You can draw even if you have a playable card.</li>
                <li><strong>Play After Drawing:</strong> After you draw, you can still play ANY valid card from your hand.</li>
                <li><strong>Special Cards:</strong>
                    <ul>
                        <li><strong>+2:</strong> Next player draws 2 cards and loses their turn.</li>
                        <li><strong>Skip:</strong> Next player loses their turn.</li>
                        <li><strong>Reverse:</strong> Reverses play direction. (Acts as a Skip in a 2-player game).</li>
                    </ul>
                </li>
                <li><strong>UNO!:</strong> You MUST tap <strong>[UNO!]</strong> when you play your second-to-last card. If you forget, you draw 2 penalty cards.</li>
                <li><strong>Undo:</strong> You can undo your card play ONCE per turn, provided you haven't passed the phone yet. (+2 cards cannot be undone).</li>
            </ul>`
    },
    tr: {
        setup: "Oyunu Kur", players: "Oyuncular: ", start: "Başlat", del: "Verileri Sil", newGame: "Yeni Oyun", pTurn: "Oyuncu {n} Sırası",
        showCards: "Kartları gör", endTurn: "Turu Bitir", passPhone: "Telefonu Devret", rulesTitle: "Kurallar", win: "Oyuncu {n} Kazandı!",
        menu: "Menü", forgot: "UNO demeyi unuttun! 2 kart çektin.", undo: "Geri Al", drawBtn: "+ Çek",
        unoCall: "UNO! Oyuncu {n}'in bir kartı kaldı!",
        rules: `
            <ul>
                <li><strong>Hedef:</strong> Elindeki tüm kartlardan kurtulan ilk oyuncu olmak.</li>
                <li><strong>Oynanış:</strong> Yerdeki kartla aynı Rengi veya Sayıyı/Sembolü at. Tur başına sadece BİR kart atılabilir.</li>
                <li><strong>Kart Çek:</strong> <strong>[+ 🃏]</strong> butonuna basarak kart çek. Atacak kartın varken bile çekebilirsin.</li>
                <li><strong>Çektikten Sonra Oyna:</strong> Kart çektikten sonra elindeki HERHANGİ bir geçerli kartı oynayabilirsin.</li>
                <li><strong>Özel Kartlar:</strong>
                    <ul>
                        <li><strong>+2:</strong> Sonraki oyuncu 2 kart çeker ve sırasını kaybeder.</li>
                        <li><strong>Pas (Skip):</strong> Sonraki oyuncu sırasını kaybeder.</li>
                        <li><strong>Yön Değiştir (Rev):</strong> Oyunun yönü tersine döner. (2 kişilik oyunda Pas yerine geçer).</li>
                    </ul>
                </li>
                <li><strong>UNO!:</strong> Sondan ikinci kartını atarken <strong>[UNO!]</strong> butonuna basmak ZORUNDASIN. Unutursan 2 ceza kartı çekersin.</li>
                <li><strong>Geri Al:</strong> Turu bitirmeden önce, attığın kartı tur başına BİR KEZ geri alabilirsin. (+2 kartları geri alınamaz).</li>
            </ul>`
    }
};
const COLORS = ['red','blue','green','yellow'];
const VALUES = ['0','1','2','3','4','5','6','7','8','9','+2','Skip','Rev'];
let db, lang = 'en', s = { pCount: 2, names: [] };
let state = null;
let turnSnapshot = null;
let isDragging = false;
let unoPlayers = {}; // { playerIndex: true } for players who called UNO

document.addEventListener("DOMContentLoaded", () => {
    initDB().then(() => loadState().then(() => {
        document.getElementById('langPicker').value = lang;
        document.getElementById('val-p').innerText = s.pCount;
        renderNameList();
        if(state) { switchScreen('screen-pass'); updateUI(); } else updateUI();
    }));
    document.getElementById('langPicker').addEventListener('change', e => { lang = e.target.value; if(state)saveState(); updateUI(); });
    
    const handArea = document.getElementById('player-hand');
    handArea.addEventListener('mousedown', () => isDragging = false);
    handArea.addEventListener('mousemove', () => isDragging = true);
    handArea.addEventListener('touchstart', () => isDragging = false, {passive: true});
    handArea.addEventListener('touchmove', () => isDragging = true, {passive: true});
});

function playerName(i) {
    const n = s.names[i] && s.names[i].trim();
    return n || (lang === 'tr' ? `Oyuncu ${i + 1}` : `Player ${i + 1}`);
}

function renderNameList() {
    const list = document.getElementById('name-list');
    list.innerHTML = '';
    for(let i = 0; i < s.pCount; i++) {
        const row = document.createElement('div');
        row.className = 'name-row';
        const lbl = document.createElement('label');
        lbl.innerText = (i + 1) + '.';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.maxLength = 20;
        inp.placeholder = DICT[lang].pTurn.replace('{n}', i + 1);
        inp.value = s.names[i] || '';
        inp.addEventListener('input', e => { s.names[i] = e.target.value; });
        row.appendChild(lbl);
        row.appendChild(inp);
        list.appendChild(row);
    }
}

function changeP(d) {
    s.pCount = Math.max(2, Math.min(10, s.pCount + d));
    document.getElementById('val-p').innerText = s.pCount;
    renderNameList();
}

function initGame() {
    state = { deck: [], discard: [], hands: [], turn: 0, dir: 1, hasDrawn: false, unoCalled: false, skipNext: false };
    
    let decksToGenerate = s.pCount > 5 ? 2 : 1;
    for(let d=0; d<decksToGenerate; d++) {
        COLORS.forEach(c => VALUES.forEach(v => { state.deck.push({c,v}); if(v!=='0') state.deck.push({c,v}); }));
    }
    
    state.deck.sort(() => Math.random() - 0.5);
    for(let i=0; i<s.pCount; i++) state.hands.push(state.deck.splice(0,7));
    state.discard.push(state.deck.pop());
    turnSnapshot = null;
    saveState(); switchScreen('screen-pass'); updateUI();
}

function resetGame() { state = null; turnSnapshot = null; unoPlayers = {}; saveState(); switchScreen('screen-setup'); updateUI(); }
function winNewGame() { document.getElementById('winModal').style.display = 'none'; resetGame(); }

function reshuffle() {
    if(state.deck.length > 0) return;
    if(state.discard.length <= 1) return;
    let top = state.discard.pop();
    state.deck.push(...state.discard.sort(() => Math.random() - 0.5));
    state.discard = [top];
}

function showGame() {
    switchScreen('screen-game');
    state.hasDrawn = false;
    state.unoCalled = false;
    turnSnapshot = null; 
    
    document.querySelectorAll('details').forEach(d => d.open = false);
    document.getElementById('btn-undo').style.display = 'none';
    document.getElementById('btn-draw').style.display = 'block';
    document.getElementById('btn-end-turn').style.display = 'none'; 
    renderTable();
}

function nextTurn() {
    let steps = state.skipNext ? 2 : 1;
    state.turn = (state.turn + (state.dir * steps) + (s.pCount * 2)) % s.pCount;
    
    state.skipNext = false;
    turnSnapshot = null;
    saveState(); switchScreen('screen-pass'); updateUI();
}

function showToast(msg) {
    const t = document.getElementById('forgot-toast');
    t.innerText = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function showUnoBanner(playerNum) {
    const b = document.getElementById('uno-banner');
    b.innerText = DICT[lang].unoCall.replace('{n}', playerNum);
    b.style.display = 'block';
}

function endTurn() {
    if(state.hands[state.turn].length === 1 && !state.unoCalled) {
        showToast(DICT[lang].forgot);
        reshuffle(); if(state.deck.length>0) state.hands[state.turn].push(state.deck.pop());
        reshuffle(); if(state.deck.length>0) state.hands[state.turn].push(state.deck.pop());
    }
    nextTurn();
}

function undoPlay() {
    if(turnSnapshot) {
        state = JSON.parse(turnSnapshot);
        turnSnapshot = null; 
        saveState(); 
        
        document.getElementById('btn-undo').style.display = 'none';
        document.getElementById('btn-draw').style.display = state.hasDrawn ? 'none' : 'block';
        document.getElementById('btn-end-turn').style.display = state.hasDrawn ? 'block' : 'none';
        document.getElementById('btn-end-turn').innerText = DICT[lang].endTurn;
        
        renderTable();
    }
}

function playCard(idx) {
    if(isDragging || turnSnapshot) return; 
    
    let hand = state.hands[state.turn], c = hand[idx], top = state.discard[state.discard.length-1];
    
    if(c.c === top.c || c.v === top.v) {
        turnSnapshot = JSON.stringify(state);

        state.discard.push(hand.splice(idx,1)[0]);
        
        if(hand.length === 0) {
            saveState();
            const m = document.getElementById('winModal');
            document.getElementById('win-modal-title').innerText = DICT[lang].win.replace('{n}', playerName(state.turn));
            document.getElementById('btn-win-new').innerText = DICT[lang].newGame;
            m.style.display = 'flex';
            return;
        }
        
        let isPlusTwo = (c.v === '+2');
        
        if(c.v === 'Rev') { state.dir *= -1; if(s.pCount===2) state.skipNext = true; }
        if(c.v === 'Skip') state.skipNext = true;
        if(isPlusTwo) {
            state.skipNext = true;
            let next1 = (state.turn + state.dir + s.pCount) % s.pCount;
            reshuffle(); if(state.deck.length>0) state.hands[next1].push(state.deck.pop()); 
            reshuffle(); if(state.deck.length>0) state.hands[next1].push(state.deck.pop());
            turnSnapshot = null; // Lock Undo for +2
        }
        
        saveState(); 
        
        document.getElementById('btn-undo').style.display = turnSnapshot ? 'block' : 'none';
        document.getElementById('btn-draw').style.display = 'none';
        document.getElementById('btn-end-turn').style.display = 'block';
        document.getElementById('btn-end-turn').innerText = DICT[lang].passPhone;
        renderTable(); 
    }
}

function drawCard() {
    if(state.hasDrawn || turnSnapshot) return;
    reshuffle();
    if(state.deck.length > 0) state.hands[state.turn].push(state.deck.pop());
    state.hasDrawn = true;
    
    saveState(); 
    
    document.getElementById('btn-draw').style.display = 'none';
    document.getElementById('btn-end-turn').style.display = 'block';
    document.getElementById('btn-end-turn').innerText = DICT[lang].endTurn;
    renderTable();
}

function callUno() {
    if(state.hands[state.turn].length !== 1) return;
    state.unoCalled = true;
    unoPlayers[state.turn] = true;
    saveState();
    updateUnoBanner();
    renderTable();
}

function updateUnoBanner() {
    // Remove players who no longer have exactly 1 card
    Object.keys(unoPlayers).forEach(i => {
        if(!state.hands[i] || state.hands[i].length !== 1) delete unoPlayers[i];
    });
    const b = document.getElementById('uno-banner');
    const names = Object.keys(unoPlayers).map(i => DICT[lang].unoCall.replace('{n}', playerName(parseInt(i))));
    if(names.length > 0) {
        b.innerHTML = names.join('<br>');
        b.style.display = 'block';
    } else {
        b.style.display = 'none';
    }
}

function renderTable() {
    let top = state.discard[state.discard.length-1];
    document.getElementById('discard-pile').innerHTML = `<div class="uno-card ${top.c}">${top.v}</div>`;
    let handDiv = document.getElementById('player-hand'); handDiv.innerHTML = '';
    
    state.hands[state.turn].forEach((c, i) => {
        let cd = document.createElement('div'); cd.className = `uno-card ${c.c}`; cd.innerText = c.v;
        cd.onclick = () => playCard(i); handDiv.appendChild(cd);
    });
    
    document.getElementById('ui-turn-info').innerText = playerName(state.turn);
    const canCallUno = state.hands[state.turn].length === 1 && !state.unoCalled;
    document.getElementById('btn-uno').style.opacity = (state.unoCalled || !canCallUno) ? 0.5 : 1;
    document.getElementById('btn-uno').disabled = !canCallUno;
    updateUnoBanner();
}

function switchScreen(id) { document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active')); document.getElementById(id).classList.add('active'); }

function updateUI() {
    let d = DICT[lang]; document.documentElement.lang = lang;
    
    document.getElementById('ui-setup').innerText = d.setup; 
    document.getElementById('ui-players').innerText = d.players;
    document.getElementById('btn-start').innerText = d.start; 
    document.getElementById('btn-del-setup').innerText = d.del;
    
    document.getElementById('btn-new-pass').innerText = d.newGame;
    document.getElementById('btn-del-pass').innerText = d.del;
    
    document.getElementById('btn-new-game').innerText = d.newGame;
    document.getElementById('btn-del-game').innerText = d.del;
    
    if(state) document.getElementById('ui-pass-msg').innerText = playerName(state.turn);
    document.getElementById('btn-show-cards').innerText = d.showCards; 
    document.getElementById('ui-rules-title').innerText = d.rulesTitle; document.getElementById('rules-text').innerHTML = d.rules;
    document.getElementById('ui-game-menu').innerText = d.menu; document.getElementById('ui-game-menu-pass').innerText = d.menu;
    document.getElementById('btn-undo').innerText = d.undo; document.getElementById('btn-draw').innerText = d.drawBtn;
    document.getElementById('val-p').innerText = s.pCount;
    
    if(state) {
        document.getElementById('btn-end-turn').innerText = turnSnapshot ? d.passPhone : d.endTurn;
    }
}

function initDB() { return new Promise(res => { let req=indexedDB.open('unoGameDB', 1); req.onupgradeneeded=e=>{db=e.target.result;db.createObjectStore('s',{keyPath:'id'})}; req.onsuccess=e=>{db=e.target.result;res()} }); }
function saveState() { if(db) db.transaction('s','readwrite').objectStore('s').put({id:'cur', st:JSON.stringify({s:state, l:lang, names:s.names, pCount:s.pCount})}); }
function loadState() { return new Promise(res => { if(!db){res();return;} let r=db.transaction('s','readonly').objectStore('s').get('cur'); r.onsuccess=()=>{if(r.result){let p=JSON.parse(r.result.st);state=p.s;lang=p.l;if(p.names)s.names=p.names;if(p.pCount)s.pCount=p.pCount;} res()}; r.onerror=()=>res(); }); }
function resetDB() { if(confirm(lang==='en'?"Delete data?":"Veriler silinsin mi?")){indexedDB.deleteDatabase('unoGameDB'); location.reload();} }