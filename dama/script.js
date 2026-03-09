const DICT = {
    en: { title: "Checkers", controls: "Settings", pToMove: "to move", white: "White", black: "Black", undo: "Undo", new: "New", del: "Delete Data", rulesTitle: "Rules", win: "Wins!", rulesTR: "Turkish: Move orthogonal. Captures mandatory (must max capture). Flying kings.", rulesINT: "International: Diagonal dark squares. Mandatory captures.", whiteWon: "White Won!", blackWon: "Black Won!" },
    tr: { title: "Dama", controls: "Ayarlar", pToMove: "hamlesi", white: "Beyaz", black: "Siyah", undo: "Geri Al", new: "Yeni", del: "Verileri Sil", rulesTitle: "Kurallar", win: "Kazandı!", rulesTR: "Türk Daması: İleri/Sağ/Sol. Mecburi yeme kuralı (en çok yiyen yol seçilir).", rulesINT: "Uluslararası: Çapraz. Mecburi yeme kuralı vardır.", whiteWon: "Beyaz Kazandı!", blackWon: "Siyah Kazandı!" }
};
let db, lang = 'en', state = {};
let selIdx = null, validPaths = [], jumpPath = [];

document.addEventListener("DOMContentLoaded", () => {
    initDB().then(() => loadState().then(() => {
        document.getElementById('langPicker').value = lang;
        if(!state.board) initBoard('tr'); else { document.getElementById('tab-tr').className=state.mode==='tr'?'active':''; document.getElementById('tab-int').className=state.mode==='int'?'active':''; render(); }
        updateUI();
    }));
    document.getElementById('langPicker').addEventListener('change', e => { lang = e.target.value; saveState(); updateUI(); render(); });
    document.getElementById('btn-new').onclick = () => { if(confirm("New game?")){ initBoard(state.mode); saveState(); render(); }};
    document.getElementById('btn-undo').onclick = undoMove;
    document.getElementById('btn-del').onclick = resetDB;
});

function switchMode(m) {
    if(state.hist && state.hist.length>0) if(!confirm("Reset game?")) return;
    document.getElementById('tab-tr').className= m==='tr'?'active':'';
    document.getElementById('tab-int').className= m==='int'?'active':'';
    initBoard(m); saveState(); render();
}

function initBoard(m) {
    state = { mode: m, board: Array(64).fill(null), turn: 'w', hist: [], gameOver: false };
    if(m === 'tr') {
        for(let i=8; i<24; i++) state.board[i] = {c:'b', k:false};
        for(let i=40; i<56; i++) state.board[i] = {c:'w', k:false};
    } else {
        for(let i=0; i<24; i++) if((Math.floor(i/8)+i%8)%2!==0) state.board[i] = {c:'b', k:false};
        for(let i=40; i<64; i++) if((Math.floor(i/8)+i%8)%2!==0) state.board[i] = {c:'w', k:false};
    }
    selIdx = null; validPaths = []; jumpPath = [];
    document.getElementById('game-over-overlay').style.display = 'none';
    document.querySelectorAll('details').forEach(d=>d.open=false);
}

function idx(r,c){ return (r<0||r>7||c<0||c>7) ? -1 : r*8+c; }

// FAST SHALLOW ARRAYS FOR DFS
function getMoves(b, i, p) {
    let r=Math.floor(i/8), c=i%8, dir = p.c==='w'?-1:1;
    let paths = [], dirs = state.mode==='tr' ? (p.k ? [[1,0],[-1,0],[0,1],[0,-1]] : [[dir,0],[0,1],[0,-1]]) : (p.k ? [[1,1],[1,-1],[-1,1],[-1,-1]] : [[dir,1],[dir,-1]]);
    
    function searchJumps(cr, cc, curB, curPath, curJumps) {
        let found = false;
        dirs.forEach(d => {
            if(p.k && state.mode==='tr') {
                for(let dist=1; dist<7; dist++) {
                    let jr=cr+d[0]*dist, jc=cc+d[1]*dist, jIdx = idx(jr,jc);
                    if(jIdx===-1) break;
                    let jp = curB[jIdx];
                    if(jp) {
                        if(jp.c === p.c) break;
                        for(let ldist=dist+1; ldist<8; ldist++) {
                            let lr=cr+d[0]*ldist, lc=cc+d[1]*ldist, lIdx = idx(lr,lc);
                            if(lIdx===-1 || curB[lIdx]) break;
                            let nb = [...curB]; nb[lIdx] = nb[idx(cr,cc)]; nb[idx(cr,cc)] = null; nb[jIdx] = null;
                            found = true; searchJumps(lr, lc, nb, [...curPath, lIdx], [...curJumps, jIdx]);
                        }
                        break;
                    }
                }
            } else {
                let jr=cr+d[0], jc=cc+d[1], lr=cr+d[0]*2, lc=cc+d[1]*2;
                let jIdx=idx(jr,jc), lIdx=idx(lr,lc);
                if(jIdx!==-1 && lIdx!==-1 && curB[jIdx] && curB[jIdx].c!==p.c && !curB[lIdx]) {
                    let nb = [...curB]; nb[lIdx] = nb[idx(cr,cc)]; nb[idx(cr,cc)] = null; nb[jIdx] = null;
                    found = true; searchJumps(lr, lc, nb, [...curPath, lIdx], [...curJumps, jIdx]);
                }
            }
        });
        if(!found && curJumps.length > 0) paths.push({path: curPath, jumps: curJumps});
    }
    searchJumps(r, c, b, [], []);

    if(paths.length === 0) {
        dirs.forEach(d => {
            if(p.k && state.mode==='tr') {
                for(let dist=1; dist<8; dist++) {
                    let lr=r+d[0]*dist, lc=c+d[1]*dist, lIdx = idx(lr,lc);
                    if(lIdx===-1 || b[lIdx]) break;
                    paths.push({path:[lIdx], jumps:[]});
                }
            } else {
                let lIdx = idx(r+d[0], c+d[1]);
                if(lIdx!==-1 && !b[lIdx]) paths.push({path:[lIdx], jumps:[]});
            }
        });
    }
    return paths;
}

function calcAllMoves() {
    let all = [], maxJ = 0;
    for(let i=0; i<64; i++) {
        let p = state.board[i];
        if(p && p.c === state.turn) {
            getMoves(state.board, i, p).forEach(m => {
                if(m.jumps.length > maxJ) maxJ = m.jumps.length;
                all.push({from: i, ...m});
            });
        }
    }
    return all.filter(m => m.jumps.length === maxJ);
}

function handleSqClick(i) {
    if (state.gameOver) return; // GAME LOCK
    let allMoves = calcAllMoves(), p = state.board[i];
    
    if(selIdx !== null) {
        let validNext = validPaths.filter(vp => vp.path[jumpPath.length] === i);
        if(validNext.length > 0) {
            let curPath = validNext[0];
            
            // BUG FIX: Prevent O(2^N) memory explosion
            let h = state.hist; state.hist = [];
            let str = JSON.stringify(state);
            state.hist = h; state.hist.push(str);
            
            let stepJumpIdx = curPath.jumps[jumpPath.length];
            state.board[i] = state.board[selIdx]; state.board[selIdx] = null;
            if(stepJumpIdx !== undefined) state.board[stepJumpIdx] = null;
            
            jumpPath.push(i); selIdx = i;
            let pr = state.turn==='w'?0:7;
            if(Math.floor(i/8) === pr && !state.board[i].k) state.board[i] = { ...state.board[i], k:true };

            if(jumpPath.length === curPath.path.length) {
                state.turn = state.turn === 'w' ? 'b' : 'w';
                selIdx = null; validPaths = []; jumpPath = [];
            } else validPaths = validNext;
            
            saveState(); render(); return;
        }
    }

    if(jumpPath.length > 0) return; 
    if(p && p.c === state.turn) {
        let pMoves = allMoves.filter(m => m.from === i);
        if(pMoves.length > 0) { selIdx = i; validPaths = pMoves; render(); }
    } else { selIdx = null; validPaths = []; render(); }
}

function checkWin() {
    let count = {w:0, b:0};
    state.board.forEach(p => { if(p) count[p.c]++; });
    let st = document.getElementById('status-bar');
    let overlay = document.getElementById('game-over-overlay');
    let hasMoves = state.turn ? calcAllMoves().length > 0 : false;

    if(count.w === 0 || (state.turn === 'w' && !hasMoves)) { 
        state.gameOver = true; state.turn = null;
        st.innerText = `${DICT[lang].black} ${DICT[lang].win}`; 
        overlay.innerText = DICT[lang].blackWon;
        overlay.style.display = 'block';
    } else if(count.b === 0 || (state.turn === 'b' && !hasMoves)) { 
        state.gameOver = true; state.turn = null;
        st.innerText = `${DICT[lang].white} ${DICT[lang].win}`; 
        overlay.innerText = DICT[lang].whiteWon;
        overlay.style.display = 'block';
    } else if (state.turn) {
        state.gameOver = false;
        overlay.style.display = 'none';
        st.innerText = `${DICT[lang][state.turn==='w'?'white':'black']} ${DICT[lang].pToMove}`;
    }
}

function render() {
    let b = document.getElementById('board'); b.innerHTML = '';
    let nextStepIdxs = validPaths.map(vp => vp.path[jumpPath.length]);

    for(let i=0; i<64; i++) {
        let sq = document.createElement('div'), r=Math.floor(i/8), c=i%8;
        sq.className = `sq ${(r+c)%2===0 ? 'light' : 'dark'}`;
        if(selIdx === i || nextStepIdxs.includes(i)) sq.classList.add('highlight');
        sq.onclick = () => handleSqClick(i);

        let p = state.board[i];
        if(p) { let el = document.createElement('div'); el.className = `piece ${p.c} ${p.k?'king':''}`; sq.appendChild(el); }
        b.appendChild(sq);
    }
    checkWin(); // Checks state and updates overlay
}

function undoMove() { 
    if(state.hist.length === 0) return; 
    let h = state.hist; let popped = h.pop(); 
    state = JSON.parse(popped); 
    state.hist = h; // Restore separated history
    selIdx = null; validPaths = []; jumpPath = []; 
    saveState(); render(); 
}

function updateUI() {
    let d = DICT[lang]; document.documentElement.lang = lang;
    document.getElementById('ui-title').innerText = d.title; document.getElementById('ui-controls').innerText = d.controls;
    document.getElementById('btn-undo').innerText = d.undo; document.getElementById('btn-new').innerText = d.new; document.getElementById('btn-del').innerText = d.del;
    document.getElementById('ui-rules-title').innerText = d.rulesTitle; document.getElementById('rules-text').innerHTML = `<p>${d.rulesTR}</p><p>${d.rulesINT}</p>`;
}
function initDB() { return new Promise(res => { let req=indexedDB.open('damaGameDB', 1); req.onupgradeneeded=e=>{db=e.target.result;db.createObjectStore('s',{keyPath:'id'})}; req.onsuccess=e=>{db=e.target.result;res()} }); }
function saveState() { if(db) db.transaction('s','readwrite').objectStore('s').put({id:'cur', st:JSON.stringify({s:state, l:lang})}); }
function loadState() { return new Promise(res => { if(!db)res(); let r=db.transaction('s','readonly').objectStore('s').get('cur'); r.onsuccess=()=>{if(r.result){let p=JSON.parse(r.result.st);state=p.s;lang=p.l;} res()} }); }
function resetDB() { if(confirm("Delete data?")){indexedDB.deleteDatabase('damaGameDB'); location.reload();} }