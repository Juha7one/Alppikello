// If hosted on a static server (like alppikello.luodut.com), connect to the external Render server.
// Otherwise, connect to the same origin.
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? undefined
    : 'https://alppikello-backend.onrender.com';

const socket = io(SERVER_URL);

// --- Globals & State ---
let currentSession = null;
let currentRole = null;
let serverTimeOffset = 0;
let rtt = 0;
let selectedRole = null;
let userName = localStorage.getItem('alppikello_user_name') || "";
let activeRunnerOnCourse = null; // Track who is currently running
let hasRecordedForCurrentRunner = false; // Prevent multiple clips per runner
let s3Active = false; // Is cloud storage available?

// Rendering optimization locks
let lastAthletesCount = -1;
let lastResultsCount = -1;
let lastQueueCount = -1;
let lastOnCourseCount = -1;
let lastNextId = null;

// UI Elements
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const syncOffsetEl = document.getElementById('sync-offset');
const roleBtn = document.getElementById('btn-change-role');

// Timers & Video
let uiUpdateTimer = null;
let cvInterval = null;
let lastTriggerTime = 0;
let cvStream = null;
let mediaRecorder = null;
let recordingChunks = [];
let isRecordingActive = false;
let recordedClips = [];
let bufferResetTimer = null;

// --- Global Helper Functions ---

function shareRun(runId) {
    if (!runId || runId === 'undefined') return alert("Hups! Tämä tallenne on vielä matkalla pilveen tai se on liian vanha.");
    
    const url = window.location.origin + '/run/' + runId;
    
    if (navigator.share) {
        navigator.share({
            title: 'Alppikello Run Card',
            text: 'Tsekkaa lasku Alppikellosta!',
            url: url,
        }).catch(err => {
            console.error("Jakaminen epäonnistui:", err);
            copyToClipboard(url);
        });
    } else {
        copyToClipboard(url);
    }
}

function copyToClipboard(text) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showVideoNotification("Linkki kopioitu leikepöydälle! 🔗");
}

// --- Initialization & Socket Events ---

socket.on('connect', () => {
    connDot.classList.add('connected');
    connText.innerText = 'Yhdistetty';
    startTimeSync();
    checkDeepLink();
    startDiscoveryGPS(); 
    
    // Set stored name if any
    if (userName) document.getElementById('input-user-name').value = userName;
    showOnboardingStep('name');
});

socket.on('nearby_sessions_found', (sessions) => {
    const listEl = document.getElementById('nearby-sessions-list');
    const container = document.getElementById('nearby-sessions-container');
    if (!listEl || !container) return;

    if (sessions && sessions.length > 0) {
        container.style.display = 'block';
        listEl.innerHTML = sessions.map(s => `
            <div class="card" onclick="joinNearbySession('${s.id}')" style="padding: 16px; margin: 0 0 10px 0; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; background: rgba(59, 130, 246, 0.1); border-color: var(--accent);">
                <div>
                    <div style="font-weight: 800; font-size: 16px;">${s.name.toUpperCase()}</div>
                    <div style="font-size: 11px; opacity: 0.6; font-weight: 700;">KOODI: ${s.id} • ${s.athleteCount} LASKIJAA</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 900; color: var(--accent); font-size: 14px;">${s.distance} km</div>
                    <div style="font-size: 9px; opacity: 0.5;">ETÄISYYS</div>
                </div>
            </div>
        `).join('');
    } else {
        container.style.display = 'none';
    }
});

function joinNearbySession(sid) {
    document.getElementById('input-session-id').value = sid;
    joinSession();
}

let discoveryWatchId = null;
function startDiscoveryGPS() {
    if (!navigator.geolocation) return;
    discoveryWatchId = navigator.geolocation.watchPosition((pos) => {
        socket.emit('find_nearby_sessions', {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
        });
    }, (err) => {
        console.warn("Discovery GPS error:", err);
    }, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    });
}

socket.on('disconnect', () => {
    connDot.classList.remove('connected');
    connText.innerText = 'Yhteys katkesi';
});

// Auto-hide Splash Screen after a short delay
window.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('deployment-splash');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.visibility = 'hidden';
            }, 800);
        }, 2500);
    }
});

socket.on('s3_status', (data) => {
    s3Active = data.active;
    updateUI();
});

socket.on('session_created', (session) => {
    handleSessionJoin(session, 'VALMENTAJA');
});

socket.on('session_joined', (data) => {
    if (data.success) {
        handleSessionJoin(data.session, data.role);
    } else {
        alert('Liittyminen epäonnistui: ' + data.error);
        showOnboardingStep('name');
    }
});

socket.on('device_status_update', (data) => {
    currentSession = data.session;

    // Check if someone is on course for Video logic
    if (currentSession.onCourse && currentSession.onCourse.length > 0) {
        const firstRunner = currentSession.onCourse[0];
        // If a new runner appears, reset the recording flag
        if (!activeRunnerOnCourse || activeRunnerOnCourse.id !== firstRunner.id) {
            activeRunnerOnCourse = firstRunner;
            hasRecordedForCurrentRunner = false;
        }
    } else {
        activeRunnerOnCourse = null;
        hasRecordedForCurrentRunner = false;
    }

    updateUI();
});

socket.on('session_ended', () => {
    alert('Harjoitus on lopetettu valmentajan toimesta.');
    location.reload(); // Hard reset to onboarding
});

socket.on('timing_update', (data) => {
    // data contains: type (START/SPLIT/FINISH), runner, session
    currentSession = data.session;
    updateUI();

    if (currentRole === 'VIDEO' && data.type === 'START') {
        showVideoNotification(`LASKIJA LÄHTI: ${data.runner.name}`);
        // In the future: logic for delayed capture based on GPS
    }

    // Optional: Add a toast or flash for the event
    console.log(`TIMING [${data.type}]: ${data.runner.name}`);
});

function showVideoNotification(msg) {
    const info = document.getElementById('video-node-info');
    if (info) {
        info.innerText = msg;
        info.style.color = "var(--accent)";
        setTimeout(() => {
            info.innerText = "VALMIINA";
            info.style.color = "";
        }, 5000);
    }
}

// --- Onboarding & Deep Linking ---

function checkDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('s');
    if (sid) {
        document.getElementById('input-session-id').value = sid.toUpperCase();
        showOnboardingStep('name'); // Start from name, but session is pre-filled
    }
}

// --- Onboarding Helpers ---

let endSessionStep = 0;
function confirmEndSession() {
    if (endSessionStep === 0) {
        if (confirm('Haluatko varmasti lopettaa harjoituksen? Tämä poistaa kaikki tiedot ja katkaisee yhteyden muilta laitteilta.')) {
            endSessionStep = 1;
            const btn = document.querySelector('#coach-only-end .btn-danger');
            if (btn) {
                btn.innerText = "VAHVISTA LOPETUS!";
                btn.style.background = "var(--danger)";
                btn.style.color = "white";
                btn.style.boxShadow = "0 0 30px rgba(239, 68, 68, 0.5)";
            }
            // Auto-reset after 5 seconds if not clicked again
            setTimeout(() => {
                endSessionStep = 0;
                if (btn) {
                    btn.innerText = "LOPETA HARJOITUS";
                    btn.style.background = "";
                    btn.style.color = "";
                    btn.style.boxShadow = "";
                }
            }, 5000);
        }
    } else {
        if (currentSession) {
            socket.emit('end_session', currentSession.id);
        }
    }
}

function saveNameAndNext() {
    const val = document.getElementById('input-user-name').value.trim();
    if (!val) return alert("Kirjoita nimesi ensin!");
    userName = val;
    localStorage.setItem('alppikello_user_name', userName);
    showOnboardingStep('role');
}

function showOnboardingStep(step) {
    // Hide all steps
    document.querySelectorAll('.ob-step').forEach(el => el.style.display = 'none');
    
    const stepEl = document.getElementById('ob-step-' + step);
    if (stepEl) {
        stepEl.style.display = 'block';
    }

    if (step === 'session') {
        const isCoach = selectedRole === 'VALMENTAJA';
        document.getElementById('coach-only-create').style.display = isCoach ? 'block' : 'none';
        document.getElementById('session-step-title').innerText = isCoach ? 'LUO HARJOITUS' : 'LIITY HARJOITUKSEEN';
    }
}

socket.on('session_names_list', (data) => {
    const listEl = document.getElementById('valitse-nimi-lista');
    const introEl = document.getElementById('setup-name-instruction');
    const labelEl = document.getElementById('setup-name-new-label');
    const inputEl = document.getElementById('name-input');

    if (!listEl) return;

    let itemsToShow = [];
    let icon = '👤';

    if (selectedRole === 'VÄLIAIKA') {
        introEl.innerText = "Valitse väliaikapiste tai luo uusi:";
        labelEl.innerText = "TAI UUSI VÄLIAIKAPISTE:";
        inputEl.placeholder = "PISTEEN NIMI";
        icon = '⏱️';
        if (data.devices) {
            itemsToShow = data.devices.filter(d => d.role === 'VÄLIAIKA').map(d => ({ name: d.name }));
        }
    } else if (selectedRole === 'VIDEO') {
        introEl.innerText = "Valitse kamera tai luo uusi:";
        labelEl.innerText = "TAI UUSI KAMERA:";
        inputEl.placeholder = "KAMERAN NIMI";
        icon = '📹';
        if (data.devices) {
            itemsToShow = data.devices.filter(d => d.role === 'VIDEO').map(d => ({ name: d.name }));
        }
    } else if (selectedRole === 'LÄHTÖ') {
        introEl.innerText = "Valitse korvattava Starttikello tai nimeä tämä laite:";
        labelEl.innerText = "TAI UUSI LAITENIMI:";
        inputEl.placeholder = "ESIM. VARAPUHELIN";
        icon = '⏲️';
        if (data.devices) {
            itemsToShow = data.devices.filter(d => d.role === 'LÄHTÖ').map(d => ({ name: d.name }));
        }
    } else if (selectedRole === 'MAALI') {
        introEl.innerText = "Valitse korvattava Maalikamera tai nimeä tämä laite:";
        labelEl.innerText = "TAI UUSI LAITENIMI:";
        inputEl.placeholder = "ESIM. IPAD LOPPU";
        icon = '🏁';
        if (data.devices) {
            itemsToShow = data.devices.filter(d => d.role === 'MAALI').map(d => ({ name: d.name }));
        }
    } else if (selectedRole === 'VALMENTAJA' || selectedRole === 'LÄHETTÄJÄ' || selectedRole === 'KATSOMO') {
        introEl.innerText = "Anna laitteelle tai sijainnille nimi:";
        labelEl.innerText = "LAITTEEN NIMI:";
        inputEl.placeholder = "NIMI TAI TUNNISTE";
        // Generally these don't pick from a list of athletes, maybe show an empty list or show devices
        itemsToShow = [];
    } else {
        // URHEILIJA defaults
        introEl.innerText = "Valitse nimesi alta tai kirjoita uusi:";
        labelEl.innerText = "TAI UUSI LASKIJA:";
        inputEl.placeholder = "OMA NIMESI";
        itemsToShow = data.athletes || [];
    }

    // Deduplicate names to keep the list clean
    const uniqueNames = [...new Set(itemsToShow.map(item => item.name))].filter(n => n);

    if (uniqueNames.length > 0) {
        listEl.innerHTML = uniqueNames.map(name => `
            <button class="btn btn-outline btn-mini" style="text-align:left; justify-content:flex-start; font-size:16px;" onclick="selectExistingName('${name.replace(/'/g, "\\'")}')">
                ${icon} ${name}
            </button>
        `).join('');
        listEl.style.display = 'flex';
    } else {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
    }
});

function selectExistingName(name) {
    document.getElementById('name-input').value = name;
    saveName();
}

function showRoleSelection() {
    // Return to role selection grid
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.add('active');
    showOnboardingStep('role');
    roleBtn.style.display = "none";
}

// --- Time Sync Logic ---

function startTimeSync() {
    for (let i = 0; i < 5; i++) setTimeout(syncTime, i * 500);
    setInterval(syncTime, 30000);
}

function syncTime() {
    socket.emit('sync_time', Date.now());
}

socket.on('sync_response', (data) => {
    const t4 = Date.now();
    serverTimeOffset = ((data.serverReceivedTime - data.clientSentTime) + (data.serverReceivedTime - t4)) / 2;
    rtt = t4 - data.clientSentTime;
    syncOffsetEl.innerText = `${Math.round(serverTimeOffset)}ms (RTT: ${rtt}ms)`;
});

function getSyncedTime() { return Date.now() + serverTimeOffset; }

// --- View Logic ---

function selectRole(role) {
    selectedRole = role;
    document.querySelectorAll('.role-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.role === role) card.classList.add('selected');
    });

    showOnboardingStep('session');
}

async function createSession() {
    if (!userName) return showOnboardingStep('name');

    const days = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
    const now = new Date();
    const timeStr = `${days[now.getDay()]} ${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()} klo ${now.getHours()}`;
    let sessionName = `Treeni ${timeStr}`;

    if ("geolocation" in navigator) {
        try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 }));
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await resp.json();
            const place = data.address.suburb || data.address.city || data.address.town;
            if (place) sessionName = `${place} ${timeStr}`;
        } catch (e) { }
    }
    socket.emit('create_session', { name: sessionName, creatorName: userName });
}

function joinSession() {
    let sid = document.getElementById('input-session-id').value.trim().toUpperCase();
    if (!sid) return alert('Syötä harjoituksen koodi!');
    if (!selectedRole) return alert('Valitse ensin rooli!');

    socket.emit('join_session', {
        sessionId: sid,
        role: selectedRole,
        deviceName: userName || "Laite"
    });
}

function handleSessionJoin(session, role) {
    currentSession = session;
    currentRole = role;

    // Sync session input so switching role works even if it was empty
    const input = document.getElementById('input-session-id');
    if (input) input.value = session.id;

    // Stop discovery GPS when joined
    if (discoveryWatchId) {
        navigator.geolocation.clearWatch(discoveryWatchId);
        discoveryWatchId = null;
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');

    let viewId = `view-${role.toLowerCase()}`;
    // Explicit mapping for roles with special characters or specific IDs
    if (role === 'KATSOMO') viewId = 'view-valmentaja';
    if (role === 'LÄHTÖ') viewId = 'view-lahto';
    if (role === 'LÄHETTÄJÄ') viewId = 'view-lahettaja';

    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.classList.add('active');
    else console.warn("View not found for role:", role, viewId);

    // Show change buttons
    roleBtn.style.display = "block";
    const nameBtn = document.getElementById('btn-change-name');
    if (nameBtn) {
        nameBtn.style.display = "block";
        document.getElementById('current-user-name-display').innerText = userName || "Tuntematon";
    }

    // Update Headings if Katsomo
    const coachBadge = document.getElementById('coach-role-badge');
    if (coachBadge) {
        coachBadge.innerText = (role === 'KATSOMO') ? 'KATSOMO / LIVE' : 'VALMENTAJA';
        coachBadge.style.background = (role === 'KATSOMO') ? 'var(--success)' : 'var(--accent)';
    }

    // Start Live Clock for ALL active roles to ensure queue/timing updates
    if (!uiUpdateTimer) {
        uiUpdateTimer = setInterval(updateUI, 100);
    }

    // Reset rendering locks to force a full update on join
    lastAthletesCount = -1;
    lastResultsCount = -1;
    lastQueueCount = -1;
    lastOnCourseCount = -1;

    // Update all potential session-name headers
    ['start', 'finish', 'lahettaja', 'lahto', 'split', 'coach', 'athlete'].forEach(id => {
        const el = document.getElementById(`${id}-session-name`);
        if (el) el.innerText = session.name;
    });

    if (role === 'VALMENTAJA') {
        const sNameEl = document.getElementById('session-name');
        if (sNameEl) sNameEl.innerText = session.name;
        document.getElementById('session-code').innerText = session.id;
        generateQR(session.id);
    } else if (role === 'URHEILIJA') {
        document.getElementById('athlete-welcome').innerText = `TERVE, ${userName.toUpperCase()}!`;
        renderAthleteView();
    }

    // Start GPS Tracking for all devices
    startGPSTracking();

    updateUI();
}

let watchId = null;
function startGPSTracking() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            if (currentSession) {
                socket.emit('update_location', {
                    sessionId: currentSession.id,
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            }
        }, (err) => {
            console.warn("GPS tracking error:", err.message);
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }
}

/**
 * Formats milliseconds to "ss.cc" or "mm:ss.cc"
 */
function formatDuration(ms) {
    if (ms === undefined || ms === null) return "--.--";
    if (ms < 0) ms = 0;
    const totalSeconds = ms / 1000;
    const mins = Math.floor(totalSeconds / 60);
    const secs = (totalSeconds % 60).toFixed(2);

    if (mins > 0) {
        // padStart for seconds but only the integer part (before the dot)
        const parts = secs.split('.');
        const paddedSecs = parts[0].padStart(2, '0') + '.' + parts[1];
        return `${mins}:${paddedSecs}`;
    }
    return secs;
}

function generateQR(sid) {
    const canvas = document.getElementById('session-qr-large');
    if (!canvas) return;

    const url = `${window.location.origin}${window.location.pathname}?s=${sid}`;

    // Ensure QRCode library is loaded
    if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, url, { margin: 1, width: 260 }, (err) => {
            if (err) console.error("QR Error:", err);
            else console.log("QR Generated for", url);
        });
    } else {
        console.warn("QRCode library not loaded yet.");
    }
}

function showQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.style.display = 'flex';
        if (currentSession) {
            generateQR(currentSession.id);
        }
    }
}

function hideQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'none';
}

// --- Role Logic ---

function addToQueue(athleteId) {
    socket.emit('move_to_queue', { sessionId: currentSession.id, athleteId });
}

function markReady() {
    socket.emit('athlete_ready', { sessionId: currentSession.id, name: userName });
    const btn = document.getElementById('ready-btn');
    if (btn) {
        btn.innerText = "ODOTETAAN LÄHTÖÄ...";
        btn.disabled = true;
    }
    const status = document.getElementById('athlete-queue-status');
    if (status) status.innerText = "JONOSSA";
}

function simulateTrigger(type) {
    const timestamp = getSyncedTime();
    socket.emit(`trigger_${type}`, {
        sessionId: currentSession.id,
        timestamp,
        deviceName: userName || 'Tuntematon laite'
    });

    // Flash UI for feedback
    const id = type === 'start' ? 'start' : (type === 'finish' ? 'finish' : 'split');
    const infoEl = document.getElementById(`${id}-node-info`);
    if (infoEl) {
        const originalText = infoEl.innerText;
        infoEl.innerText = "LAUKAISTU! ⏱️";
        infoEl.style.color = "var(--success)";
        setTimeout(() => {
            infoEl.innerText = originalText;
            infoEl.style.color = "";
        }, 2000);
    }
}

// --- Lähettäjä Logic ---

function addAthleteManually() {
    const input = document.getElementById('input-manual-athlete');
    const name = input.value.trim();
    if (!name) return alert("Kirjoita nimi!");
    
    if (currentSession) {
        socket.emit('add_athlete', { sessionId: currentSession.id, name: name, autoQueue: true });
        input.value = "";
        // Optional: provide feedback
        showVideoNotification(`URHEILIJA LISÄTTY: ${name.toUpperCase()} ⛷️`);
    }
}

// --- Computer Vision (Digital Photocell) ---

async function initTriggerCV(roleType) {
    const isStart = roleType === 'lähtö';
    const isFinish = roleType === 'maali';
    const isSplit = roleType === 'väliaika';
    const isVideo = roleType === 'video';

    const videoId = isStart ? 'start-video' : (isFinish ? 'maali-video' : (isSplit ? 'väliaika-video' : 'video-video'));
    const canvasId = isStart ? 'start-overlay' : (isFinish ? 'maali-overlay' : (isSplit ? 'väliaika-overlay' : 'video-overlay'));
    const statusId = isStart ? 'start-status-overlay' : (isFinish ? 'maali-status-overlay' : (isSplit ? 'väliaika-status-overlay' : 'video-status-overlay'));
    const btnId = isStart ? 'btn-start-cv' : (isFinish ? 'btn-maali-cv' : (isSplit ? 'btn-väliaika-cv' : 'btn-video-cv'));

    const video = document.getElementById(videoId);
    const canvas = document.getElementById(canvasId);
    const status = document.getElementById(statusId);
    const btn = document.getElementById(btnId);

    if (!video || !canvas) return;

    if (cvStream) {
        cvStream.getTracks().forEach(track => track.stop());
        cvStream = null;
        if (status) {
            status.innerText = "CV POIS PÄÄLTÄ";
            status.style.background = "rgba(0,0,0,0.6)";
        }
        if (btn) {
            btn.innerText = isVideo ? "AKTIVOI KAMERA" : "AKTIVOI KENNO";
            btn.classList.remove('btn-danger');
            btn.classList.add(isStart ? 'btn-primary' : (isFinish ? 'btn-success' : (isSplit ? 'btn-warning' : 'btn-danger')));
        }
        return;
    }

    try {
        // Try environment camera first (phone back cam), fallback to any if fails
        try {
            cvStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: 640, height: 480 },
                audio: false
            });
        } catch (e) {
            cvStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
        }

        video.srcObject = cvStream;
        video.play().catch(e => console.warn("Video play failed:", e));
        if (status) {
            status.innerText = "CV AKTIIVINEN";
            status.style.background = "var(--success)";
        }
        if (btn) {
            btn.innerText = "SULJE KAMERA";
            btn.classList.remove('btn-primary', 'btn-success', 'btn-warning');
            btn.classList.add('btn-danger');
        }

        // EVERY CV device starts buffering so it can capture clips on trigger
        startVideoBuffer(cvStream);

        startCVLogic(roleType, video, canvas);
    } catch (err) {
        console.error("Kameravirhe:", err);
        alert("Kameran avaaminen epäonnistui. Varmista luvat.");
    }
}


function startVideoBuffer(stream) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    console.log("Starting Video Buffer...");
    try {
        const types = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
        let supportedType = types.find(t => MediaRecorder.isTypeSupported(t));

        if (!supportedType) return;

        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedType });
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordingChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            // This is where the actual saving happens now
            finalizeVideoSave();
        };

        mediaRecorder.start(1000);

        // Rolling buffer logic: If no one is on course, restart every 20s to keep header fresh
        if (bufferResetTimer) clearTimeout(bufferResetTimer);
        bufferResetTimer = setTimeout(() => {
            if (!activeRunnerOnCourse && mediaRecorder && mediaRecorder.state === 'recording') {
                console.log("Idle buffer reset...");
                mediaRecorder.stop();
                setTimeout(() => startVideoBuffer(stream), 100);
            }
        }, 20000);

    } catch (e) {
        console.error("MediaRecorder start failed:", e);
    }
}

let pendingRunnerMetadata = null;

function saveVideoClip() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    // Set metadata for the stop event
    pendingRunnerMetadata = activeRunnerOnCourse ? { ...activeRunnerOnCourse } : { name: "Tuntematon" };

    console.log("Stopping recorder to finalize clip...");
    mediaRecorder.stop();
    // finalizeVideoSave() will be called by onstop
}

function finalizeVideoSave() {
    if (recordingChunks.length === 0) {
        // If it was just an idle reset, just restart
        if (!pendingRunnerMetadata) return;
    }

    const runner = pendingRunnerMetadata || { name: "Tuntematon" };
    pendingRunnerMetadata = null;

    console.log(`Finalizing video for ${runner.name}...`);
    const blob = new Blob(recordingChunks, { type: recordingChunks[0].type });
    const url = URL.createObjectURL(blob);

    recordedClips.unshift({
        name: runner.name,
        url: url,
        time: new Date().toLocaleTimeString(),
        size: Math.round(blob.size / 1024)
    });

    renderVideoGallery();
    showVideoNotification(`VIDEO TALLESSA: ${runner.name.toUpperCase()} 🎬`);

    // UPLOAD TO SERVER (Central Archive)
    uploadVideoToServer(blob, runner);

    // Restart buffer immediately
    if (cvStream) startVideoBuffer(cvStream);
}

function uploadVideoToServer(blob, runner) {
    if (!currentSession) return;

    console.log("Uploading video to central archive...");
    const formData = new FormData();
    const safeRole = (currentRole || 'VIDEO').replace(/[ÄÖ]/g, (m) => m === 'Ä' ? 'A' : 'O').replace(/[^a-zA-Z0-9]/g, '_');
    formData.append('video', blob, `${safeRole}_${runner.name}.mp4`);
    formData.append('sessionId', currentSession.id);
    formData.append('runnerId', runner.id);
    formData.append('runnerName', runner.name);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            console.log("Central archive upload success:", data.url);
            // Optionally update the recordedClips with the server URL if needed
            // For now, we'll assume the server handles storage and we just log success.
        })
        .catch(err => {
            console.error("Central archive upload failed:", err);
        });
}

function renderVideoGallery() {
    const gallery = document.getElementById('video-gallery');
    if (!gallery) return;

    if (recordedClips.length === 0) {
        gallery.innerHTML = '<p style="font-size: 14px; opacity: 0.5; text-align: center; padding: 10px;">Ei tallenteita tässä istunnossa.</p>';
        return;
    }

    gallery.innerHTML = recordedClips.map((clip, index) => `
        <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--accent);">
            <div>
                <div style="font-weight: 800; font-size: 14px;">${clip.name.toUpperCase()}</div>
                <div style="font-size: 10px; opacity: 0.5;">${clip.time} • ${clip.size} KB</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-mini" onclick="window.open('${clip.url}')" style="background: var(--accent); white-space: nowrap;">KATSO</button>
                <a href="${clip.url}" download="Alppikello_${clip.name}.mp4" class="btn-mini" style="background: rgba(255,255,255,0.1); text-decoration: none; display: flex; align-items: center; font-size: 10px;">LATAA</a>
            </div>
        </div>
    `).join('');
}

function getDistanceBetween(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // Returns meters
}

function startCVLogic(roleType, video, canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Internal canvas for sampling (hidden)
    const procCanvas = document.createElement('canvas');
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    // Normalize role
    let triggerType = 'split';
    if (roleType === 'lähtö') triggerType = 'start';
    if (roleType === 'maali') triggerType = 'finish';
    if (roleType === 'video') triggerType = 'video_clip';

    console.log("CV LOGIC STARTING FOR:", roleType);

    let previousIntensity = -1;
    const threshold = 12; // sensitivity
    const gateX = 0.5; // middle

    const processFrame = () => {
        if (!cvStream) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            // Match canvas sizes
            if (canvas.width !== video.videoWidth) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                procCanvas.width = video.videoWidth / 2; // Sample at half res for speed
                procCanvas.height = video.videoHeight / 2;
            }

            // 1. MUST DRAW the video to our processing context!
            procCtx.drawImage(video, 0, 0, procCanvas.width, procCanvas.height);

            // 2. Prepare Overlay UI (transparent)
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const x = canvas.width * gateX;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

            // 3. Sample the Gate (from procCanvas)
            const procX = Math.round(procCanvas.width * gateX);
            const imageData = procCtx.getImageData(Math.max(0, procX - 1), 0, 2, procCanvas.height);
            const data = imageData.data;
            let totalB = 0;
            for (let i = 0; i < data.length; i += 4) {
                totalB += (data[i] + data[i + 1] + data[i + 2]) / 3;
            }
            const avgIntensity = totalB / (data.length / 4);

            // 4. Debug & Detection
            const now = Date.now();
            const diff = (previousIntensity !== -1) ? Math.abs(avgIntensity - previousIntensity) : 0;

            // DRAW DEBUG ALWAYS (TOP LEFT)
            ctx.fillStyle = "white";
            ctx.font = "bold 18px Courier";
            ctx.shadowColor = "black";
            ctx.shadowBlur = 5;
            ctx.fillText(`RAW: ${avgIntensity.toFixed(0)}  DIFF: ${diff.toFixed(1)}  THR: ${threshold}`, 15, 30);
            ctx.shadowBlur = 0;

            if (previousIntensity !== -1) {
                // Visual Meter (Bottom)
                const meterW = Math.min((diff / 40) * canvas.width, canvas.width);
                ctx.fillStyle = diff > threshold ? "#ef4444" : "#22c55e";
                ctx.fillRect(0, canvas.height - 15, meterW, 15);

                if (diff > threshold && (now - lastTriggerTime > 3000)) {
                    const queueCount = (currentSession.activeQueue || []).length;
                    const onCourseCount = (currentSession.onCourse || []).length;

                    // SMART GATE: Only act if someone is actually expected
                    if (roleType === 'video') {
                        if (onCourseCount > 0 && !hasRecordedForCurrentRunner) {
                            console.log("!!! CV TRIGGER DETECTED !!! (VIDEO)", diff.toFixed(1));
                            lastTriggerTime = now;
                            hasRecordedForCurrentRunner = true; 
                            showVideoNotification("TALLENNETAAN... 📹");
                            setTimeout(() => saveVideoClip(), 5000);
                            ctx.fillStyle = "rgba(16, 185, 129, 0.6)"; 
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                    } else {
                        // Regular timing node trigger (LÄHTÖ/MAALI/VÄLIAIKA)
                        let shouldTrigger = false;
                        if (roleType === 'lähtö' && queueCount > 0) shouldTrigger = true;
                        if (roleType === 'maali' && onCourseCount > 0) shouldTrigger = true;
                        if (roleType === 'väliaika' && onCourseCount > 0) shouldTrigger = true;

                        if (shouldTrigger) {
                            console.log("!!! CV TRIGGER DETECTED !!!", triggerType, diff.toFixed(1));
                            lastTriggerTime = now;
                            simulateTrigger(triggerType);

                            // AUTO-VIDEO for timing node
                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                showVideoNotification("TALLENNETAAN... 📹");
                                setTimeout(() => saveVideoClip(), 5000);
                            }

                            ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        } else {
                            console.log("Movement ignored: No runner expected for " + roleType);
                        }
                    }
                }
            }

            // Only update history if we have actual signal (not black)
            if (avgIntensity > 0 || previousIntensity === -1) {
                previousIntensity = avgIntensity;
            }
        }
        requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
}

// --- UI Updates ---

function addManualAthletePrompt() {
    if (!currentSession) return;
    const name = prompt("Laskijan nimi:");
    if (name && name.trim()) {
        socket.emit('add_athlete', {
            sessionId: currentSession.id,
            name: name.trim()
        });
    }
}

function markRunnerDNF(runnerId) {
    if (!currentSession) return;
    socket.emit('mark_dnf', { sessionId: currentSession.id, runnerId });
}

function confirmResult(runnerId) {
    socket.emit('confirm_result', { sessionId: currentSession.id, runnerId });
}

function rejectResult(runnerId) {
    socket.emit('reject_result', { sessionId: currentSession.id, runnerId });
}

function manualFinish(runnerId) {
    if (confirm("Lopetetaanko ajanotto manuaalisesti?")) {
        socket.emit('manual_finish', { sessionId: currentSession.id, runnerId });
    }
}

function updateUI() {
    if (!currentSession) return;
    
    // Update S3 Status Badges
    const coachS3 = document.getElementById('s3-status-badge');
    if (coachS3) {
        coachS3.innerText = s3Active ? "S3: PILVITALLENNUS AKTIIVINEN ✅" : "S3: PAIKALLINEN TALLENNUS (VÄLIAIKAINEN) ⚠️";
        coachS3.style.color = s3Active ? "var(--success)" : "var(--warning)";
        coachS3.style.borderColor = s3Active ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)";
    }
    const videoS3 = document.getElementById('video-s3-status');
    if (videoS3) {
        videoS3.innerText = s3Active ? "S3: OK" : "S3: EI LAINDETTU";
        videoS3.style.color = s3Active ? "var(--success)" : "var(--warning)";
    }

    if (currentRole === 'VALMENTAJA' || currentRole === 'KATSOMO') renderValmentajaView();
    if (currentRole === 'LÄHETTÄJÄ') renderStarterView();
    if (currentRole === 'URHEILIJA') renderAthleteView();
    if (currentRole === 'VIDEO') renderVideoView();
}

function renderVideoView() {
    const infoEl = document.getElementById('video-node-info');
    if (!infoEl || !currentSession || !currentSession.devices) return;

    // 1. Find Start Location
    let startLoc = null;
    for (let id in currentSession.devices) {
        if (currentSession.devices[id].role === 'LÄHTÖ' && currentSession.devices[id].location) {
            startLoc = currentSession.devices[id].location;
            break;
        }
    }

    // 2. Find My Location
    let myLoc = null;
    const myDevice = currentSession.devices[socket.id];
    if (myDevice && myDevice.location) myLoc = myDevice.location;

    // 3. Calculate Distance & Speed
    if (startLoc && myLoc) {
        const dist = getDistanceBetween(startLoc.lat, startLoc.lon, myLoc.lat, myLoc.lon);
        const distText = `Sijainti: ${dist.toFixed(0)}m lähdöstä`;

        let statusText = "VALMIINA";
        let countdownText = "";

        if (activeRunnerOnCourse) {
            statusText = `RADALLA: ${activeRunnerOnCourse.name.toUpperCase()}`;

            // 1. PRIMARY: Predictive ETA (Math)
            const elapsed = (getSyncedTime() - activeRunnerOnCourse.startTime) / 1000;
            const avgSpeed = 18; // m/s
            const etaTotal = dist / avgSpeed;
            const remaining = etaTotal - elapsed;

            if (remaining > 0) {
                countdownText = `Ennuste: Ohitus n. ${remaining.toFixed(1)}s päästä`;
            } else if (remaining > -5) {
                countdownText = "LASKIJA KOHDALLA";
            } else {
                countdownText = "OHITETTU";
            }

            // 2. SECONDARY: GPS Verification (Optional)
            const runnerDevice = currentSession.devices[activeRunnerOnCourse.id];
            if (runnerDevice && runnerDevice.location) {
                const runnerDist = getDistanceBetween(startLoc.lat, startLoc.lon, runnerDevice.location.lat, runnerDevice.location.lon);
                const myDistToRunner = getDistanceBetween(myLoc.lat, myLoc.lon, runnerDevice.location.lat, runnerDevice.location.lon);

                countdownText += `<br><span style="font-size: 10px; color: var(--success); opacity: 0.8;">🛰️ GPS VARMISTETTU: ${myDistToRunner.toFixed(0)}m etäisyys</span>`;
            }
        }

        if (hasRecordedForCurrentRunner) {
            statusText = "TALLENNUS VALMIS ✅";
            countdownText = "Odotetaan seuraavaa...";
        }

        infoEl.innerHTML = `
            <div style="font-size: 22px; color: var(--accent); font-weight: 900; margin-bottom: 5px;">${statusText}</div>
            <div style="font-size: 16px; color: #fff; font-weight: 700; margin-bottom: 10px;">${countdownText}</div>
            <div style="font-size: 10px; opacity: 0.6; font-weight: 700; text-transform: uppercase;">
                ${distText} | ROOLI: ${currentRole}
            </div>
        `;
    } else {
        const msg = !startLoc ? "ODOTTAA LÄHTÖÄ (GPS)" : "HAKEE OMAA GPS...";
        infoEl.innerHTML = `<div style="padding: 20px; opacity: 0.5;">${msg}<br><span style="font-size:10px;">Varmista että GPS on päällä</span></div>`;
    }
}

function renderValmentajaView() {
    const activeEl = document.getElementById('active-skier');
    const resultEl = document.getElementById('result-list');
    const coachListEl = document.getElementById('coach-athlete-list');
    const coachCtrlEl = document.getElementById('coach-controls');
    if (!activeEl || !resultEl) return;

    // Toggle management controls based on role
    const isCoach = currentRole === 'VALMENTAJA';
    if (coachCtrlEl) coachCtrlEl.style.display = isCoach ? 'block' : 'none';

    const endBtnContainer = document.getElementById('coach-only-end');
    if (endBtnContainer) endBtnContainer.style.display = isCoach ? 'block' : 'none';

    // 0. Master Athlete List - CHUNKY BUTTONS (Only re-render if count change)
    const athletes = currentSession.allAthletes || [];
    if (coachListEl && (athletes.length !== lastAthletesCount)) {
        coachListEl.innerHTML = athletes.length ? athletes.map(a => `
            <button class="btn btn-outline" style="padding: 15px; margin-bottom: 8px; font-size: 20px; text-align: center; display: block; width: 100%; border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.02);" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `).join('') : '<p style="font-size:14px; opacity:0.5; text-align:center;">Ei nimiä listalla.</p>';
        coachListEl.style.maxHeight = "300px";
        lastAthletesCount = athletes.length;
    }

    const onCourse = currentSession.onCourse || [];
    const now = getSyncedTime();

    // Optimization: Check for runners or timer updates
    if (onCourse.length > 0) {
        // We always update the time, but only re-generate HTML if set changes
        activeEl.innerHTML = onCourse.map(r => {
            const runningTime = now - r.startTime;
            const isGhost = r.id.toString().includes('GHOST');
            return `
                <div style="background: rgba(255, 255, 255, 0.05); border-left: 8px solid ${isGhost ? 'var(--danger)' : 'var(--accent)'}; padding: 25px; border-radius: 20px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0; font-size: 34px; line-height: 1;">${r.name.toUpperCase()}</h3>
                            <p style="color: ${isGhost ? 'var(--danger)' : 'var(--accent)'}; font-weight: 900; margin: 8px 0; font-size: 18px; letter-spacing: 1px;">
                                ${r.splits.length > 0 ? `VÄLIAIKA: ${formatDuration(r.splits[0].duration)}` : (isGhost ? '⚠️ HAAMU-ALKU' : 'LASKEE...')}
                            </p>
                        </div>
                        <div style="text-align: right;">
                            <h2 style="margin: 0; font-family: monospace; font-size: 54px; color: var(--text-primary); font-weight: 800; line-height: 1;">${formatDuration(runningTime)}</h2>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:15px;">
                        ${isCoach ? `<button class="btn btn-danger" style="padding: 15px; margin: 0; font-size: 16px;" onclick="markRunnerDNF('${r.id}')">KESKEYTYS (DNF)</button>` : ''}
                        ${isCoach ? `<button class="btn btn-outline" style="padding: 15px; margin: 0; font-size: 16px; border-color: var(--warning); color: var(--warning);" onclick="manualFinish('${r.id}')">MANUAALI STOP</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } else if (lastOnCourseCount !== 0) {
        activeEl.innerHTML = `<div style="text-align: center; padding: 40px; border: 2px dashed rgba(255,255,255,0.05); border-radius: 20px;">
            <h2 style="opacity: 0.3; font-size: 32px; margin: 0;">RATA VAPAA</h2>
        </div>`;
    }
    lastOnCourseCount = onCourse.length;

    // 2. Pending suspicious results
    const pending = currentSession.pendingResults || [];
    const pendingHtml = pending.length > 0 ? `
        <div style="margin-bottom:20px; border:1px solid var(--danger); border-radius:12px; padding:10px; background:rgba(239, 68, 68, 0.05);">
            <p style="color:var(--danger); font-size:10px; font-weight:900; margin:0 0 8px 0;">⚠️ TARKISTA TULOKSET (IKKUNAN ULKOPUOLELLA)</p>
            ${pending.map(r => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px; margin-bottom:5px;">
                    <div>
                        <span style="font-weight:700;">${r.name}</span>
                        <span style="color:var(--danger); margin-left:10px; font-weight:900;">${formatDuration(r.totalTime)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${r.videoUrl ? `
                        <button class="btn-mini" onclick="window.open('${r.videoUrl}')" style="background: var(--accent); padding:2px 8px;">VIDEO 🎬</button>` : ''}
                        <button class="btn-mini" style="background:var(--success); padding:2px 8px;" onclick="confirmResult('${r.id}')">HYVÄKSY</button>
                        <button class="btn-mini" style="background:var(--danger); padding:2px 8px;" onclick="rejectResult('${r.id}')">HYLKÄÄ</button>
                    </div>
                </div>
            `).join('')}
        </div>
    ` : '';

    // 3. Expected Time / Target Info
    const expectedTxt = currentSession.expectedDuration ?
        `<p style="font-size:10px; opacity:0.6; margin-bottom:10px;">Oletusaika: ${formatDuration(currentSession.expectedDuration)} (±30-50%)</p>` : '';

    // 4. Show recent results
    const results = currentSession.results || [];
    const bestTime = results.length > 0 ? Math.min(...results.map(rs => rs.totalTime)) : 0;
    const pendingCount = pending.length;

    if (results.length > 0 || pending.length > 0) {
        // Optimization: only re-render results if count changes (or pending changes)
        if (results.length !== lastResultsCount || pendingCount !== 0) {
            resultEl.innerHTML = pendingHtml + expectedTxt + results.map((r, i) => {
                const delta = r.totalTime - bestTime;
                const isBest = r.totalTime === bestTime;
                return `
                    <div class="card" style="margin-bottom: 12px; padding: 20px 25px; display: flex; justify-content: space-between; align-items: center; background: ${isBest ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.02)'}; border-color: ${isBest ? 'var(--success)' : 'transparent'}">
                        <div>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <span style="opacity:0.3; font-weight:900; font-size: 20px;">#${results.length - i}</span>
                                <span style="font-weight: 800; font-size: 24px;">${r.name.toUpperCase()}</span>
                            </div>
                            <div style="font-size: 14px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; margin-top: 4px;">
                                ${r.splits.length ? `VÄLI: ${formatDuration(r.splits[0].duration)}` : 'EI VÄLIAIKAA'}
                                ${r.manual ? ' | <span style="color:var(--warning)">KÄSIKELLO</span>' : ''}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            ${r.videoUrl ? `
                            <button class="btn-mini" onclick="window.open('${r.videoUrl}')" style="background: var(--accent); margin-right: 5px;">
                                KATSO 🎬
                            </button>` : ''}
                            <button class="btn-mini" onclick="shareRun('${r.runId}')" style="background: rgba(255,255,255,0.1); margin-right: 10px;">
                                JAA 🔗
                            </button>
                            <div style="font-size: 32px; font-weight: 900; color: ${isBest ? 'var(--success)' : 'var(--text-primary)'}; font-family: monospace;">${formatDuration(r.totalTime)}</div>
                            <div style="font-size: 16px; font-weight: 800; color: ${delta === 0 ? 'var(--success)' : 'var(--danger)'};">
                                ${delta === 0 ? 'KÄRKI' : `+${formatDuration(delta)}`}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            lastResultsCount = results.length;
        }
    } else {
        resultEl.innerHTML = `<div style="text-align:center; opacity:0.2; padding:40px; border: 1px solid rgba(255,255,255,0.05); border-radius: 20px;">Ei tuloksia</div>`;
        lastResultsCount = 0;
    }
    // 5. Device Status List
    const deviceEl = document.getElementById('device-status-list');
    if (deviceEl) {
        const devices = Object.values(currentSession.devices || {});
        // Show ALL devices in the status list for Valmentaja, but sort track nodes first
        const trackNodes = ['LÄHTÖ', 'MAALI', 'LÄHETTÄJÄ', 'VÄLIAIKA', 'VIDEO'];
        devices.sort((a, b) => {
            const aIsTrack = trackNodes.includes(a.role);
            const bIsTrack = trackNodes.includes(b.role);
            if (aIsTrack && !bIsTrack) return -1;
            if (!aIsTrack && bIsTrack) return 1;
            return 0;
        });

        deviceEl.innerHTML = devices.map(d => {
            const isOnline = (Date.now() - d.lastHeartbeat) < 15000;
            let icon = '📱';
            let roleName = d.role;
            if (d.role === 'LÄHTÖ') { icon = '⏲️'; roleName = 'STARTTIKELLO'; }
            if (d.role === 'MAALI') { icon = '🏁'; roleName = 'MAALIKELLO'; }
            if (d.role === 'LÄHETTÄJÄ') { icon = '📋'; roleName = 'LÄHTÖPAIKKA'; }
            if (d.role === 'VÄLIAIKA') { icon = '⏱️'; roleName = 'VÄLIAIKA'; }
            if (d.role === 'VIDEO') { icon = '📹'; roleName = 'VIDEO'; }
            if (d.role === 'URHEILIJA') { icon = '⛷️'; roleName = 'LASKIJA'; }
            if (d.role === 'VALMENTAJA') { icon = '📋'; roleName = 'VALMENTAJA'; }
            if (d.role === 'KATSOMO') { icon = '👁️'; roleName = 'KATSOMO'; }

            const loc = d.location;
            const gpsInfo = loc ? `
                <div style="font-size: 8px; opacity: 0.5; margin-top: 2px; font-family: monospace;">
                    GPS: ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (+/-${Math.round(loc.accuracy)}m)
                </div>
            ` : `
                <div style="font-size: 8px; color: var(--danger); opacity: 0.5; margin-top: 2px;">EI GPS DATA-A</div>
            `;

            return `
                <div style="background: ${trackNodes.includes(d.role) ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isOnline ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; padding: 10px; border-radius: 10px; display: flex; align-items: center; gap: 10px; overflow: hidden; opacity: ${isOnline ? 1 : 0.5}">
                    <div style="font-size: 20px;">${icon}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 11px; font-weight: 900; color: ${trackNodes.includes(d.role) ? 'var(--accent)' : 'var(--text-secondary)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${roleName}: ${d.name.toUpperCase()}
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <div style="width: 6px; height: 6px; border-radius: 50%; background: ${isOnline ? 'var(--success)' : 'var(--danger)'};"></div>
                            <span style="font-size: 9px; opacity: 0.6; font-weight: 700;">${isOnline ? 'LINJOILLA' : 'EI YHTEYTTÄ'}</span>
                        </div>
                        ${gpsInfo}
                    </div>
                </div>
            `;
        }).join('');
    }
}

function renderAthleteView() {
    const listEl = document.getElementById('athlete-results-list');
    if (!listEl) return;

    // Filter results for this specific user
    const myResults = (currentSession.results || []).filter(r => r.name === userName);

    // Show Current Queue
    const queue = currentSession.activeQueue || [];
    const queueHtml = queue.length > 0 ? `
        <div style="margin-bottom: 30px; background: rgba(59, 130, 246, 0.1); padding: 20px; border-radius: 20px; border: 1px solid rgba(59, 130, 246, 0.2);">
            <p style="font-size:12px; font-weight:900; color:var(--accent); margin:0 0 10px 0;">LÄHTÖJÄRJESTYS</p>
            ${queue.map((a, i) => `
                <div style="font-size: 24px; font-weight: 800; margin-bottom: 5px; opacity: ${i === 0 ? 1 : 0.5};">
                    ${i + 1}. ${a.name.toUpperCase()} ${i === 0 ? ' ← SEURAAVANA' : ''}
                </div>
            `).join('')}
        </div>
    ` : '';

    if (myResults.length > 0 || queue.length > 0) {
        listEl.innerHTML = queueHtml + `
            <p style="font-size:12px; font-weight:900; opacity:0.5; margin-bottom:10px;">OMAT TULOKSESI</p>
            ${myResults.map(r => `
                <div class="card" style="margin-bottom: 20px; border-color: var(--accent); padding: 25px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size: 38px; font-weight: 900; color: var(--text-primary); font-family: monospace;">${formatDuration(r.totalTime)}</span>
                        <div style="text-align:right;">
                           <div style="font-size: 14px; color: var(--text-secondary); font-weight:700;">${r.splits.length ? `VÄLI: ${formatDuration(r.splits[0].duration)}` : ''}</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        `;
    } else {
        listEl.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 40px; font-size: 20px; opacity: 0.3;">Ei vielä suorituksia.</p>`;
    }
}

function renderStarterView() {
    const listEl = document.getElementById('starter-skier-list');
    const queueEl = document.getElementById('starter-queue-view');
    const athletes = currentSession.allAthletes || [];
    const queue = currentSession.activeQueue || [];

    // 1. Top Section: SEURAAVA LÄHTIJÄ (Giant) - Only re-render if next person or count changes
    const nextId = queue.length > 0 ? queue[0].id : null;
    if (queueEl && (queue.length !== lastQueueCount || (queue.length > 0 && nextId !== lastNextId))) {
        if (queue.length > 0) {
            const next = queue[0];
            queueEl.innerHTML = `
                <div style="background: var(--accent); padding: 40px 20px; border-radius: 24px; text-align: center; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(59, 130, 246, 0.4);">
                    <p style="font-weight: 900; font-size: 14px; letter-spacing: 2px; opacity: 0.8; margin: 0 0 10px 0; text-transform: uppercase;">Seuraava lähtijä:</p>
                    <h1 style="font-size: 72px; margin: 0; line-height: 1; letter-spacing: -2px;">${next.name.toUpperCase()}</h1>
                    ${queue.length > 1 ? `<p style="margin-top: 20px; font-weight: 800; font-size: 20px; opacity: 0.6;">Sitten: ${queue[1].name.toUpperCase()}</p>` : ''}
                </div>
            `;
        } else {
            queueEl.innerHTML = `
                <div style="padding: 40px; border: 3px dashed rgba(255,255,255,0.1); border-radius: 24px; text-align: center; margin-bottom: 20px;">
                    <h2 style="opacity: 0.3; text-transform: uppercase;">Ketään ei ole jonossa</h2>
                </div>
            `;
        }
        lastNextId = nextId;
    }

    // 2. Bottom Section: All athletes as big selection buttons (2-column grid)
    if (listEl && (athletes.length !== lastAthletesCount || queue.length !== lastQueueCount)) {
        listEl.innerHTML = athletes.length ? athletes.map(a => {
            const isInQueue = queue.some(q => q.id === a.id);
            const isNext = queue.length > 0 && queue[0].id === a.id;

            return `
                <button class="btn-athlete ${isInQueue ? 'btn-primary' : 'btn-outline'}" 
                    style="${isNext ? 'border-color: #fff; box-shadow: inset 0 0 20px rgba(255,255,255,0.2);' : ''} ${isInQueue && !isNext ? 'opacity: 0.4;' : ''}" 
                    onclick="addToQueue('${a.id}')">
                    ${a.name.toUpperCase()}
                </button>
            `;
        }).join('') : '<p style="text-align:center; opacity:0.5; grid-column: 1 / span 2; padding: 20px;">Ei nimiä listalla.</p>';

        lastQueueCount = queue.length;
        lastAthletesCount = athletes.length;
    }
}

// Last Build: Mon Mar  2 17:50:01 EET 2026
