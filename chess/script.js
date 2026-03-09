const DICT = {
    en: { title: "Chess", pToMove: "to move", white: "White", black: "Black", check: "Check!", mate: "Checkmate!", draw: "Draw", undo: "Undo Move", new: "New Game", del: "Delete Data", hist: "Move History", promo: "Promote Pawn", rulesTitle: "Rules", rules: "<p>Standard 8x8 rules apply. Includes En Passant, Castling, Promotion, Checkmate, and basic draws.</p>" },
    tr: { title: "Satranç", pToMove: "hamlesi", white: "Beyaz", black: "Siyah", check: "Şah!", mate: "Şah Mat!", draw: "Berabere", undo: "Geri Al", new: "Yeni Oyun", del: "Verileri Sil", hist: "Hamle Geçmişi", promo: "Terfi", rulesTitle: "Kurallar", rules: "<p>Standart 8x8 kuralları geçerlidir. Geçerken alma (En Passant), Rok, Terfi, Şah Mat ve beraberlikler dahildir.</p>" }
};
const P = { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };
let db, lang = 'en', state = {};
let selIdx = null, validMoves = [];
let pendingPromo = null;

document.addEventListener("DOMContentLoaded", () => {
    initDB().then(() => loadState().then(() => {
        document.getElementById('langPicker').value = lang;
        if(!state.board) initBoard(); else render();
        updateUI();
    }));
    document.getElementById('langPicker').addEventListener('change', e => { lang = e.target.value; saveState(); updateUI(); render(); });
    document.getElementById('btn-new').onclick = () => { initBoard(); saveState(); render(); };
    document.getElementById('btn-undo').onclick = undoMove;
    document.getElementById('btn-del').onclick = resetDB;
    document.getElementById('btn-rules').onclick = () => document.getElementById('rulesModal').style.display = 'flex';
});

function initBoard() {
    state = {
        board: Array(64).fill(null), turn: 'w', hist: [], log: [],
        castling: { w: {k:true, q:true}, b: {k:true, q:true} }, ep: null, halfMoves: 0
    };
    const setup = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR";
    for(let i=0; i<64; i++) {
        let c = setup[i];
        if(c !== '.') state.board[i] = { type: c.toLowerCase(), color: c === c.toUpperCase() ? 'w' : 'b' };
    }
    selIdx = null; validMoves = []; pendingPromo = null;
}

function idx(r, c) { return r*8 + c; }
function rc(i) { return { r: Math.floor(i/8), c: i%8 }; }

function getPseudoMoves(board, i, color, type, ep) {
    let m = [], {r, c} = rc(i), dir = color === 'w' ? -1 : 1;
    let add = (nr, nc) => {
        if(nr<0||nr>7||nc<0||nc>7) return false;
        let t = board[idx(nr, nc)];
        if(!t) { m.push(idx(nr, nc)); return true; }
        if(t.color !== color) m.push(idx(nr, nc)); return false;
    };
    if(type === 'p') {
        if(r+dir>=0 && r+dir<=7 && !board[idx(r+dir, c)]) {
            m.push(idx(r+dir, c));
            if((color === 'w' && r === 6 || color === 'b' && r === 1) && !board[idx(r+dir*2, c)]) m.push(idx(r+dir*2, c));
        }
        for(let dc of [-1, 1]) {
            if(c+dc>=0 && c+dc<=7 && r+dir>=0 && r+dir<=7) {
                let tgt = idx(r+dir, c+dc);
                if(board[tgt] && board[tgt].color !== color) m.push(tgt);
                else if(tgt === ep) m.push(tgt);
            }
        }
    } else if(type === 'n') {
        [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(d => add(r+d[0], c+d[1]));
    } else if(type === 'k') {
        [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(d => add(r+d[0], c+d[1]));
    } else {
        let dirs = type==='r'? [[0,1],[0,-1],[1,0],[-1,0]] : type==='b'? [[1,1],[1,-1],[-1,1],[-1,-1]] : [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
        dirs.forEach(d => { for(let st=1; st<8; st++) if(!add(r+d[0]*st, c+d[1]*st)) break; });
    }
    return m;
}

function isAttacked(board, t_idx, color) {
    for(let i=0; i<64; i++) {
        let p = board[i];
        if(p && p.color !== color) {
            let moves = getPseudoMoves(board, i, p.color, p.type, null);
            if(moves.includes(t_idx)) return true;
        }
    }
    return false;
}

function getLegalMoves(board, i, st) {
    let p = board[i]; if(!p || p.color !== st.turn) return [];
    let moves = getPseudoMoves(board, i, p.color, p.type, st.ep), legal = [];
    moves.forEach(to => {
        let nb = JSON.parse(JSON.stringify(board));
        nb[to] = p; nb[i] = null;
        if(p.type==='p' && to === st.ep) nb[to + (p.color==='w'?8:-8)] = null; // ep capture
        let kIdx = nb.findIndex(x => x && x.type==='k' && x.color===p.color);
        if(!isAttacked(nb, kIdx, p.color)) legal.push(to);
    });
    // Castling
    if(p.type === 'k' && !isAttacked(board, i, p.color)) {
        let {r, c} = rc(i);
        let cr = st.castling[p.color];
        if(cr.k && !board[i+1] && !board[i+2] && !isAttacked(board, i+1, p.color) && !isAttacked(board, i+2, p.color)) legal.push(i+2);
        if(cr.q && !board[i-1] && !board[i-2] && !board[i-3] && !isAttacked(board, i-1, p.color) && !isAttacked(board, i-2, p.color)) legal.push(i-2);
    }
    return legal;
}

function handleSqClick(i) {
    if(pendingPromo) return;
    let p = state.board[i];
    if(selIdx !== null && validMoves.includes(i)) {
        executeMove(selIdx, i);
    } else if(p && p.color === state.turn) {
        selIdx = i; validMoves = getLegalMoves(state.board, i, state); render();
    } else { selIdx = null; validMoves = []; render(); }
}

function executeMove(from, to, promoPiece=null) {
    let p = state.board[from], tgt = state.board[to];
    let isEp = p.type==='p' && to === state.ep;
    let isCastle = p.type==='k' && Math.abs(from-to)===2;
    let isPromo = p.type==='p' && (Math.floor(to/8)===0 || Math.floor(to/8)===7);

    if(isPromo && !promoPiece) { pendingPromo = {from, to}; showPromo(); return; }

    state.hist.push(JSON.stringify(state)); // save full state
    state.halfMoves = (p.type==='p' || tgt) ? 0 : state.halfMoves+1;
    
    state.board[to] = promoPiece ? {type:promoPiece, color:p.color} : p;
    state.board[from] = null;
    
    if(isEp) state.board[to + (p.color==='w'?8:-8)] = null;
    if(isCastle) {
        let rookFrom = to>from ? to+1 : to-2, rookTo = to>from ? to-1 : to+1;
        state.board[rookTo] = state.board[rookFrom]; state.board[rookFrom] = null;
    }

    state.ep = (p.type==='p' && Math.abs(from-to)===16) ? from + (p.color==='w'?-8:8) : null;
    
    if(p.type==='k') state.castling[p.color] = {k:false, q:false};
    if(p.type==='r') {
        if(from===0) state.castling.b.q=false; if(from===7) state.castling.b.k=false;
        if(from===56) state.castling.w.q=false; if(from===63) state.castling.w.k=false;
    }
    
    state.log.push(`${p.color}: ${rc(from).c},${rc(from).r} -> ${rc(to).c},${rc(to).r}`);
    state.turn = state.turn === 'w' ? 'b' : 'w';
    selIdx = null; validMoves = []; pendingPromo = null;
    
    checkGameState();
    saveState(); render();
}

function showPromo() {
    let m = document.getElementById('promoModal'), o = document.getElementById('promo-options');
    o.innerHTML = '';
    ['q','r','b','n'].forEach(pt => {
        let s = document.createElement('span'); s.innerText = P[pt]; s.className = `piece ${state.turn}`;
        s.onclick = () => { m.style.display='none'; executeMove(pendingPromo.from, pendingPromo.to, pt); };
        o.appendChild(s);
    });
    m.style.display = 'flex';
}

function checkGameState() {
    let hasMoves = false, inCheck = false;
    let kIdx = state.board.findIndex(x => x && x.type==='k' && x.color===state.turn);
    inCheck = isAttacked(state.board, kIdx, state.turn);
    for(let i=0; i<64; i++) {
        if(getLegalMoves(state.board, i, state).length > 0) { hasMoves = true; break; }
    }
    let st = document.getElementById('status-bar');
    if(!hasMoves) {
        st.innerText = inCheck ? DICT[lang].mate : DICT[lang].draw;
        state.turn = null; // stop game
    } else {
        st.innerText = `${DICT[lang][state.turn==='w'?'white':'black']} ${DICT[lang].pToMove} ` + (inCheck ? ` (${DICT[lang].check})` : '');
    }
}

function render() {
    let b = document.getElementById('board'); b.innerHTML = '';
    let kIdx = state.board.findIndex(x => x && x.type==='k' && x.color===state.turn);
    let inCheck = isAttacked(state.board, kIdx, state.turn);

    for(let i=0; i<64; i++) {
        let sq = document.createElement('div'), {r, c} = rc(i);
        sq.className = `sq ${(r+c)%2===0 ? 'light' : 'dark'}`;
        if(selIdx === i) sq.classList.add('highlight');
        if(validMoves.includes(i)) sq.classList.add('dot');
        if(inCheck && i === kIdx) sq.classList.add('check');
        sq.onclick = () => handleSqClick(i);

        let p = state.board[i];
        if(p) {
            let el = document.createElement('div'); el.className = `piece ${p.color}`;
            el.innerHTML = P[p.type]; sq.appendChild(el);
        }
        b.appendChild(sq);
    }
    document.getElementById('history-log').innerHTML = state.log.slice(-15).reverse().join('<br>');
    if(state.turn) checkGameState();
}

function undoMove() {
    if(state.hist.length === 0) return;
    state = JSON.parse(state.hist.pop());
    selIdx = null; validMoves = []; pendingPromo = null;
    saveState(); render();
}

function updateUI() {
    let d = DICT[lang]; document.documentElement.lang = lang;
    document.getElementById('ui-title').innerText = d.title;
    document.getElementById('btn-undo').innerText = d.undo;
    document.getElementById('btn-new').innerText = d.new;
    document.getElementById('btn-del').innerText = d.del;
    document.getElementById('ui-history').innerText = d.hist;
    document.getElementById('ui-promo-title').innerText = d.promo;
    document.getElementById('ui-rules-title').innerText = d.rulesTitle;
    document.getElementById('rules-text').innerHTML = d.rules;
}

function initDB() {
    return new Promise(res => {
        let req = indexedDB.open('chessGameDB', 1);
        req.onupgradeneeded = e => { db=e.target.result; if(!db.objectStoreNames.contains('s')) db.createObjectStore('s', {keyPath:'id'}); };
        req.onsuccess = e => { db=e.target.result; res(); };
    });
}
function saveState() { if(db) db.transaction('s','readwrite').objectStore('s').put({id:'cur', st:JSON.stringify({s:state, l:lang})}); }
function loadState() {
    return new Promise(res => {
        if(!db) res();
        let r = db.transaction('s','readonly').objectStore('s').get('cur');
        r.onsuccess = () => { if(r.result) { let p = JSON.parse(r.result.st); state = p.s; lang = p.l; } res(); };
    });
}
function resetDB() { if(confirm("Delete data?")) { indexedDB.deleteDatabase('chessGameDB'); location.reload(); } }