// --- Alppikello Multi-Language Voice UI, Audio Announcer & Cold-Weather Eco Mode ---

const VOICE_LANG_STORAGE_KEY = 'alppikello_voice_lang';
const VOICE_TTS_STORAGE_KEY = 'alppikello_voice_tts_enabled';
const VOICE_ATHLETE_FILTER_KEY = 'alppikello_voice_own_only';

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

// Snapshot of previous session state for detecting live announcements (start, split, finish)
let prevVoiceSessionSnapshot = null;

const VOICE_DICTIONARY = {
    FI: {
        bcp47: 'fi-FI',
        flag: '🇫🇮',
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
            micOn: '🎤 KUUNTELEE (PAINA LOPETTAAKSESI)',
            micOff: '🎤 KÄYNNISTÄ ÄÄNIOHJAUS',
            roleMicOn: '🎤 SANO ROOLI ÄÄNEEN...',
            roleMicOff: '🎤 VALITSE ROOLI ÄÄNELLÄ',
            hintStarter: 'Sano laskijan nimi (esim. "Matti") tai lisää uusi: "Uusi [Nimi]"',
            ttsOn: '🔊 KUULUTUS: PÄÄLLÄ',
            ttsOff: '🔇 KUULUTUS: POIS',
            ownOnly: '🎯 VAIN OMAT',
            allRuns: '🌐 KAIKKI LASKUT',
            courseFree: 'RATA VAPAA',
            skierReady: 'VALMIINA LÄHTÖÖN',
            courseBusy: 'LASKIJA RADALLA'
        },
        phrases: {
            roleSelected: (role) => `Rooli ${role} valittu`,
            addedNewFree: (name) => `Uusi laskija ${name} lisätty. Rata on vapaa, saa lähteä!`,
            addedNewBusy: (name) => `Uusi laskija ${name} lisätty jonoon. Odota, rata on varattu.`,
            queuedFree: (name) => `${name} valmiina. Rata on vapaa, saa lähteä!`,
            queuedBusy: (name) => `${name} jonossa. Odota lupaa, laskija radalla.`,
            queueCleared: () => `Lähtöjono tyhjennetty.`,
            notRecognized: (heard) => `Nimeä ${heard} ei löytynyt listalta. Sano Uusi ${heard} lisätäksesi.`,
            courseClearNext: (name) => `Rata on vapaa! ${name} saa lähteä!`,
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
        flag: '🇬🇧',
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
            micOn: '🎤 LISTENING (TAP TO STOP)',
            micOff: '🎤 START VOICE CONTROL',
            roleMicOn: '🎤 SPEAK ROLE NAME...',
            roleMicOff: '🎤 SELECT ROLE BY VOICE',
            hintStarter: 'Speak skier name (e.g. "Matti") or say "New [Name]"',
            ttsOn: '🔊 AUDIO: ON',
            ttsOff: '🔇 AUDIO: OFF',
            ownOnly: '🎯 MY RUNS ONLY',
            allRuns: '🌐 ALL RUNS',
            courseFree: 'TRACK CLEAR',
            skierReady: 'READY TO START',
            courseBusy: 'SKIER ON COURSE'
        },
        phrases: {
            roleSelected: (role) => `Role ${role} selected`,
            addedNewFree: (name) => `New skier ${name} added. Track is clear, go ahead!`,
            addedNewBusy: (name) => `New skier ${name} queued. Hold, skier on course.`,
            queuedFree: (name) => `${name} ready. Track is clear, you may start!`,
            queuedBusy: (name) => `${name} in queue. Hold at start, track busy.`,
            queueCleared: () => `Start queue cleared.`,
            notRecognized: (heard) => `${heard} not found. Say New ${heard} to add.`,
            courseClearNext: (name) => `Track is clear! ${name} may start!`,
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
        flag: '🇸🇪',
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
            micOn: '🎤 LYSSNAR (TRYCK FÖR ATT STOPPA)',
            micOff: '🎤 STARTA RÖSTSTYRNING',
            roleMicOn: '🎤 SÄG ROLLENS NAMN...',
            roleMicOff: '🎤 VÄLJ ROLL MED RÖST',
            hintStarter: 'Säg åkarens namn eller "Ny [Namn]"',
            ttsOn: '🔊 LJUD: PÅ',
            ttsOff: '🔇 LJUD: AV',
            ownOnly: '🎯 ENDAST MINA',
            allRuns: '🌐 ALLA ÅK',
            courseFree: 'BANAN FRI',
            skierReady: 'REDO FÖR START',
            courseBusy: 'ÅKARE I BANAN'
        },
        phrases: {
            roleSelected: (role) => `Roll ${role} vald`,
            addedNewFree: (name) => `Ny åkare ${name} tillagd. Banan är fri, kör!`,
            addedNewBusy: (name) => `Ny åkare ${name} i kö. Vänta, åkare i banan.`,
            queuedFree: (name) => `${name} redo. Banan är fri, klart att starta!`,
            queuedBusy: (name) => `${name} i kö. Vänta, banan är upptagen.`,
            queueCleared: () => `Startkön rensad.`,
            notRecognized: (heard) => `Hittade inte ${heard}. Säg Ny ${heard} för att lägga till.`,
            courseClearNext: (name) => `Banan är fri! ${name} kan starta!`,
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
        flag: '🇩🇪',
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
            micOn: '🎤 HÖRT ZU (TIPPEN ZUM STOPPEN)',
            micOff: '🎤 SPRACHSTEUERUNG STARTEN',
            roleMicOn: '🎤 ROLLE SPRECHEN...',
            roleMicOff: '🎤 ROLLE PER SPRACHE WÄHLEN',
            hintStarter: 'Name sprechen oder "Neu [Name]" sagen',
            ttsOn: '🔊 ANSAGE: AN',
            ttsOff: '🔇 ANSAGE: AUS',
            ownOnly: '🎯 NUR EIGENE',
            allRuns: '🌐 ALLE LÄUFE',
            courseFree: 'STRECKE FREI',
            skierReady: 'STARTBEREIT',
            courseBusy: 'LÄUFER AUF STRECKE'
        },
        phrases: {
            roleSelected: (role) => `Rolle ${role} gewählt`,
            addedNewFree: (name) => `Neuer Läufer ${name} hinzugefügt. Strecke frei, Start frei!`,
            addedNewBusy: (name) => `Neuer Läufer ${name} in Warteschlange. Bitte warten.`,
            queuedFree: (name) => `${name} bereit. Strecke ist frei, Start frei!`,
            queuedBusy: (name) => `${name} in Warteschlange. Bitte warten, Strecke besetzt.`,
            queueCleared: () => `Startliste geleert.`,
            notRecognized: (heard) => `${heard} nicht gefunden. Sage Neu ${heard} zum Hinzufügen.`,
            courseClearNext: (name) => `Strecke frei! ${name} Start frei!`,
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
        .replace(/(.)\1+/g, '$1') // Collapse double letters (kalle -> kale, matti -> mati)
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

            // Exact case-insensitive match
            if (rawName.toLowerCase() === cleaned) {
                return { athlete, score: 1.0 };
            }

            const normTarget = normalizePhonetic(rawName);
            if (normTarget === normSpoken) {
                return { athlete, score: 0.98 };
            }

            // Also check first name if athlete has "Firstname Lastname"
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

    // Require at least 0.62 similarity so random noise doesn't trigger a skier
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

function speakVoiceText(text, forceSpeak = false) {
    if (!('speechSynthesis' in window)) return;
    if (!voiceTtsEnabled && !forceSpeak) return;

    // Never speak on sensor roles (Start/Split/Finish/Video) after setup
    if (currentRole && ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) {
        return;
    }

    try {
        window.speechSynthesis.cancel();
        isBotSpeaking = true;

        const utterance = new SpeechSynthesisUtterance(text);
        const dict = getVoiceDict();
        utterance.lang = dict.bcp47;
        utterance.rate = 1.05;

        const releaseEchoLock = () => {
            setTimeout(() => {
                isBotSpeaking = false;
            }, 350);
        };

        utterance.onend = releaseEchoLock;
        utterance.onerror = releaseEchoLock;

        window.speechSynthesis.speak(utterance);
    } catch (e) {
        isBotSpeaking = false;
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
        if (isBotSpeaking) return; // Half-duplex echo lock

        const result = event.results[event.results.length - 1];
        if (!result || !result.isFinal) return;

        const alternatives = [];
        for (let i = 0; i < result.length; i++) {
            if (result[i] && result[i].transcript) {
                alternatives.push(result[i].transcript.trim());
            }
        }
        if (alternatives.length === 0) return;

        const primaryTranscript = alternatives[0];
        console.log('[VOICE] Heard alternatives:', alternatives);

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
            updateVoiceTranscriptUI('Mikrofonilupa evätty selaimessa.', 'var(--danger)');
        }
    };

    rec.onend = () => {
        // Auto-restart if still in active listening mode (e.g. Starter hands-free)
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
    if (voiceListening && voiceListenMode === mode) {
        stopVoiceListening();
        return;
    }
    startVoiceListening(mode);
}

function startVoiceListening(mode = 'starter') {
    // Sensor devices must never keep mic open
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
    } catch (e) {
        // Already started
    }

    updateVoiceControlsUI();
    if (mode === 'starter') {
        updateVoiceTranscriptUI(getVoiceDict().ui.hintStarter, 'var(--text-secondary)');
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

    // Check across all supported languages so user can speak any language during onboarding
    for (const langKey of Object.keys(VOICE_DICTIONARY)) {
        const roleMap = VOICE_DICTIONARY[langKey].roleKeywords;
        for (const [roleCode, keywords] of Object.entries(roleMap)) {
            for (const kw of keywords) {
                if (joined.includes(kw.toLowerCase())) {
                    stopVoiceListening();
                    speakVoiceText( getVoiceDict().phrases.roleSelected(kw), true );
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

    updateVoiceTranscriptUI(`"${primary}"`, '#fff');

    // 1. Check for Cancel / Clear Queue command across all languages
    const allCancelWords = [
        ...VOICE_DICTIONARY.FI.cancelKeywords,
        ...VOICE_DICTIONARY.EN.cancelKeywords,
        ...VOICE_DICTIONARY.SV.cancelKeywords,
        ...VOICE_DICTIONARY.DE.cancelKeywords
    ];
    const words = lowerPrimary.split(/\s+/);
    if (words.some(w => allCancelWords.includes(w))) {
        if (typeof clearQueue === 'function') clearQueue();
        speakVoiceText(dict.phrases.queueCleared());
        updateVoiceTranscriptUI(`✓ ${dict.phrases.queueCleared()}`, 'var(--warning)');
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
                    socket.emit('add_athlete', {
                        sessionId: currentSession.id,
                        name: cleanNewName,
                        autoQueue: true
                    });

                    const isCourseBusy = (currentSession.onCourse || []).length > 0;
                    const msg = isCourseBusy
                        ? dict.phrases.addedNewBusy(cleanNewName)
                        : dict.phrases.addedNewFree(cleanNewName);
                    speakVoiceText(msg);
                    updateVoiceTranscriptUI(`➕ ${cleanNewName.toUpperCase()}`, 'var(--success)');
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
        if (typeof addToQueue === 'function') {
            addToQueue(athlete.id);
        }
        const isCourseBusy = (currentSession.onCourse || []).length > 0;
        const msg = isCourseBusy
            ? dict.phrases.queuedBusy(athlete.name)
            : dict.phrases.queuedFree(athlete.name);
        speakVoiceText(msg);
        updateVoiceTranscriptUI(`✓ ${athlete.name.toUpperCase()}`, 'var(--success)');
    } else {
        speakVoiceText(dict.phrases.notRecognized(primary));
        updateVoiceTranscriptUI(`❓ "${primary}" (Sano: "Uusi ${capitalizeAthleteName(primary)}")`, 'var(--warning)');
    }
}

// ============================================================================
// LIVE SESSION EVENT ANNOUNCER (Starts, Splits, Finishes, Course Clearance)
// ============================================================================

function handleVoiceSessionUpdate(prevSession, nextSession) {
    if (!nextSession) return;
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

    // 2. If Starter role (`LÄHETTÄJÄ`) and course just became FREE (prev had runner, now empty)
    if (isStarterRole && (snap.onCourse || []).length > 0 && nextOnCourse.length === 0) {
        const nextQueue = nextSession.activeQueue || [];
        if (nextQueue.length > 0) {
            speakVoiceText(dict.phrases.courseClearNext(nextQueue[0].name));
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
    if (!announcedFinish && isListenerRole) {
        for (const runner of nextOnCourse) {
            if (runner.runId && !prevOnCourseIds.has(runner.runId) && shouldAnnounceAthlete(runner.name)) {
                speakVoiceText(dict.phrases.started(runner.name));
                break;
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
    const isSensorRole = ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(role);

    if (isSensorRole) {
        // 1. Strictly kill microphone and speech synthesis on sensor devices
        stopVoiceListening();
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        // 2. Enable OLED screen dimmer timer (auto-dim after 25s to save battery in sub-zero cold)
        setupSensorEcoDimmer();
    } else {
        // Disable sensor screen dimmer on human interactive roles
        clearSensorEcoDimmer();
        if (role !== 'LÄHETTÄJÄ') {
            stopVoiceListening();
        }
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

function resetSensorEcoTimer() {
    if (ecoDimmerTimer) clearTimeout(ecoDimmerTimer);
    if (!ecoDimmerEnabled) return;
    if (!currentRole || !['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) return;

    ecoDimmerTimer = setTimeout(() => {
        dimSensorScreen();
    }, 25000);
}

function dimSensorScreen() {
    if (!currentRole || !['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole)) return;
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

    roleEl.innerText = `🔋 ${currentRole || 'ANTURI'} – VIRRANSÄÄSTÖTILA`;
    const onCourse = session && session.onCourse ? session.onCourse : [];
    const queue = session && session.activeQueue ? session.activeQueue : [];

    if (onCourse.length > 0) {
        stateEl.innerText = `⚡ LASKIJA RADALLA: ${onCourse[0].name.toUpperCase()} (60 FPS AKTIIVINEN)`;
        stateEl.style.color = '#10b981';
    } else if (queue.length > 0 && currentRole === 'LÄHTÖ') {
        stateEl.innerText = `⚡ LÄHTÖJONOSSA: ${queue[0].name.toUpperCase()} (60 FPS AKTIIVINEN)`;
        stateEl.style.color = '#3b82f6';
    } else {
        stateEl.innerText = `💤 RATA VAPAA – KAMERA VALMIUSTILASSA (4 FPS ECO)`;
        stateEl.style.color = 'rgba(255,255,255,0.45)';
    }
}

/**
 * Called by cv.js to determine whether CV should run at full 60fps or throttled 4fps eco mode.
 */
function shouldThrottleCV(roleType) {
    if (!currentSession) return false;
    const queueCount = (currentSession.activeQueue || []).length;
    const onCourseCount = (currentSession.onCourse || []).length;

    if (roleType === 'lähtö') {
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

    const isStationaryRole = ['LÄHTÖ', 'VÄLIAIKA', 'MAALI', 'VIDEO'].includes(currentRole);
    if (isStationaryRole && (accuracy <= 20 || gpsFixCount >= 3)) {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        gpsLockedForSession = true;
        console.log(`[ECO-GPS] Stationary role ${currentRole} GPS locked (acc: ${Math.round(accuracy)}m). Stopped continuous GPS watch to save battery.`);
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
            recognitionInstance.stop(); // onend will auto-restart with new lang
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
        speakVoiceText(dict.ui.ttsOn.replace(/[🔊🔇]/g, ''), true);
    } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

function toggleVoiceAthleteFilter() {
    voiceAthleteOwnOnly = !voiceAthleteOwnOnly;
    localStorage.setItem(VOICE_ATHLETE_FILTER_KEY, String(voiceAthleteOwnOnly));
    updateVoiceControlsUI();
}

function updateVoiceTranscriptUI(text, color = '#fff') {
    const el = document.getElementById('starter-voice-transcript');
    if (el) {
        el.innerText = text;
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
        labelEl.innerText = `🔴 ${dict.ui.courseBusy}: ${onCourse[0].name.toUpperCase()}`;
        labelEl.style.color = 'var(--danger)';
    } else if (queue.length > 0) {
        greenBulb.classList.add('active-green');
        yellowBulb.classList.add('active-yellow');
        labelEl.innerText = `🟢 ${dict.ui.skierReady}: ${queue[0].name.toUpperCase()}`;
        labelEl.style.color = 'var(--success)';
    } else {
        greenBulb.classList.add('active-green');
        labelEl.innerText = `🟢 ${dict.ui.courseFree}`;
        labelEl.style.color = 'var(--success)';
    }
}

function updateVoiceControlsUI() {
    const dict = getVoiceDict();

    // Update all language pills across views
    document.querySelectorAll('.voice-lang-btn').forEach(btn => {
        const isSelected = btn.getAttribute('data-lang') === voiceLang;
        btn.classList.toggle('active', isSelected);
    });

    // Starter Mic Button
    const starterMicBtn = document.getElementById('btn-starter-mic');
    if (starterMicBtn) {
        const isActive = voiceListening && voiceListenMode === 'starter';
        starterMicBtn.innerText = isActive ? dict.ui.micOn : dict.ui.micOff;
        starterMicBtn.classList.toggle('listening', isActive);
    }

    // Role Selection Mic Button
    const roleMicBtn = document.getElementById('btn-role-mic');
    if (roleMicBtn) {
        const isActive = voiceListening && voiceListenMode === 'role';
        roleMicBtn.innerText = isActive ? dict.ui.roleMicOn : dict.ui.roleMicOff;
        roleMicBtn.classList.toggle('listening', isActive);
    }

    // TTS Toggle Buttons (Starter, Coach, Athlete)
    document.querySelectorAll('.btn-voice-tts-toggle').forEach(btn => {
        btn.innerText = voiceTtsEnabled ? dict.ui.ttsOn : dict.ui.ttsOff;
        btn.classList.toggle('tts-active', voiceTtsEnabled);
    });

    // Athlete Own/All filter button
    const filterBtn = document.getElementById('btn-athlete-voice-filter');
    if (filterBtn) {
        filterBtn.innerText = voiceAthleteOwnOnly ? dict.ui.ownOnly : dict.ui.allRuns;
    }

    // Starter hint text if idle
    const transcriptEl = document.getElementById('starter-voice-transcript');
    if (transcriptEl && !voiceListening) {
        transcriptEl.innerText = dict.ui.hintStarter;
        transcriptEl.style.color = 'var(--text-secondary)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateVoiceControlsUI();
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
