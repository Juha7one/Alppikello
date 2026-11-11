// --- Alppikello Multi-Language Voice UI, FIS Start Cadence, Combined Start Gate & Cold-Weather Eco Mode ---

const VOICE_LANG_STORAGE_KEY = 'alppikello_voice_lang';
const VOICE_TTS_STORAGE_KEY = 'alppikello_voice_tts_enabled';
const VOICE_ATHLETE_FILTER_KEY = 'alppikello_voice_own_only';
const STARTER_CAM_STORAGE_KEY = 'alppikello_starter_cam_enabled';

let voiceLang = localStorage.getItem(VOICE_LANG_STORAGE_KEY) || 'FI';
let voiceListening = false;
let voiceListenMode = null; // 'role' | 'starter' | null
let voiceTtsEnabled = localStorage.getItem(VOICE_TTS_STORAGE_KEY) !== 'false';
let voiceAthleteOwnOnly = localStorage.getItem(VOICE_ATHLETE_FILTER_KEY) === 'true';
let isBotSpeaking = false;
let recognitionInstance = null;
let ecoDimmerEnabled = true;
let ecoDimmerTimer = null;
let ecoScreenDimmed = false;
let gpsFixCount = 0;
let gpsLockedForSession = false;

// Combined Starter + Start Clock State
let starterCameraEnabled = false;
let promptedStarterCameraSessionId = null;
window.starterArmingUntil = 0; // Timestamp (ms) until which CV start trigger is locked (settling / TTS / initial beeps)

// FIS Start Beep Sequence State (4 short + 1 long beep)
let fisAudioCtx = null;
let fisCountdownTimers = [];
let fisCountdownStep = 0; // 0 = idle, 4..1 = short beeps, 5 = long GO beep

// Snapshot of previous session state for detecting live announcements (start, split, finish, device handover)
let prevVoiceSessionSnapshot = null;

const VOICE_DICTIONARY = {
    FI: {
        bcp47: 'fi-FI',
        label: 'FI',
        newKeywords: ['uusi', 'lisää'],
        newFillerWords: ['laskija', 'urheilija', 'nimi'],
        cancelKeywords: ['peruuta', 'tyhjennä', 'poista', 'seis', 'stop'],
        roleKeywords: {
            'LÄHTÖ': ['starttikello', 'lähtökello', 'lähtöportti', 'startti'],
            'LÄHETTÄJÄ': ['lähtöpaikka', 'lähettäjä', 'startteri'],
            'MAALI': ['maalikello', 'maaliportti', 'maali'],
            'VÄLIAIKA': ['väliaika', 'väliaikaportti', 'split'],
            'VIDEO': ['video', 'videokamera', 'kamera', 'kuvaaja'],
            'VALMENTAJA': ['valmentaja', 'koutsi', 'valmennus'],
            'URHEILIJA': ['urheilija', 'laskija'],
            'KATSOMO': ['katsomo', 'katsoja', 'yleisö', 'live']
        },
        ui: {
            micOn: 'KUUNTELEE (PAINA LOPETTAAKSESI)',
            micOff: 'KÄYNNISTÄ ÄÄNIOHJAUS',
            roleMicOn: 'SANO ROOLI ÄÄNEEN...',
            roleMicOff: 'VALITSE ROOLI ÄÄNELLÄ',
            hintStarter: 'Sano laskijan nimi (esim. "Matti") tai lisää uusi: "Uusi [Nimi]"',
            ttsOn: 'KUULUTUS: PÄÄLLÄ',
            ttsOff: 'KUULUTUS: POIS',
            ownOnly: 'VAIN OMAT',
            allRuns: 'KAIKKI LASKUT',
            courseFree: 'RATA VAPAA',
            skierReady: 'VALMIINA LÄHTÖÖN',
            courseBusy: 'LASKIJA RADALLA',
            countdownLabel: (sec) => `LÄHTÖÖN: ${sec}...`,
            goNow: 'SAA LÄHTEÄ!'
        },
        phrases: {
            roleSelected: (role) => `Rooli ${role} valittu`,
            addedNewFree: (name) => `Uusi laskija ${name} lisätty. Valmistaudu lähtöön.`,
            addedNewBusy: (name) => `Uusi laskija ${name} lisätty jonoon. Odota, rata on varattu.`,
            queuedFree: (name) => `${name} valmiina. Valmistaudu lähtöön.`,
            queuedBusy: (name) => `${name} jonossa. Odota lupaa, laskija radalla.`,
            queueCleared: () => `Lähtöjono tyhjennetty.`,
            notRecognized: (heard) => `Nimeä ${heard} ei löytynyt listalta. Sano Uusi ${heard} lisätäksesi.`,
            courseClearNext: (name) => `Rata on vapaa! ${name}, valmistaudu lähtöön.`,
            courseClearEmpty: () => `Rata on vapaa seuraavalle laskijalle.`,
            started: (name) => `${name} lähti radalle.`,
            split: (name, idx, secStr) => `${name}, väliaika ${secStr}.`,
            finished: (name, secStr, rank) => rank === 1
                ? `${name} maalissa! Aika ${secStr} sekuntia. Kärkiaika!`
                : `${name} maalissa, aika ${secStr} sekuntia${rank ? `, sija ${rank}` : ''}.`,
            dnf: (name) => `${name} keskeytti. Rata on vapaa.`
        }
    },
    EN: {
        bcp47: 'en-US',
        label: 'EN',
        newKeywords: ['new', 'add'],
        newFillerWords: ['skier', 'athlete', 'runner'],
        cancelKeywords: ['cancel', 'clear', 'reset', 'stop'],
        roleKeywords: {
            'LÄHTÖ': ['start clock', 'start timer', 'start gate'],
            'LÄHETTÄJÄ': ['starter', 'start list', 'start place'],
            'MAALI': ['finish clock', 'finish timer', 'finish gate', 'finish'],
            'VÄLIAIKA': ['split', 'split time', 'intermediate'],
            'VIDEO': ['video', 'camera'],
            'VALMENTAJA': ['coach', 'trainer'],
            'URHEILIJA': ['athlete', 'skier', 'racer'],
            'KATSOMO': ['spectator', 'audience', 'live']
        },
        ui: {
            micOn: 'LISTENING (TAP TO STOP)',
            micOff: 'START VOICE CONTROL',
            roleMicOn: 'SPEAK ROLE NAME...',
            roleMicOff: 'SELECT ROLE BY VOICE',
            hintStarter: 'Speak skier name (e.g. "Matti") or say "New [Name]"',
            ttsOn: 'AUDIO: ON',
            ttsOff: 'AUDIO: OFF',
            ownOnly: 'MY RUNS ONLY',
            allRuns: 'ALL RUNS',
            courseFree: 'TRACK CLEAR',
            skierReady: 'READY TO START',
            courseBusy: 'SKIER ON COURSE',
            countdownLabel: (sec) => `STARTING IN: ${sec}...`,
            goNow: 'GO! TRACK CLEAR'
        },
        phrases: {
            roleSelected: (role) => `Role ${role} selected`,
            addedNewFree: (name) => `New skier ${name} added. Prepare to start.`,
            addedNewBusy: (name) => `New skier ${name} queued. Hold, skier on course.`,
            queuedFree: (name) => `${name} ready. Prepare to start.`,
            queuedBusy: (name) => `${name} in queue. Hold at start, track busy.`,
            queueCleared: () => `Start queue cleared.`,
            notRecognized: (heard) => `${heard} not found. Say New ${heard} to add.`,
            courseClearNext: (name) => `Track is clear! ${name}, prepare to start.`,
            courseClearEmpty: () => `Track is clear for the next skier.`,
            started: (name) => `${name} on course.`,
            split: (name, idx, secStr) => `${name}, split ${secStr}.`,
            finished: (name, secStr, rank) => rank === 1
                ? `${name} finished! Time ${secStr} seconds. Fastest time!`
                : `${name} finished, time ${secStr} seconds${rank ? `, rank ${rank}` : ''}.`,
            dnf: (name) => `${name} did not finish. Track is clear.`
        }
    },
    SV: {
        bcp47: 'sv-SE',
        label: 'SV',
        newKeywords: ['ny', 'lägg till'],
        newFillerWords: ['åkare', 'idrottare'],
        cancelKeywords: ['avbryt', 'rensa', 'stopp'],
        roleKeywords: {
            'LÄHTÖ': ['startklocka', 'startport'],
            'LÄHETTÄJÄ': ['starter', 'startplats'],
            'MAALI': ['målklocka', 'målport', 'mål'],
            'VÄLIAIKA': ['mellantid', 'split'],
            'VIDEO': ['video', 'kamera'],
            'VALMENTAJA': ['tränare', 'coach'],
            'URHEILIJA': ['åkare', 'idrottare'],
            'KATSOMO': ['publik', 'läktare', 'live']
        },
        ui: {
            micOn: 'LYSSNAR (TRYCK FÖR ATT STOPPA)',
            micOff: 'STARTA RÖSTSTYRNING',
            roleMicOn: 'SÄG ROLLENS NAMN...',
            roleMicOff: 'VÄLJ ROLL MED RÖST',
            hintStarter: 'Säg åkarens namn eller "Ny [Namn]"',
            ttsOn: 'LJUD: PÅ',
            ttsOff: 'LJUD: AV',
            ownOnly: 'ENDAST MINA',
            allRuns: 'ALLA ÅK',
            courseFree: 'BANAN FRI',
            skierReady: 'REDO FÖR START',
            courseBusy: 'ÅKARE I BANAN',
            countdownLabel: (sec) => `START OM: ${sec}...`,
            goNow: 'KÖR! START FRI'
        },
        phrases: {
            roleSelected: (role) => `Roll ${role} vald`,
            addedNewFree: (name) => `Ny åkare ${name} tillagd. Gör dig redo.`,
            addedNewBusy: (name) => `Ny åkare ${name} i kö. Vänta, åkare i banan.`,
            queuedFree: (name) => `${name} redo. Gör dig redo för start.`,
            queuedBusy: (name) => `${name} i kö. Vänta, banan är upptagen.`,
            queueCleared: () => `Startkön rensad.`,
            notRecognized: (heard) => `Hittade inte ${heard}. Säg Ny ${heard} för att lägga till.`,
            courseClearNext: (name) => `Banan är fri! ${name}, gör dig redo.`,
            courseClearEmpty: () => `Banan är fri för nästa åkare.`,
            started: (name) => `${name} startade.`,
            split: (name, idx, secStr) => `${name}, mellantid ${secStr}.`,
            finished: (name, secStr, rank) => rank === 1
                ? `${name} i mål! Tid ${secStr} sekunder. Bästa tid!`
                : `${name} i mål, tid ${secStr} sekunder${rank ? `, plats ${rank}` : ''}.`,
            dnf: (name) => `${name} bröt åket. Banan är fri.`
        }
    },
    DE: {
        bcp47: 'de-DE',
        label: 'DE',
        newKeywords: ['neu', 'neue', 'neuer'],
        newFillerWords: ['fahrer', 'läufer', 'athlet'],
        cancelKeywords: ['abbrechen', 'löschen', 'stopp', 'stop'],
        roleKeywords: {
            'LÄHTÖ': ['startuhr', 'starttor'],
            'LÄHETTÄJÄ': ['starter', 'startplatz'],
            'MAALI': ['zieluhr', 'zieltor', 'ziel'],
            'VÄLIAIKA': ['zwischenzeit', 'split'],
            'VIDEO': ['video', 'kamera'],
            'VALMENTAJA': ['trainer', 'coach'],
            'URHEILIJA': ['läufer', 'fahrer', 'athlet'],
            'KATSOMO': ['zuschauer', 'live']
        },
        ui: {
            micOn: 'HÖRT ZU (TIPPEN ZUM STOPPEN)',
            micOff: 'SPRACHSTEUERUNG STARTEN',
            roleMicOn: 'ROLLE SPRECHEN...',
            roleMicOff: 'ROLLE PER SPRACHE WÄHLEN',
            hintStarter: 'Name sprechen oder "Neu [Name]" sagen',
            ttsOn: 'ANSAGE: AN',
            ttsOff: 'ANSAGE: AUS',
            ownOnly: 'NUR EIGENE',
            allRuns: 'ALLE LÄUFE',
            courseFree: 'STRECKE FREI',
            skierReady: 'STARTBEREIT',
            courseBusy: 'LÄUFER AUF STRECKE',
            countdownLabel: (sec) => `START IN: ${sec}...`,
            goNow: 'START FREI!'
        },
        phrases: {
            roleSelected: (role) => `Rolle ${role} gewählt`,
            addedNewFree: (name) => `Neuer Läufer ${name} hinzugefügt. Startbereit machen.`,
            addedNewBusy: (name) => `Neuer Läufer ${name} in Warteschlange. Bitte warten.`,
            queuedFree: (name) => `${name} bereit. Startbereit machen.`,
            queuedBusy: (name) => `${name} in Warteschlange. Bitte warten, Strecke besetzt.`,
            queueCleared: () => `Startliste geleert.`,
            notRecognized: (heard) => `${heard} nicht gefunden. Sage Neu ${heard} zum Hinzufügen.`,
            courseClearNext: (name) => `Strecke frei! ${name}, startbereit machen.`,
            courseClearEmpty: () => `Strecke frei für den nächsten Läufer.`,
            started: (name) => `${name} ist gestartet.`,
            split: (name, idx, secStr) => `${name}, Zwischenzeit ${secStr}.`,
            finished: (name, secStr, rank) => rank === 1
                ? `${name} im Ziel! Zeit ${secStr} Sekunden. Bestzeit!`
                : `${name} im Ziel, Zeit ${secStr} Sekunden${rank ? `, Platz ${rank}` : ''}.`,
            dnf: (name) => `${name} ausgeschieden. Strecke frei.`
        }
    }
};

function getVoiceDict() {
    return VOICE_DICTIONARY[voiceLang] || VOICE_DICTIONARY.FI;
}

// ============================================================================
// FIS ALPINE START BEEP CADENCE (4 SHORT BEEPS + 1 LONG BEEP)
// ============================================================================

function ensureAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!fisAudioCtx) {
        fisAudioCtx = new AudioCtx();
    }
    if (fisAudioCtx.state === 'suspended') {
        fisAudioCtx.resume().catch(() => {});
    }
    return fisAudioCtx;
}

function playBeepTone(freqHz, durationMs, gainLevel = 0.35) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqHz, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(gainLevel, now + 0.012);
        gain.gain.setValueAtTime(gainLevel, now + (durationMs / 1000) - 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (durationMs / 1000));

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + (durationMs / 1000) + 0.02);
    } catch (e) {
        console.warn('[AUDIO] Beep failed:', e);
    }
}

function cancelFisStartSequence() {
    if (fisCountdownTimers.length > 0) {
        fisCountdownTimers.forEach(t => clearTimeout(t));
        fisCountdownTimers = [];
    }
    fisCountdownStep = 0;
}

/**
 * Plays the standard Alpine Skiing start cadence:
 * 4 short beeps (880 Hz, 120 ms at 1s intervals) + 1 long high beep (1760 Hz, 550 ms).
 * Locks CV start trigger during the initial settling phase (first 2 beeps) and arms CV for launch.
 */
function playFisStartSequence() {
    cancelFisStartSequence();
    ensureAudioContext();

    // Hold echo lock and arming lock during initial settling phase (first 1.8s of countdown)
    window.starterArmingUntil = Date.now() + 1800;
    isBotSpeaking = true;

    const totalShortBeeps = 4;
    for (let i = 0; i < totalShortBeeps; i++) {
        const remainingSec = totalShortBeeps - i; // 4, 3, 2, 1
        const t = setTimeout(() => {
            // Stop if course became busy or queue was cleared
            if (currentSession && ((currentSession.onCourse || []).length > 0)) {
                cancelFisStartSequence();
                isBotSpeaking = false;
                updateStarterTrafficLight(currentSession);
                return;
            }
            fisCountdownStep = remainingSec;
            playBeepTone(880, 130, 0.38);
            updateStarterTrafficLight(currentSession);
        }, i * 1000);
        fisCountdownTimers.push(t);
    }

    // 5th Long Beep (GO!) at 4.0 seconds
    const goTimer = setTimeout(() => {
        fisCountdownStep = 5;
        window.starterArmingUntil = 0; // Fully armed
        playBeepTone(1760, 580, 0.45);
        updateStarterTrafficLight(currentSession);

        setTimeout(() => {
            fisCountdownStep = 0;
            isBotSpeaking = false;
            updateStarterTrafficLight(currentSession);
        }, 700);
    }, totalShortBeeps * 1000);
    fisCountdownTimers.push(goTimer);
}

function triggerFisStartCountdownManual() {
    playFisStartSequence();
}

// ============================================================================
// COMBINED STARTER + START CLOCK (1-DEVICE MODE) & AUTO-HANDOVER
// ============================================================================

function getExternalStartClockDevice(session = currentSession) {
    if (!session || !session.devices) return null;
    for (const [did, dev] of Object.entries(session.devices)) {
        if (did !== deviceId && dev && dev.role === 'LÄHTÖ') {
            return dev;
        }
    }
    return null;
}

function updateStarterClockBannerUI() {
    const banner = document.getElementById('starter-clock-mode-banner');
    const iconEl = document.getElementById('starter-clock-mode-icon');
    const titleEl = document.getElementById('starter-clock-mode-title');
    const descEl = document.getElementById('starter-clock-mode-desc');
    const btn = document.getElementById('btn-toggle-starter-camera');
    const btnLabel = document.getElementById('btn-toggle-starter-camera-label');
    const cvCard = document.getElementById('starter-cv-card');

    if (!banner || !titleEl || !descEl || !btn || !cvCard) return;

    const extClock = getExternalStartClockDevice(currentSession);
    banner.className = 'starter-clock-banner';

    if (starterCameraEnabled) {
        banner.classList.add('mode-active');
        if (iconEl) {
            iconEl.innerText = 'sensors';
            iconEl.style.color = '#34d399';
        }
        titleEl.innerText = 'YHDISTETTY LÄHETTÄJÄ + STARTTIKELLO (1 LAITE)';
        descEl.innerText = 'Tämä puhelin kuuntelee nimet, antaa lähtöpiippaukset (4+1) ja käynnistää kellon kameralla.';
        btn.setAttribute('aria-pressed', 'true');
        btn.className = 'btn-mini btn-outline';
        if (btnLabel) btnLabel.innerText = 'SAMMUTA KAMERA';
        cvCard.style.display = 'block';
    } else if (extClock) {
        banner.classList.add('mode-external');
        if (iconEl) {
            iconEl.innerText = 'phonelink_ring';
            iconEl.style.color = '#60a5fa';
        }
        titleEl.innerText = `ERILLINEN STARTTIKELLO KÄYTÖSSÄ (${(extClock.name || 'Laite').toUpperCase()})`;
        descEl.innerText = 'Tämän laitteen starttikello-kamera on pois päältä, jotta käytössä on vain yksi starttikello.';
        btn.setAttribute('aria-pressed', 'false');
        btn.className = 'btn-mini btn-outline';
        if (btnLabel) btnLabel.innerText = 'OTA TÄHÄN LAITTEESEEN';
        cvCard.style.display = 'none';
    } else {
        if (iconEl) {
            iconEl.innerText = 'videocam_off';
            iconEl.style.color = 'var(--text-secondary)';
        }
        titleEl.innerText = 'VAIN LÄHTÖLISTA & ÄÄNIOHJAUS';
        descEl.innerText = 'Ei aktiivista Starttikelloa. Ota kamera käyttöön tästä, jos et käytä erillistä puhelinta portilla.';
        btn.setAttribute('aria-pressed', 'false');
        btn.className = 'btn-mini btn-accent-outline';
        if (btnLabel) btnLabel.innerText = 'OTA KÄYTTÖÖN';
        cvCard.style.display = 'none';
    }
}

async function setStarterCameraMode(enabled, options = {}) {
    starterCameraEnabled = !!enabled;
    localStorage.setItem(STARTER_CAM_STORAGE_KEY, String(starterCameraEnabled));
    updateStarterClockBannerUI();

    if (currentRole === 'LÄHETTÄJÄ') {
        if (starterCameraEnabled && typeof startCV === 'function') {
            await startCV('lähettäjä');
        } else if (!starterCameraEnabled && typeof stopCV === 'function') {
            stopCV();
        }
    }

    if (!options.silentEmit && currentSession) {
        socket.emit('set_starter_clock_mode', {
            sessionId: currentSession.id,
            deviceId: deviceId,
            enabled: starterCameraEnabled
        });
    }
}

function toggleStarterCameraMode() {
    ensureAudioContext();
    setStarterCameraMode(!starterCameraEnabled);
}

/**
 * Called when entering LÄHETTÄJÄ role in a session.
 * If no dedicated LÄHTÖ device is present, prompts the user clearly whether this device
 * should also act as the Start Clock.
 */
function handleStarterRoleEntry(session) {
    if (!session || currentRole !== 'LÄHETTÄJÄ') return;

    const extClock = getExternalStartClockDevice(session);
    if (extClock) {
        // Dedicated Start Clock already exists in the session -> keep starter camera off automatically
        setStarterCameraMode(false, { silentEmit: true });
        return;
    }

    if (promptedStarterCameraSessionId === session.id) {
        updateStarterClockBannerUI();
        if (starterCameraEnabled && typeof startCV === 'function') {
            startCV('lähettäjä');
        }
        return;
    }

    promptedStarterCameraSessionId = session.id;

    if (typeof showPremiumModal === 'function') {
        showPremiumModal({
            title: 'TOIMIIKO TÄMÄ LAITE MYÖS STARTTIKELLONA?',
            text: 'Harjoituksessa ei ole erillistä Starttikelloa. Haluatko, että tämä puhelin hoitaa sekä Lähettäjän (ääniohjaus + 4+1 lähtöpiippaukset) että Starttikellon (kameran valokenno) yhdellä laitteella?',
            icon: 'sensors',
            confirmText: 'KYLLÄ, LÄHETTÄJÄ + STARTTIKELLO',
            cancelText: 'EI, KÄYTÄN ERILLISTÄ STARTTIKELLOA',
            onConfirm: () => {
                ensureAudioContext();
                setStarterCameraMode(true);
            },
            onCancel: () => {
                setStarterCameraMode(false);
            }
        });
    }
}

// ============================================================================
// PHONETIC NORMALIZATION & FUZZY NAME MATCHING
// ============================================================================

function normalizePhonetic(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/å/g, 'o')
        .replace(/ä/g, 'a')
        .replace(/ö/g, 'o')
        .replace(/ü/g, 'y')
        .replace(/[éèêë]/g, 'e')
        .replace(/[áàâ]/g, 'a')
        .replace(/[íìî]/g, 'i')
        .replace(/[óòô]/g, 'o')
        .replace(/[úùû]/g, 'u')
        .replace(/c/g, 'k')
        .replace(/w/g, 'v')
        .replace(/z/g, 'ts')
        .replace(/x/g, 'ks')
        .replace(/ph/g, 'f')
        .replace(/(.)\1+/g, '$1')
        .replace(/[^a-z0-9\s]/g, '');
}

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

function findBestAthleteMatch(transcriptCandidates, athletes) {
    if (!athletes || athletes.length === 0) return null;

    let bestAthlete = null;
    let bestScore = -1;

    for (const rawCandidate of transcriptCandidates) {
        const cleaned = rawCandidate
            .toLowerCase()
            .replace(/\b(seuraava|laskija|urheilija|jonoon|lähtöön|next|skier|ready)\b/gi, '')
            .trim();
        if (!cleaned) continue;

        const normSpoken = normalizePhonetic(cleaned);
        if (!normSpoken) continue;

        for (const athlete of athletes) {
            const rawName = (athlete.name || '').trim();
            if (!rawName) continue;

            if (rawName.toLowerCase() === cleaned) {
                return { athlete, score: 1.0 };
            }

            const normTarget = normalizePhonetic(rawName);
            if (normTarget === normSpoken) {
                return { athlete, score: 0.98 };
            }

            const firstPart = normalizePhonetic(rawName.split(/\s+/)[0]);
            const distFull = levenshteinDistance(normSpoken, normTarget);
            const maxLenFull = Math.max(normSpoken.length, normTarget.length, 1);
            const simFull = 1 - (distFull / maxLenFull);

            const distFirst = levenshteinDistance(normSpoken, firstPart);
            const maxLenFirst = Math.max(normSpoken.length, firstPart.length, 1);
            const simFirst = 1 - (distFirst / maxLenFirst);

            const score = Math.max(simFull, simFirst);
            if (score > bestScore) {
                bestScore = score;
                bestAthlete = athlete;
            }
        }
    }

    if (bestAthlete && bestScore >= 0.62) {
        return { athlete: bestAthlete, score: bestScore };
    }
    return null;
}

// ============================================================================
// SPEECH SYNTHESIS (TTS) WITH HALF-DUPLEX ECHO SUPPRESSION
// ============================================================================

function formatDurationForSpeech(ms) {
    if (!ms || ms <= 0) return '0';
    const totalSec = (ms / 1000).toFixed(2);
    return voiceLang === 'EN' ? totalSec : totalSec.replace('.', ',');
}

function speakVoiceText(text, forceSpeak = false, onFinished = null) {
    // Dedicated passive sensor roles (LÄHTÖ, VÄLIAIKA, MAALI, VIDEO) remain silent,
    // whereas LÄHETTÄJÄ (even with integrated Start Clock camera) announces and plays start beeps!
    if (currentRole && ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) {
        if (typeof onFinished === 'function') onFinished();
        return;
    }

    if (!('speechSynthesis' in window) || (!voiceTtsEnabled && !forceSpeak)) {
        if (typeof onFinished === 'function') {
            setTimeout(onFinished, 200);
        }
        return;
    }

    try {
        window.speechSynthesis.cancel();
        isBotSpeaking = true;

        const utterance = new SpeechSynthesisUtterance(text);
        const dict = getVoiceDict();
        utterance.lang = dict.bcp47;
        utterance.rate = 1.05;

        let finishedCalled = false;
        const releaseEchoLock = () => {
            if (finishedCalled) return;
            finishedCalled = true;
            setTimeout(() => {
                isBotSpeaking = false;
                if (typeof onFinished === 'function') onFinished();
            }, 300);
        };

        utterance.onend = releaseEchoLock;
        utterance.onerror = releaseEchoLock;

        window.speechSynthesis.speak(utterance);
    } catch (e) {
        isBotSpeaking = false;
        if (typeof onFinished === 'function') onFinished();
        console.warn('[VOICE] TTS failed:', e);
    }
}

// ============================================================================
// SPEECH RECOGNITION ENGINE (Role Onboarding & Starter Hands-Free)
// ============================================================================

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.lang = getVoiceDict().bcp47;

    rec.onresult = (event) => {
        if (isBotSpeaking) return; // Half-duplex echo lock during TTS & start beeps

        const result = event.results[event.results.length - 1];
        if (!result || !result.isFinal) return;

        const alternatives = [];
        for (let i = 0; i < result.length; i++) {
            if (result[i] && result[i].transcript) {
                alternatives.push(result[i].transcript.trim());
            }
        }
        if (alternatives.length === 0) return;

        console.log('[VOICE] Heard alternatives:', alternatives);

        // Wake screen for 25s if dimmed on Starter combined gate
        if (ecoScreenDimmed && typeof wakeSensorScreen === 'function') {
            wakeSensorScreen(true);
        }

        if (voiceListenMode === 'role') {
            handleSpokenRoleCommand(alternatives);
        } else if (voiceListenMode === 'starter') {
            handleSpokenStarterCommand(alternatives);
        }
    };

    rec.onerror = (event) => {
        console.warn('[VOICE] SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            stopVoiceListening();
            updateVoiceTranscriptUI('Mikrofonilupa evätty selaimessa.', 'var(--danger)', 'mic_off');
        }
    };

    rec.onend = () => {
        if (voiceListening && (voiceListenMode === 'starter' || voiceListenMode === 'role')) {
            setTimeout(() => {
                if (voiceListening && recognitionInstance) {
                    try {
                        recognitionInstance.lang = getVoiceDict().bcp47;
                        recognitionInstance.start();
                    } catch (e) {}
                }
            }, 250);
        } else {
            updateVoiceControlsUI();
        }
    };

    return rec;
}

function toggleVoiceListening(mode = 'starter') {
    ensureAudioContext();
    if (voiceListening && voiceListenMode === mode) {
        stopVoiceListening();
        return;
    }
    startVoiceListening(mode);
}

function startVoiceListening(mode = 'starter') {
    if (mode === 'starter' && currentRole && ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) {
        return;
    }

    if (!recognitionInstance) {
        recognitionInstance = initSpeechRecognition();
    }
    if (!recognitionInstance) {
        alert('Selaimesi ei tue puheentunnistusta (Web Speech API). Käytä Chromea tai Safaria.');
        return;
    }

    voiceListenMode = mode;
    voiceListening = true;
    recognitionInstance.lang = getVoiceDict().bcp47;

    try {
        recognitionInstance.start();
    } catch (e) {}

    updateVoiceControlsUI();
    if (mode === 'starter') {
        updateVoiceTranscriptUI(getVoiceDict().ui.hintStarter, 'var(--text-secondary)', 'graphic_eq');
    }
}

function stopVoiceListening() {
    voiceListening = false;
    voiceListenMode = null;
    if (recognitionInstance) {
        try {
            recognitionInstance.stop();
        } catch (e) {}
    }
    updateVoiceControlsUI();
}

// ============================================================================
// COMMAND HANDLERS: ROLE SELECTION & STARTER GATE ("Uusi [Nimi]" + Fuzzy Match)
// ============================================================================

function handleSpokenRoleCommand(alternatives) {
    const joined = alternatives.join(' ').toLowerCase();

    for (const langKey of Object.keys(VOICE_DICTIONARY)) {
        const roleMap = VOICE_DICTIONARY[langKey].roleKeywords;
        for (const [roleCode, keywords] of Object.entries(roleMap)) {
            for (const kw of keywords) {
                if (joined.includes(kw.toLowerCase())) {
                    stopVoiceListening();
                    speakVoiceText(getVoiceDict().phrases.roleSelected(kw), true);
                    if (typeof selectRole === 'function') {
                        selectRole(roleCode);
                    }
                    return;
                }
            }
        }
    }
}

function capitalizeAthleteName(raw) {
    return raw
        .trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

function handleSpokenStarterCommand(alternatives) {
    if (!currentSession) return;
    const dict = getVoiceDict();
    const primary = alternatives[0] || '';
    const lowerPrimary = primary.toLowerCase().trim();

    updateVoiceTranscriptUI(`"${primary}"`, '#ffffff', 'record_voice_over');

    // 1. Check for Cancel / Clear Queue command across all languages
    const allCancelWords = [
        ...VOICE_DICTIONARY.FI.cancelKeywords,
        ...VOICE_DICTIONARY.EN.cancelKeywords,
        ...VOICE_DICTIONARY.SV.cancelKeywords,
        ...VOICE_DICTIONARY.DE.cancelKeywords
    ];
    const words = lowerPrimary.split(/\s+/);
    if (words.some(w => allCancelWords.includes(w))) {
        cancelFisStartSequence();
        if (typeof clearQueue === 'function') clearQueue();
        speakVoiceText(dict.phrases.queueCleared());
        updateVoiceTranscriptUI(dict.phrases.queueCleared(), 'var(--warning)', 'cancel');
        return;
    }

    // 2. Check for "Uusi [Nimi]" / "New [Name]" / "Ny [Namn]" / "Neu [Name]" prefix
    const allNewPrefixes = [
        ...VOICE_DICTIONARY.FI.newKeywords,
        ...VOICE_DICTIONARY.EN.newKeywords,
        ...VOICE_DICTIONARY.SV.newKeywords,
        ...VOICE_DICTIONARY.DE.newKeywords
    ];
    const allFillerWords = [
        ...VOICE_DICTIONARY.FI.newFillerWords,
        ...VOICE_DICTIONARY.EN.newFillerWords,
        ...VOICE_DICTIONARY.SV.newFillerWords,
        ...VOICE_DICTIONARY.DE.newFillerWords
    ];

    for (const alt of alternatives) {
        const tokens = alt.trim().split(/\s+/);
        if (tokens.length >= 2) {
            const firstWord = tokens[0].toLowerCase().replace(/[^a-zäöåü]/gi, '');
            if (allNewPrefixes.includes(firstWord)) {
                let nameTokens = tokens.slice(1);
                if (nameTokens.length > 1 && allFillerWords.includes(nameTokens[0].toLowerCase())) {
                    nameTokens = nameTokens.slice(1);
                }
                const cleanNewName = capitalizeAthleteName(nameTokens.join(' ').replace(/[^a-zA-ZäöåÄÖÅüÜéÉ\s-]/g, ''));
                if (cleanNewName.length >= 2) {
                    // Set arming delay immediately so speaking doesn't false-trigger CV
                    window.starterArmingUntil = Date.now() + 2500;
                    socket.emit('add_athlete', {
                        sessionId: currentSession.id,
                        name: cleanNewName,
                        autoQueue: true
                    });

                    const isCourseBusy = (currentSession.onCourse || []).length > 0;
                    const msg = isCourseBusy
                        ? dict.phrases.addedNewBusy(cleanNewName)
                        : dict.phrases.addedNewFree(cleanNewName);
                    speakVoiceText(msg, false, () => {
                        if (!isCourseBusy) playFisStartSequence();
                    });
                    updateVoiceTranscriptUI(cleanNewName.toUpperCase(), 'var(--success)', 'person_add');
                    return;
                }
            }
        }
    }

    // 3. Match existing athlete in currentSession.allAthletes using phonetic + Levenshtein fuzzy matcher
    const athletes = currentSession.allAthletes || [];
    const match = findBestAthleteMatch(alternatives, athletes);

    if (match && match.athlete) {
        const athlete = match.athlete;
        // Set arming delay immediately so speaking doesn't false-trigger CV
        window.starterArmingUntil = Date.now() + 2500;
        if (typeof addToQueue === 'function') {
            addToQueue(athlete.id, { fromVoice: true });
        }
        const isCourseBusy = (currentSession.onCourse || []).length > 0;
        const msg = isCourseBusy
            ? dict.phrases.queuedBusy(athlete.name)
            : dict.phrases.queuedFree(athlete.name);
        speakVoiceText(msg, false, () => {
            if (!isCourseBusy) playFisStartSequence();
        });
        updateVoiceTranscriptUI(athlete.name.toUpperCase(), 'var(--success)', 'check_circle');
    } else {
        speakVoiceText(dict.phrases.notRecognized(primary));
        updateVoiceTranscriptUI(`"${primary}" – Sano: "Uusi ${capitalizeAthleteName(primary)}"`, 'var(--warning)', 'help');
    }
}

// ============================================================================
// LIVE SESSION EVENT ANNOUNCER & EXTERNAL START CLOCK HANDOVER
// ============================================================================

function handleVoiceSessionUpdate(prevSession, nextSession) {
    if (!nextSession) return;

    // 0. Check if an external LÄHTÖ (Starttikello) device joined while this LÄHETTÄJÄ had starterCameraEnabled
    if (currentRole === 'LÄHETTÄJÄ') {
        const extClock = getExternalStartClockDevice(nextSession);
        if (extClock && starterCameraEnabled) {
            setStarterCameraMode(false, { silentEmit: true });
            if (typeof showPremiumModal === 'function') {
                showPremiumModal({
                    title: 'ERILLINEN STARTTIKELLO KYTKETTY',
                    text: `Laite "${extClock.name || 'Starttikello'}" otettiin käyttöön erillisenä Starttikellona. Tämän laitteen starttikello-kamera sammutettiin automaattisesti, jotta harjoituksessa ei ole kahta starttikelloa.`,
                    icon: 'sensors',
                    confirmText: 'SELVÄ',
                    cancelText: ''
                });
            }
        } else {
            updateStarterClockBannerUI();
        }
    }

    updateStarterTrafficLight(nextSession);
    updateSensorEcoState(nextSession);

    if (!prevSession || prevSession.id !== nextSession.id) {
        prevVoiceSessionSnapshot = cloneVoiceSnapshot(nextSession);
        return;
    }

    const snap = prevVoiceSessionSnapshot || cloneVoiceSnapshot(prevSession);
    const dict = getVoiceDict();

    const prevOnCourseIds = new Set((snap.onCourse || []).map(r => r.runId));
    const nextOnCourse = nextSession.onCourse || [];
    const prevResultsIds = new Set((snap.results || []).map(r => r.runId));
    const nextResults = nextSession.results || [];

    const isListenerRole = ['VALMENTAJA', 'KATSOMO', 'URHEILIJA'].includes(currentRole);
    const isStarterRole = currentRole === 'LÄHETTÄJÄ';

    const shouldAnnounceAthlete = (runnerName) => {
        if (currentRole !== 'URHEILIJA') return true;
        if (!voiceAthleteOwnOnly || !userName) return true;
        return (runnerName || '').toLowerCase().trim() === userName.toLowerCase().trim();
    };

    // 1. Check for NEW FINISH or DNF
    let announcedFinish = false;
    for (const res of nextResults) {
        if (res.runId && !prevResultsIds.has(res.runId)) {
            if (isListenerRole && shouldAnnounceAthlete(res.name)) {
                if (res.status === 'DNF') {
                    speakVoiceText(dict.phrases.dnf(res.name));
                } else {
                    const validSorted = [...nextResults]
                        .filter(r => r.totalTime > 0 && r.status !== 'DNF')
                        .sort((a, b) => a.totalTime - b.totalTime);
                    const rank = validSorted.findIndex(vr => vr.runId === res.runId) + 1 || null;
                    const secStr = formatDurationForSpeech(res.totalTime);
                    speakVoiceText(dict.phrases.finished(res.name, secStr, rank));
                }
                announcedFinish = true;
                break;
            }
        }
    }

    // 2. If Starter role (LÄHETTÄJÄ) and course just became FREE (prev had runner, now empty)
    if (isStarterRole && (snap.onCourse || []).length > 0 && nextOnCourse.length === 0) {
        const nextQueue = nextSession.activeQueue || [];
        if (nextQueue.length > 0) {
            window.starterArmingUntil = Date.now() + 2500;
            speakVoiceText(dict.phrases.courseClearNext(nextQueue[0].name), false, () => {
                playFisStartSequence();
            });
        } else {
            speakVoiceText(dict.phrases.courseClearEmpty());
        }
    }

    // 3. Check for NEW SPLIT on active runners
    if (!announcedFinish && isListenerRole) {
        for (const runner of nextOnCourse) {
            const oldRunner = (snap.onCourse || []).find(r => r.runId === runner.runId);
            const oldSplitsCount = oldRunner && oldRunner.splits ? oldRunner.splits.length : 0;
            const newSplits = runner.splits || [];
            if (newSplits.length > oldSplitsCount && shouldAnnounceAthlete(runner.name)) {
                const latestSplit = newSplits[newSplits.length - 1];
                const secStr = formatDurationForSpeech(latestSplit.duration);
                speakVoiceText(dict.phrases.split(runner.name, newSplits.length, secStr));
                break;
            }
        }
    }

    // 4. Check for NEW START
    if (!announcedFinish) {
        for (const runner of nextOnCourse) {
            if (runner.runId && !prevOnCourseIds.has(runner.runId)) {
                if (isStarterRole) {
                    cancelFisStartSequence();
                }
                if (isListenerRole && shouldAnnounceAthlete(runner.name)) {
                    speakVoiceText(dict.phrases.started(runner.name));
                    break;
                }
            }
        }
    }

    prevVoiceSessionSnapshot = cloneVoiceSnapshot(nextSession);
}

function cloneVoiceSnapshot(session) {
    if (!session) return null;
    return {
        id: session.id,
        onCourse: (session.onCourse || []).map(r => ({
            runId: r.runId,
            name: r.name,
            splits: r.splits ? [...r.splits] : []
        })),
        results: (session.results || []).map(r => ({
            runId: r.runId,
            name: r.name,
            totalTime: r.totalTime,
            status: r.status
        })),
        activeQueue: (session.activeQueue || []).map(q => ({ id: q.id, name: q.name }))
    };
}

// ============================================================================
// COLD-WEATHER BATTERY SAVING & LIFECYCLE MANAGEMENT
// ============================================================================

function applyRolePowerAndVoicePolicy(role) {
    const isDedicatedSensorRole = ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(role);

    if (isDedicatedSensorRole) {
        stopVoiceListening();
        cancelFisStartSequence();
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        setupSensorEcoDimmer();
    } else if (role === 'LÄHETTÄJÄ') {
        clearSensorEcoDimmer();
        if (currentSession) {
            handleStarterRoleEntry(currentSession);
        }
    } else {
        clearSensorEcoDimmer();
        cancelFisStartSequence();
        stopVoiceListening();
    }

    updateVoiceControlsUI();
    if (currentSession) {
        updateStarterTrafficLight(currentSession);
    }
}

function setupSensorEcoDimmer() {
    resetSensorEcoTimer();
}

function clearSensorEcoDimmer() {
    if (ecoDimmerTimer) {
        clearTimeout(ecoDimmerTimer);
        ecoDimmerTimer = null;
    }
    wakeSensorScreen(false);
}

function isEcoCapableRole() {
    if (['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) return true;
    if (currentRole === 'LÄHETTÄJÄ' && starterCameraEnabled) return true;
    return false;
}

function resetSensorEcoTimer() {
    if (ecoDimmerTimer) clearTimeout(ecoDimmerTimer);
    if (!ecoDimmerEnabled) return;
    if (!isEcoCapableRole()) return;
    // On LÄHETTÄJÄ, only auto-dim if manually requested, whereas dedicated sensors auto-dim after 25s
    if (currentRole === 'LÄHETTÄJÄ') return;

    ecoDimmerTimer = setTimeout(() => {
        dimSensorScreen();
    }, 25000);
}

function dimSensorScreen() {
    if (!isEcoCapableRole()) return;
    const overlay = document.getElementById('sensor-eco-overlay');
    if (overlay) {
        ecoScreenDimmed = true;
        overlay.style.display = 'flex';
        updateSensorEcoOverlayText();
    }
}

function wakeSensorScreen(restartTimer = true) {
    ecoScreenDimmed = false;
    const overlay = document.getElementById('sensor-eco-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    if (restartTimer) {
        resetSensorEcoTimer();
    }
}

function toggleSensorEcoMode() {
    ecoDimmerEnabled = !ecoDimmerEnabled;
    if (ecoDimmerEnabled) {
        dimSensorScreen();
    } else {
        wakeSensorScreen(false);
    }
    updateVoiceControlsUI();
}

function updateSensorEcoState(session) {
    if (!ecoScreenDimmed) return;
    updateSensorEcoOverlayText(session);
}

function updateSensorEcoOverlayText(session = currentSession) {
    const roleEl = document.getElementById('eco-overlay-role');
    const stateEl = document.getElementById('eco-overlay-status');
    if (!roleEl || !stateEl) return;

    const roleTitle = (currentRole === 'LÄHETTÄJÄ' && starterCameraEnabled)
        ? 'LÄHETTÄJÄ + STARTTIKELLO'
        : (currentRole || 'ANTURI');
    roleEl.innerText = `${roleTitle} – VIRRANSÄÄSTÖTILA`;

    const onCourse = session && session.onCourse ? session.onCourse : [];
    const queue = session && session.activeQueue ? session.activeQueue : [];

    if (onCourse.length > 0) {
        stateEl.innerHTML = `${iconHtml('bolt', 'icon-sm')} <span>LASKIJA RADALLA: ${onCourse[0].name.toUpperCase()} (60 FPS AKTIIVINEN)</span>`;
        stateEl.style.color = '#34d399';
    } else if (queue.length > 0 && (currentRole === 'LÄHTÖ' || (currentRole === 'LÄHETTÄJÄ' && starterCameraEnabled))) {
        stateEl.innerHTML = `${iconHtml('bolt', 'icon-sm')} <span>LÄHTÖJONOSSA: ${queue[0].name.toUpperCase()} (60 FPS AKTIIVINEN)</span>`;
        stateEl.style.color = '#60a5fa';
    } else {
        stateEl.innerHTML = `${iconHtml('bedtime', 'icon-sm')} <span>RATA VAPAA – KAMERA VALMIUSTILASSA (4 FPS ECO)</span>`;
        stateEl.style.color = 'var(--text-secondary)';
    }
}

/**
 * Called by cv.js to determine whether CV should run at full 60fps or throttled 4fps eco mode.
 */
function shouldThrottleCV(roleType) {
    if (!currentSession) return false;
    const queueCount = (currentSession.activeQueue || []).length;
    const onCourseCount = (currentSession.onCourse || []).length;

    if (roleType === 'lähtö' || roleType === 'lähettäjä') {
        return queueCount === 0;
    }
    if (roleType === 'maali' || roleType === 'väliaika') {
        return onCourseCount === 0;
    }
    if (roleType === 'video') {
        if (onCourseCount > 0) return false;
        if ((currentSession.results || []).length > 0) {
            const lastFinish = currentSession.results[0].finishTime || 0;
            if (getSyncedTime() - lastFinish < 10000) return false;
        }
        return true;
    }
    return false;
}

/**
 * Called by startGPSTracking() in app.js so stationary sensor roles lock GPS once and turn off the GPS radio.
 */
function handleGpsPositionForBattery(pos) {
    if (!currentSession) return;
    gpsFixCount++;

    const accuracy = pos.coords.accuracy || 999;
    socket.emit('update_location', {
        sessionId: currentSession.id,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: accuracy
    });

    const isStationaryRole = ['LÄHTÖ', 'LÄHETTÄJÄ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole);
    if (isStationaryRole && (accuracy <= 20 || gpsFixCount >= 3)) {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        gpsLockedForSession = true;
        console.log(`[ECO-GPS] Stationary role ${currentRole} GPS locked (acc: ${Math.round(accuracy)}m).`);
    }
}

// ============================================================================
// UI HELPERS (Language Selector, Starter Traffic Lights, Audio Toggles)
// ============================================================================

function setVoiceLanguage(lang) {
    if (!VOICE_DICTIONARY[lang]) return;
    voiceLang = lang;
    localStorage.setItem(VOICE_LANG_STORAGE_KEY, lang);

    if (recognitionInstance && voiceListening) {
        try {
            recognitionInstance.lang = getVoiceDict().bcp47;
            recognitionInstance.stop();
        } catch (e) {}
    }

    updateVoiceControlsUI();
    if (currentSession) updateStarterTrafficLight(currentSession);
}

function toggleVoiceTts() {
    voiceTtsEnabled = !voiceTtsEnabled;
    localStorage.setItem(VOICE_TTS_STORAGE_KEY, String(voiceTtsEnabled));
    updateVoiceControlsUI();

    if (voiceTtsEnabled) {
        const dict = getVoiceDict();
        speakVoiceText(dict.ui.ttsOn, true);
    } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

function toggleVoiceAthleteFilter() {
    voiceAthleteOwnOnly = !voiceAthleteOwnOnly;
    localStorage.setItem(VOICE_ATHLETE_FILTER_KEY, String(voiceAthleteOwnOnly));
    updateVoiceControlsUI();
}

function updateVoiceTranscriptUI(text, color = '#ffffff', iconName = 'graphic_eq') {
    const el = document.getElementById('starter-voice-transcript');
    if (el) {
        el.innerHTML = `${iconHtml(iconName, 'icon-sm')} <span>${text}</span>`;
        el.style.color = color;
    }
}

function updateStarterTrafficLight(session = currentSession) {
    const redBulb = document.getElementById('tl-bulb-red');
    const yellowBulb = document.getElementById('tl-bulb-yellow');
    const greenBulb = document.getElementById('tl-bulb-green');
    const labelEl = document.getElementById('tl-status-label');
    if (!redBulb || !yellowBulb || !greenBulb || !labelEl) return;

    const dict = getVoiceDict();
    const onCourse = (session && session.onCourse) || [];
    const queue = (session && session.activeQueue) || [];

    redBulb.className = 'tl-bulb';
    yellowBulb.className = 'tl-bulb';
    greenBulb.className = 'tl-bulb';

    if (onCourse.length > 0) {
        redBulb.classList.add('active-red');
        labelEl.innerHTML = `${iconHtml('do_not_disturb_on', 'icon-sm')} <span>${dict.ui.courseBusy}: ${onCourse[0].name.toUpperCase()}</span>`;
        labelEl.style.color = 'var(--danger)';
    } else if (fisCountdownStep >= 1 && fisCountdownStep <= 4) {
        yellowBulb.classList.add('active-yellow');
        const nextName = queue[0] ? `${queue[0].name.toUpperCase()} – ` : '';
        labelEl.innerHTML = `${iconHtml('timer', 'icon-sm')} <span>${nextName}${dict.ui.countdownLabel(fisCountdownStep)}</span>`;
        labelEl.style.color = 'var(--warning)';
    } else if (fisCountdownStep === 5) {
        greenBulb.classList.add('active-green');
        const nextName = queue[0] ? `${queue[0].name.toUpperCase()}: ` : '';
        labelEl.innerHTML = `${iconHtml('sports_score', 'icon-sm')} <span>${nextName}${dict.ui.goNow}</span>`;
        labelEl.style.color = 'var(--success)';
    } else if (queue.length > 0) {
        greenBulb.classList.add('active-green');
        yellowBulb.classList.add('active-yellow');
        labelEl.innerHTML = `${iconHtml('directions_run', 'icon-sm')} <span>${dict.ui.skierReady}: ${queue[0].name.toUpperCase()}</span>`;
        labelEl.style.color = 'var(--success)';
    } else {
        greenBulb.classList.add('active-green');
        labelEl.innerHTML = `${iconHtml('check_circle', 'icon-sm')} <span>${dict.ui.courseFree}</span>`;
        labelEl.style.color = 'var(--success)';
    }
}

function updateVoiceControlsUI() {
    const dict = getVoiceDict();

    // Update all language pills across views
    document.querySelectorAll('.voice-lang-btn').forEach(btn => {
        const isSelected = btn.getAttribute('data-lang') === voiceLang;
        btn.classList.toggle('active', isSelected);
        btn.setAttribute('aria-pressed', String(isSelected));
    });

    // Starter Mic Button
    const starterMicBtn = document.getElementById('btn-starter-mic');
    if (starterMicBtn) {
        const isActive = voiceListening && voiceListenMode === 'starter';
        starterMicBtn.innerHTML = `${iconHtml(isActive ? 'graphic_eq' : 'mic')} <span>${isActive ? dict.ui.micOn : dict.ui.micOff}</span>`;
        starterMicBtn.classList.toggle('listening', isActive);
        starterMicBtn.setAttribute('aria-pressed', String(isActive));
    }

    // Role Selection Mic Button
    const roleMicBtn = document.getElementById('btn-role-mic');
    if (roleMicBtn) {
        const isActive = voiceListening && voiceListenMode === 'role';
        roleMicBtn.innerHTML = `${iconHtml(isActive ? 'graphic_eq' : 'mic')} <span>${isActive ? dict.ui.roleMicOn : dict.ui.roleMicOff}</span>`;
        roleMicBtn.classList.toggle('listening', isActive);
        roleMicBtn.setAttribute('aria-pressed', String(isActive));
    }

    // TTS Toggle Buttons (Starter, Coach, Athlete)
    document.querySelectorAll('.btn-voice-tts-toggle').forEach(btn => {
        if (btn.id === 'btn-athlete-voice-filter') return;
        btn.innerHTML = `${iconHtml(voiceTtsEnabled ? 'volume_up' : 'volume_off', 'icon-sm')} <span>${voiceTtsEnabled ? dict.ui.ttsOn : dict.ui.ttsOff}</span>`;
        btn.classList.toggle('tts-active', voiceTtsEnabled);
        btn.setAttribute('aria-pressed', String(voiceTtsEnabled));
    });

    // Athlete Own/All filter button
    const filterBtn = document.getElementById('btn-athlete-voice-filter');
    if (filterBtn) {
        filterBtn.innerHTML = `${iconHtml(voiceAthleteOwnOnly ? 'person' : 'groups', 'icon-sm')} <span>${voiceAthleteOwnOnly ? dict.ui.ownOnly : dict.ui.allRuns}</span>`;
        filterBtn.classList.toggle('tts-active', voiceAthleteOwnOnly);
        filterBtn.setAttribute('aria-pressed', String(voiceAthleteOwnOnly));
    }

    // Starter hint text if idle
    const transcriptEl = document.getElementById('starter-voice-transcript');
    if (transcriptEl && !voiceListening) {
        transcriptEl.innerHTML = `${iconHtml('mic_none', 'icon-sm')} <span>${dict.ui.hintStarter}</span>`;
        transcriptEl.style.color = 'var(--text-secondary)';
    }

    updateStarterClockBannerUI();
}

document.addEventListener('DOMContentLoaded', () => {
    updateVoiceControlsUI();
    const ecoOverlay = document.getElementById('sensor-eco-overlay');
    if (ecoOverlay) {
        ecoOverlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') wakeSensorScreen(true);
            if (e.key === ' ') e.preventDefault();
        });
        ecoOverlay.addEventListener('keyup', (e) => {
            if (e.key === ' ') wakeSensorScreen(true);
        });
    }
});

// Expose globals
window.setVoiceLanguage = setVoiceLanguage;
window.toggleVoiceListening = toggleVoiceListening;
window.stopVoiceListening = stopVoiceListening;
window.toggleVoiceTts = toggleVoiceTts;
window.toggleVoiceAthleteFilter = toggleVoiceAthleteFilter;
window.handleVoiceSessionUpdate = handleVoiceSessionUpdate;
window.applyRolePowerAndVoicePolicy = applyRolePowerAndVoicePolicy;
window.shouldThrottleCV = shouldThrottleCV;
window.handleGpsPositionForBattery = handleGpsPositionForBattery;
window.toggleSensorEcoMode = toggleSensorEcoMode;
window.wakeSensorScreen = wakeSensorScreen;
window.dimSensorScreen = dimSensorScreen;
window.toggleStarterCameraMode = toggleStarterCameraMode;
window.setStarterCameraMode = setStarterCameraMode;
window.handleStarterRoleEntry = handleStarterRoleEntry;
window.playFisStartSequence = playFisStartSequence;
window.cancelFisStartSequence = cancelFisStartSequence;
window.triggerFisStartCountdownManual = triggerFisStartCountdownManual;
window.getExternalStartClockDevice = getExternalStartClockDevice;
