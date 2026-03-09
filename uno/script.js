const DICT = {
    en: { setup: "Setup Game", players: "Players: ", start: "Start", del: "Delete Data", pTurn: "Player {n} Turn", showCards: "Tap to show cards", endTurn: "Pass Phone", rulesTitle: "Rules", win: "Player {n} Wins!", noMatch: "No match! Draw a card.", forgot: "Forgot UNO! Drew 2 cards.", rules: "Match color or number. Special cards: +2, Skip, Reverse. Press UNO when 1 card left." },
    tr: { setup: "Oyunu Kur", players: "Oyuncular: ", start: "Başlat", del: "Verileri Sil", pTurn: "Oyuncu {n} Sırası", showCards: "Kartları görmek için dokun", endTurn: "Telefonu Devret", rulesTitle: "Kurallar", win: "Oyuncu {n} Kazandı!", noMatch: "Eşleşme yok! Kart çek.", forgot: "UNO demeyi unuttun! 2 kart çektin.", rules: "Aynı renk veya sayıyı at. Özel: +2, Pas, Yön Değiştir. 1 kart kalınca UNO de." }
};
const COLORS = ['red','blue','green','yellow'];
const VALUES = ['0','1','2','3','4','5','6','7','8','9','+2','Skip','Rev'];
let db, lang = 'en', s = { pCount: 2 };
let state = null; // deck, discard, hands, turn, dir, hasDrawn, unoCalled

document.addEventListener("DOMContentLoaded", () => {
    initDB().then(() => loadState().then(() => {
        document.getElementById('langPicker').value = lang;
        if(state) { switchScreen('screen-pass'); updateUI(); } else updateUI();
    }));
    document.getElementById('langPicker').addEventListener('change', e => { lang = e.target.value; if(state)saveState(); updateUI(); });
});

function changeP(d) { s.pCount = Math.max(2, Math.min(6, s.pCount+d)); document.getElementById('val-p').innerText = s.pCount; }

function initGame() {
    state = { deck: [], discard: [], hands: [], turn: 0, dir: 1, hasDrawn: false, unoCalled: false };
    COLORS.forEach(c => VALUES.forEach(v => { state.deck.push({c,v}); if(v!=='0') state.deck.push({c,v}); }));
    state.deck.sort(() => Math.random() - 0.5);
    for(let i=0; i<s.pCount; i++) state.hands.push(state.deck.splice(0,7));
    state.discard.push(state.deck.pop());
    saveState(); switchScreen('screen-pass'); updateUI();
}

function showGame() {
    switchScreen('screen-game');
    state.hasDrawn = false; state.unoCalled = false;
    renderTable();
}

function nextTurn() {
    state.turn = (state.turn + state.dir + s.pCount) % s.pCount;
    saveState(); switchScreen('screen-pass'); updateUI();
}

function endTurn() {
    if(state.hands[state.turn].length === 1 && !state.unoCalled) {
        alert(DICT[lang].forgot); state.hands[state.turn].push(...state.deck.splice(0,2));
    }
    nextTurn();
}

function playCard(idx) {
    if(state.hasDrawn) return;
    let hand = state.hands[state.turn], c = hand[idx], top = state.discard[state.discard.length-1];
    if(c.c === top.c || c.v === top.v) {
        state.discard.push(hand.splice(idx,1)[0]);
        if(hand.length === 0) { alert(DICT[lang].win.replace('{n}', state.turn+1)); state=null; saveState(); switchScreen('screen-setup'); return; }
        
        if(c.v === 'Rev') { state.dir *= -1; if(s.pCount===2) state.turn = (state.turn + state.dir + s.pCount)%s.pCount; }
        if(c.v === 'Skip') state.turn = (state.turn + state.dir + s.pCount)%s.pCount;
        if(c.v === '+2') {
            let next = (state.turn + state.dir + s.pCount)%s.pCount;
            state.hands[next].push(...state.deck.splice(0,2));
            state.turn = next; // skip next player
        }
        endTurn();
    }
}

function drawCard() {
    if(state.hasDrawn) return;
    state.hands[state.turn].push(state.deck.pop());
    state.hasDrawn = true;
    renderTable();
    document.getElementById('btn-end-turn').style.display = 'block';
}

function callUno() { state.unoCalled = true; document.getElementById('btn-uno').style.opacity = 0.5; }

function renderTable() {
    let top = state.discard[state.discard.length-1];
    document.getElementById('discard-pile').innerHTML = `<div class="uno-card ${top.c}">${top.v}</div>`;
    let handDiv = document.getElementById('player-hand'); handDiv.innerHTML = '';
    state.hands[state.turn].forEach((c, i) => {
        let cd = document.createElement('div'); cd.className = `uno-card ${c.c}`; cd.innerText = c.v;
        cd.onclick = () => playCard(i); handDiv.appendChild(cd);
    });
    document.getElementById('ui-turn-info').innerText = DICT[lang].pTurn.replace('{n}', state.turn+1);
    document.getElementById('btn-end-turn').style.display = 'none';
    document.getElementById('btn-uno').style.opacity = 1;
}

function switchScreen(id) { document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active')); document.getElementById(id).classList.add('active'); }

function updateUI() {
    let d = DICT[lang]; document.documentElement.lang = lang;
    document.getElementById('ui-setup').innerText = d.setup; document.getElementById('ui-players').innerText = d.players;
    document.getElementById('btn-start').innerText = d.start; document.getElementById('btn-del').innerText = d.del;
    if(state) document.getElementById('ui-pass-msg').innerText = d.pTurn.replace('{n}', state.turn+1);
    document.getElementById('btn-show-cards').innerText = d.showCards; document.getElementById('btn-end-turn').innerText = d.endTurn;
    document.getElementById('ui-rules-title').innerText = d.rulesTitle; document.getElementById('rules-text').innerText = d.rules;
}

function initDB() { return new Promise(res => { let req=indexedDB.open('unoGameDB', 1); req.onupgradeneeded=e=>{db=e.target.result;db.createObjectStore('s',{keyPath:'id'})}; req.onsuccess=e=>{db=e.target.result;res()} }); }
function saveState() { if(db) db.transaction('s','readwrite').objectStore('s').put({id:'cur', st:JSON.stringify({s:state, l:lang})}); }
function loadState() { return new Promise(res => { if(!db)res(); let r=db.transaction('s','readonly').objectStore('s').get('cur'); r.onsuccess=()=>{if(r.result){let p=JSON.parse(r.result.st);state=p.s;lang=p.l;} res()} }); }
function resetDB() { if(confirm("Delete data?")){indexedDB.deleteDatabase('unoGameDB'); location.reload();} }