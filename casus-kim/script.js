// --- DATA: Locations and Roles ---
const LOCATIONS = {
    en: ["Paris", "Hospital", "Space Station", "Airport", "Beach", "University", "Submarine", "Bank", "Circus", "Hotel"],
    tr: ["Paris", "Hastane", "Uzay İstasyonu", "Havalimanı", "Plaj", "Üniversite", "Denizaltı", "Banka", "Sirk", "Otel"]
};

const ROLES = {
    en: { villager: "Villager", spy: "Spy" },
    tr: { villager: "Köylü", spy: "Casus" }
};

// --- TRANSLATIONS ---
const DICT = {
    en: {
        title: "🕵️ Casus Kim? (Spyfall)",
        players: "Players",
        spies: "Spies",
        timer: "Round Timer",
        start: "Start Game",
        delData: "Delete Game Data",
        rulesTitle: "Rules",
        playerN: "Player",
        tapReveal: "Tap to reveal your role",
        showRole: "Show Role",
        hidePass: "Hide and Pass Phone",
        locLabel: "📍 Location:",
        roleLabel: "🎭 Role:",
        spyAlert: "🚨 YOU ARE THE SPY",
        roundStart: "Round Started",
        spyGuess: "Spy Guess",
        endRound: "End Round",
        timeUp: "Time is up!\nVote for the spy.",
        spyLimitWarning: "Max spies for {n} players is {s}.",
        rulesText: `
            <p><strong>Casus Kim?</strong> is a social deduction game designed for friend groups, based on speed, intelligence, and bluffing.</p>
            <h3>Basic Rules</h3>
            <ul>
                <li><strong>Role Distribution:</strong> Each player takes the device and views their role. Villagers see a location. The Spy does not see the location.</li>
                <li><strong>Q&A:</strong> Players ask each other open-ended questions (e.g., "How is the weather there?").</li>
                <li><strong>Information Flow:</strong> Villagers try to prove they know the location without giving away too many details to the Spy.</li>
                <li><strong>Spy's Goal:</strong> Listen and piece together clues to guess the location.</li>
            </ul>
            <h3>End of Game</h3>
            <ul>
                <li><strong>Time's Up:</strong> Players vote on who the spy is. If the majority votes wrong, Spies win.</li>
                <li><strong>Spy Guess:</strong> The Spy can stop the game to guess the location. If correct, Spy wins. If wrong, Villagers win.</li>
                <li><strong>Exposed:</strong> If the group unanimously catches the spy, Villagers win.</li>
            </ul>`
    },
    tr: {
        title: "🕵️ Casus Kim?",
        players: "Oyuncular",
        spies: "Casuslar",
        timer: "Tur Süresi",
        start: "Oyunu Başlat",
        delData: "Oyun Verilerini Sil",
        rulesTitle: "Kurallar",
        playerN: "Oyuncu",
        tapReveal: "Rolünü görmek için dokun",
        showRole: "Rolü Göster",
        hidePass: "Gizle ve Telefonu Devret",
        locLabel: "📍 Mekan:",
        roleLabel: "🎭 Rol:",
        spyAlert: "🚨 CASUS SENSİN",
        roundStart: "Tur Başladı",
        spyGuess: "Casus Tahmini",
        endRound: "Turu Bitir",
        timeUp: "Süre doldu!\nCasusu oylayın.",
        spyLimitWarning: "{n} oyuncu için maks casus: {s}.",
        rulesText: `
            <p>Casus Kim?, arkadaş grupları için tasarlanmış, hız, zeka ve blöf üzerine kurulu bir sosyal çıkarım oyunudur. Oyunun temel amacı, gruptaki gizli casusları deşifre etmek ya da casus olarak gruptan gelen bilgileri kullanarak kimliğinizi gizlemektir.</p>
            <h3>Temel Kurallar</h3>
            <ul>
                <li><strong>Rol Dağılımı:</strong> Her oyuncu cihazı sırayla eline alır ve rolüne bakar. Köylüler seçilen mekan veya kişi bilgisini görür. Casus ise bu bilgiyi göremez, sadece casus olduğunu bilir.</li>
                <li><strong>Soru-Cevap:</strong> Bir oyuncu başka bir oyuncuya soru sorarak başlar. Sorular genellikle açık uçlu olmalıdır (Örn: "Bugün orada hava nasıl?").</li>
                <li><strong>Bilgi Akışı:</strong> Köylüler, detay vermemeye dikkat etmelidir. Çünkü casus, bu ipuçlarını birleştirerek doğru tahmini yapabilir.</li>
                <li><strong>Casusun Amacı:</strong> Casus, konuşulan mekanı anlamaya çalışır.</li>
            </ul>
            <h3>Oyunun Bitmesi</h3>
            <ul>
                <li><strong>Zaman Dolduğunda:</strong> Tur süresi bittiğinde herkes oylama yapar. En çok oyu alan kişi casus değilse, Casuslar kazanır.</li>
                <li><strong>Tahmin Yapıldığında:</strong> Casus, istediği an oyunu durdurup doğru tahmini yaparsa anında kazanır. Yanlış yaparsa Köylüler kazanır.</li>
                <li><strong>Deşifre Edildiğinde:</strong> Grup oy birliği ile casusu bulursa Köylüler kazanır.</li>
            </ul>`
    }
};

// --- STATE ---
let db;
let lang = 'en';
let settings = { players: 5, spies: 1, timer: 240 }; // timer in seconds
let gameState = { assignedRoles: [], currentPlayerIndex: 0, interval: null, remainingTime: 0 };

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
    initIndexedDB().then(() => {
        loadSettings().then(() => {
            document.getElementById('langPicker').value = lang;
            updateUI();
        });
    });

    document.getElementById('langPicker').addEventListener('change', (e) => {
        lang = e.target.value;
        saveSettings();
        updateUI();
    });
});

function updateUI() {
    const d = DICT[lang];
    document.documentElement.lang = lang;
    document.getElementById('ui-title').innerText = d.title;
    document.getElementById('ui-players-label').innerText = d.players;
    document.getElementById('ui-spies-label').innerText = d.spies;
    document.getElementById('ui-timer-label').innerText = d.timer;
    document.getElementById('btn-start').innerText = d.start;
    document.getElementById('btn-delete-db').innerText = d.delData;
    document.getElementById('ui-rules-title').innerText = d.rulesTitle;
    document.getElementById('rules-text').innerHTML = d.rulesText;
    document.getElementById('ui-tap-reveal').innerText = d.tapReveal;
    document.getElementById('btn-show-role').innerText = d.showRole;
    document.getElementById('btn-hide-role').innerText = d.hidePass;
    document.getElementById('ui-round-started').innerText = d.roundStart;
    document.getElementById('btn-spy-guess').innerText = d.spyGuess;
    document.getElementById('btn-end-round').innerText = d.endRound;

    document.getElementById('val-players').innerText = settings.players;
    document.getElementById('val-spies').innerText = settings.spies;
    document.getElementById('val-timer').innerText = formatTime(settings.timer);
    
    validateSpyCount();
}

function updateSettings(key, delta) {
    if (key === 'players') {
        settings.players = Math.max(3, Math.min(20, settings.players + delta));
        validateSpyCount();
    } else if (key === 'spies') {
        let maxSpies = getMaxSpies(settings.players);
        settings.spies = Math.max(1, Math.min(maxSpies, settings.spies + delta));
    } else if (key === 'timer') {
        settings.timer = Math.max(60, Math.min(900, settings.timer + delta)); // 1 min to 15 mins
    }
    saveSettings();
    updateUI();
}

function getMaxSpies(pCount) {
    let max = pCount % 2 === 0 ? Math.floor(pCount / 2) : Math.ceil(pCount / 2) - 1;
    return Math.max(1, max); // Ensure at least 1 spy is possible
}

function validateSpyCount() {
    let maxSpies = getMaxSpies(settings.players);
    const warningEl = document.getElementById('ui-spy-limit');
    
    if (settings.spies > maxSpies) {
        settings.spies = maxSpies;
        document.getElementById('val-spies').innerText = settings.spies;
        saveSettings();
    }
    
    if (settings.spies === maxSpies) {
        warningEl.innerText = DICT[lang].spyLimitWarning.replace('{n}', settings.players).replace('{s}', maxSpies);
    } else {
        warningEl.innerText = "";
    }
}

function formatTime(seconds) {
    let m = Math.floor(seconds / 60).toString().padStart(2, '0');
    let s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// --- GAMEPLAY FLOW ---
function initGame() {
    generateRoles();
    gameState.currentPlayerIndex = 0;
    switchScreen('revealScreen');
    prepareRevealScreen();
}

function generateRoles() {
    let locs = LOCATIONS[lang];
    let chosenLocation = locs[Math.floor(Math.random() * locs.length)];
    
    let roles = Array(settings.players).fill({ type: 'villager', loc: chosenLocation });
    
    // Assign spies
    let spyIndices = [];
    while (spyIndices.length < settings.spies) {
        let r = Math.floor(Math.random() * settings.players);
        if (!spyIndices.includes(r)) spyIndices.push(r);
    }
    
    spyIndices.forEach(idx => {
        roles[idx] = { type: 'spy', loc: null };
    });

    gameState.assignedRoles = roles;
}

function prepareRevealScreen() {
    document.getElementById('reveal-player-title').innerText = `${DICT[lang].playerN} ${gameState.currentPlayerIndex + 1}`;
    document.getElementById('reveal-hidden-state').style.display = 'block';
    document.getElementById('reveal-shown-state').style.display = 'none';
}

function showRole() {
    document.getElementById('reveal-hidden-state').style.display = 'none';
    document.getElementById('reveal-shown-state').style.display = 'block';
    
    const roleObj = gameState.assignedRoles[gameState.currentPlayerIndex];
    const box = document.getElementById('role-display-box');
    const roleLoc = document.getElementById('role-location');
    const roleName = document.getElementById('role-name');

    if (roleObj.type === 'spy') {
        box.className = 'role-box spy';
        roleLoc.style.display = 'none';
        roleName.innerText = DICT[lang].spyAlert;
    } else {
        box.className = 'role-box';
        roleLoc.style.display = 'block';
        roleLoc.innerText = `${DICT[lang].locLabel} ${roleObj.loc}`;
        roleName.innerText = `${DICT[lang].roleLabel} ${ROLES[lang].villager}`;
    }
}

function hideRole() {
    nextPlayer();
}

function nextPlayer() {
    gameState.currentPlayerIndex++;
    if (gameState.currentPlayerIndex >= settings.players) {
        startDiscussionTimer();
    } else {
        prepareRevealScreen();
    }
}

function startDiscussionTimer() {
    switchScreen('discussionScreen');
    gameState.remainingTime = settings.timer;
    const timerDisplay = document.getElementById('discussion-timer');
    
    function tick() {
        timerDisplay.innerText = formatTime(gameState.remainingTime);
        if (gameState.remainingTime <= 30) timerDisplay.classList.add('low');
        else timerDisplay.classList.remove('low');

        if (gameState.remainingTime <= 0) {
            clearInterval(gameState.interval);
            alert(DICT[lang].timeUp);
            endRound();
        } else {
            gameState.remainingTime--;
        }
    }
    
    tick(); // run immediately
    gameState.interval = setInterval(tick, 1000);
}

function spyGuess() {
    if(confirm(lang === 'en' ? "Spy is guessing the location. End round?" : "Casus tahminde bulunuyor. Tur bitirilsin mi?")) {
        endRound();
    }
}

function endRound() {
    clearInterval(gameState.interval);
    document.getElementById('discussion-timer').classList.remove('low');
    switchScreen('setupScreen');
}

// --- UTILS ---
function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function openRules() { document.getElementById('rulesModal').style.display = 'flex'; }
function closeRules() { document.getElementById('rulesModal').style.display = 'none'; }

// --- INDEXEDDB ---
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('casusKimGameDB', 1);
        req.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function saveSettings() {
    if(!db) return;
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'prefs', lang, settings });
}

function loadSettings() {
    return new Promise((resolve) => {
        if(!db) resolve();
        const tx = db.transaction('settings', 'readonly');
        const req = tx.objectStore('settings').get('prefs');
        req.onsuccess = () => {
            if (req.result) {
                lang = req.result.lang || 'en';
                settings = req.result.settings || settings;
            }
            resolve();
        };
        req.onerror = () => resolve();
    });
}

function resetIndexedDB() {
    if(confirm(lang === 'en' ? "Delete all Casus Kim game data?" : "Tüm Casus Kim verileri silinecek. Emin misiniz?")) {
        if(db) db.close();
        const req = indexedDB.deleteDatabase('casusKimGameDB');
        req.onsuccess = () => window.location.reload();
    }
}