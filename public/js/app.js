const socket = io();

// --- Globals & State ---
let currentSession = null;
let currentRole = null;
let serverTimeOffset = 0;
let rtt = 0;
let selectedRole = null;
let userName = localStorage.getItem('alppikello_user_name') || "";

// UI Elements
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const syncOffsetEl = document.getElementById('sync-offset');
const roleBtn = document.getElementById('btn-change-role');

// Timers
let uiUpdateTimer = null;
let cvInterval = null;
let lastTriggerTime = 0;
let cvStream = null;

// --- Initialization & Socket Events ---

socket.on('connect', () => {
    connDot.classList.add('connected');
    connText.innerText = 'Yhdistetty';
    startTimeSync();
    checkDeepLink();
});

socket.on('disconnect', () => {
    connDot.classList.remove('connected');
    connText.innerText = 'Yhteys katkesi';
});

socket.on('session_created', (session) => {
    handleSessionJoin(session, 'VALMENTAJA');
});

socket.on('session_joined', (data) => {
    if (data.success) {
        handleSessionJoin(data.session, data.role);
    } else {
        alert('Liittyminen epäonnistui: ' + data.error);
        showOnboardingStep('initial');
    }
});

socket.on('device_status_update', (data) => {
    currentSession = data.session;
    updateUI();
});

socket.on('timing_update', (data) => {
    // data contains: type (START/SPLIT/FINISH), runner, session
    currentSession = data.session;
    updateUI();

    // Optional: Add a toast or flash for the event
    console.log(`TIMING [${data.type}]: ${data.runner.name}`);
});

// --- Onboarding & Deep Linking ---

function checkDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('s');
    if (sid) {
        document.getElementById('session-input').value = sid.toUpperCase();
        document.getElementById('session-join-title').innerText = `Liitytään: ${sid.toUpperCase()}`;

        socket.emit('get_session_names', sid.toUpperCase());
        showOnboardingStep('role');
    }
}

function enterSessionManually() {
    const sid = document.getElementById('session-input').value.trim().toUpperCase();
    if (!sid) return alert("Anna Session ID!");
    document.getElementById('session-join-title').innerText = `Liitytään: ${sid}`;

    socket.emit('get_session_names', sid);
    showOnboardingStep('role');
}

function saveName() {
    const name = document.getElementById('name-input').value.trim();
    if (!name) return alert("Anna nimesi!");
    userName = name;
    localStorage.setItem('alppikello_user_name', name);

    // If we're creating a new session
    if (selectedRole === 'VALMENTAJA' && !currentSession) {
        createSession();
    } else {
        joinSession();
    }
}

function showOnboardingStep(step) {
    document.getElementById('setup-initial').style.display = (step === 'initial' ? 'block' : 'none');
    document.getElementById('setup-name').style.display = (step === 'name' ? 'block' : 'none');
    document.getElementById('setup-role').style.display = (step === 'role' ? 'block' : 'none');

    if (step === 'name') {
        document.getElementById('name-input').value = userName;
        const sid = document.getElementById('session-input').value.trim().toUpperCase();
        if (sid) socket.emit('get_session_names', sid);
    }
}

socket.on('session_names_list', (data) => {
    const listEl = document.getElementById('valitse-nimi-lista');
    if (!listEl) return;

    if (data.athletes && data.athletes.length > 0) {
        listEl.innerHTML = data.athletes.map(a => `
            <button class="btn btn-outline btn-mini" style="text-align:left; justify-content:flex-start; font-size:16px;" onclick="selectExistingName('${a.name}')">
                👤 ${a.name}
            </button>
        `).join('');
        listEl.style.display = 'flex';
    } else {
        listEl.style.display = 'none';
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

    // If we already have a name and a session (role switching), join immediately
    if (userName && currentSession) {
        joinSession();
    } else {
        // First time joining: Go to Name/Identity step
        showOnboardingStep('name');
    }
}

async function createSession() {
    const sidInput = document.getElementById('session-input');
    // If we don't have a name yet, go to name step first
    if (!userName) {
        selectedRole = 'VALMENTAJA';
        showOnboardingStep('name');
        return;
    }

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
    let sid = document.getElementById('session-input').value.trim().toUpperCase();

    // If empty but we're switching roles, use currentSession id
    if (!sid && currentSession) sid = currentSession.id;

    if (!sid || !selectedRole) return alert('Valitse rooli!');

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
    const input = document.getElementById('session-input');
    if (input) input.value = session.id;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');

    let viewId = `view-${role.toLowerCase()}`;
    // Map Katsomo to use the same view as Valmentaja
    if (role === 'KATSOMO') viewId = 'view-valmentaja';

    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.classList.add('active');
    else console.warn("View not found for role:", role, viewId);

    // Show change role button
    roleBtn.style.display = "block";

    // Start Live Clock if needed (Coach/Katsomo)
    if (role === 'VALMENTAJA' || role === 'KATSOMO') {
        if (!uiUpdateTimer) uiUpdateTimer = setInterval(updateUI, 50);
    } else {
        clearInterval(uiUpdateTimer);
        uiUpdateTimer = null;
    }

    if (role === 'VALMENTAJA') {
        document.getElementById('session-name').innerText = session.name;
        document.getElementById('session-code').innerText = session.id;
        generateQR(session.id);
    } else if (role === 'URHEILIJA') {
        document.getElementById('athlete-welcome').innerText = `TERVE, ${userName.toUpperCase()}!`;
        renderAthleteView();
    }

    updateUI();
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
    socket.emit(`trigger_${type}`, { sessionId: currentSession.id, timestamp });

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

// --- Simulator ---

function runTestSimulation() {
    if (!currentSession) return alert("Luo ensin harjoitus!");

    const mockName = "SIMU-" + Math.floor(Math.random() * 100);
    console.log("Starting full simulation for:", mockName);

    // 1. Add Athlete
    socket.emit('add_athlete', { sessionId: currentSession.id, name: mockName });

    // Delay slightly to let the server process
    setTimeout(() => {
        // 2. Find their ID and move to queue
        const athlete = currentSession.allAthletes.find(a => a.name === mockName);
        if (athlete) {
            socket.emit('move_to_queue', { sessionId: currentSession.id, athleteId: athlete.id });

            // 3. Trigger Start after 1.5s
            setTimeout(() => {
                console.log("SIMU: Triggering Start...");
                simulateTrigger('start');

                // 4. Trigger Split after 5s
                setTimeout(() => {
                    console.log("SIMU: Triggering Split...");
                    simulateTrigger('split');

                    // 5. Trigger Finish after 10s
                    setTimeout(() => {
                        console.log("SIMU: Triggering Finish...");
                        simulateTrigger('finish');
                    }, 5000);
                }, 5000);
            }, 1500);
        }
    }, 500);
}

// --- Computer Vision (Digital Photocell) ---

async function initTriggerCV(roleType) {
    const videoId = roleType === 'lähtö' ? 'start-video' : (roleType === 'maali' ? 'maali-video' : 'väliaika-video');
    const canvasId = roleType === 'lähtö' ? 'start-overlay' : (roleType === 'maali' ? 'maali-overlay' : 'väliaika-overlay');
    const statusId = roleType === 'lähtö' ? 'start-status-overlay' : (roleType === 'maali' ? 'maali-status-overlay' : 'väliaika-status-overlay');

    const video = document.getElementById(videoId);
    const canvas = document.getElementById(canvasId);
    const status = document.getElementById(statusId);

    if (!video || !canvas) return;

    if (cvStream) {
        cvStream.getTracks().forEach(track => track.stop());
        cvStream = null;
        status.innerText = "CV POIS PÄÄLTÄ";
        status.style.background = "rgba(0,0,0,0.6)";
        return;
    }

    try {
        cvStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: 640, height: 480 },
            audio: false
        });
        video.srcObject = cvStream;
        status.innerText = "CV AKTIIVINEN";
        status.style.background = "var(--success)";

        startCVLogic(roleType, video, canvas);
    } catch (err) {
        console.error("Kameravirhe:", err);
        alert("Kameran avaaminen epäonnistui. Varmista luvat.");
    }
}

function startCVLogic(roleType, video, canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Normalize role to 'start', 'finish' or 'split'
    let triggerType = 'split';
    if (roleType === 'lähtö') triggerType = 'start';
    if (roleType === 'maali') triggerType = 'finish';

    console.log("CV LOGIC STARTING FOR:", roleType, "->", triggerType);

    let previousIntensity = -1;
    const threshold = 12; // slightly more sensitive
    const gateX = 0.5; // middle of the screen

    const processFrame = () => {
        if (!cvStream) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const x = canvas.width * gateX;

            // 1. Draw Gate UI
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

            // 2. Sample the Gate (Vertical strip)
            const imageData = ctx.getImageData(x - 2, 0, 4, canvas.height);
            const data = imageData.data;
            let totalB = 0;
            for (let i = 0; i < data.length; i += 4) {
                totalB += (data[i] + data[i + 1] + data[i + 2]) / 3;
            }
            const avgIntensity = totalB / (data.length / 4);

            // 3. Detect Change
            if (previousIntensity !== -1) {
                const diff = Math.abs(avgIntensity - previousIntensity);

                // Visual Meter (Bottom)
                const meterW = (diff / 50) * canvas.width;
                ctx.fillStyle = diff > threshold ? "#ef4444" : "#22c55e";
                ctx.fillRect(0, canvas.height - 10, meterW, 10);

                const now = Date.now();
                if (diff > threshold && (now - lastTriggerTime > 3000)) {
                    console.log("!!! CV TRIGGER DETECTED !!!", triggerType, diff.toFixed(1));
                    lastTriggerTime = now;
                    simulateTrigger(triggerType);

                    // Big visual flash
                    ctx.fillStyle = "rgba(239, 68, 68, 0.4)";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }
            previousIntensity = avgIntensity;
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

function updateUI() {
    if (!currentSession) return;
    if (currentRole === 'VALMENTAJA' || currentRole === 'KATSOMO') renderValmentajaView();
    if (currentRole === 'LÄHETTÄJÄ') renderStarterView();
    if (currentRole === 'URHEILIJA') renderAthleteView();
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

    // 0. Master Athlete List for Coach
    if (coachListEl) {
        const athletes = currentSession.allAthletes || [];
        coachListEl.innerHTML = athletes.length ? athletes.map(a => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px; margin-bottom:6px;">
                <span style="font-size:14px;">${a.name}</span>
                <button class="btn btn-primary btn-mini" style="font-size:10px; padding:4px 8px;" onclick="addToQueue('${a.id}')">LÄHETÄ</button>
            </div>
        `).join('') : '<p style="font-size:12px; opacity:0.5; text-align:center;">Ei laskijoita listalla.</p>';
    }

    // 1. Show who is currently on course (FIFO-style)
    const onCourse = currentSession.onCourse || [];
    const now = getSyncedTime();

    if (onCourse.length > 0) {
        activeEl.innerHTML = onCourse.map(r => {
            const runningTime = now - r.startTime;
            return `
                <div style="background: rgba(255, 255, 255, 0.05); border-left: 4px solid var(--accent); padding: 15px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 24px;">${r.name.toUpperCase()}</h3>
                        <p style="color: var(--accent); font-weight: 700; margin: 4px 0;">
                            ${r.splits.length > 0 ? `V: ${formatDuration(r.splits[0].duration)}` : 'LASKEE...'}
                        </p>
                    </div>
                    <div style="text-align: right;">
                        <h2 style="margin: 0; font-family: monospace; font-size: 32px; color: var(--text-primary);">${formatDuration(runningTime)}</h2>
                        ${isCoach ? `<button class="btn-mini" style="background: var(--danger); opacity: 0.6; margin-top: 5px; padding: 4px 8px;" onclick="markRunnerDNF('${r.id}')">DNF</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        activeEl.innerHTML = `<h3 style="opacity: 0.5;">Ei ketään rinteessä</h3>`;
    }

    // 2. Show recent results
    const results = currentSession.results || [];
    const leaderTime = results.length > 0 ? results[results.length - 1].totalTime : 0; // Simple leader: last on list (usually bottom of history but top of session)
    // Actually, results are unshifted, so index 0 is latest. Let's find best time.
    const bestTime = results.length > 0 ? Math.min(...results.map(rs => rs.totalTime)) : 0;

    if (results.length > 0) {
        resultEl.innerHTML = results.map(r => {
            const delta = r.totalTime - bestTime;
            const isBest = r.totalTime === bestTime;
            return `
                <div class="card" style="margin-bottom: 8px; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; background: ${isBest ? 'rgba(34, 197, 94, 0.05)' : 'var(--card-bg)'}; border-color: ${isBest ? 'var(--success)' : 'rgba(255,255,255,0.05)'}">
                    <div>
                        <span style="font-weight: 700; font-size: 18px;">${r.name}</span>
                        <div style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase;">
                            ${r.splits.length ? `SPLIT: ${formatDuration(r.splits[0].duration)}` : 'EI VÄLIAIKAA'}
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 24px; font-weight: 800; color: ${isBest ? 'var(--success)' : 'var(--text-primary)'};">${formatDuration(r.totalTime)}</div>
                        ${!isBest ? `<div style="font-size: 12px; color: var(--danger);">+${(delta / 1000).toFixed(2)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        resultEl.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Odotetaan suorituksia...</p>`;
    }
}

function renderAthleteView() {
    const listEl = document.getElementById('athlete-results-list');
    if (!listEl) return;

    // Filter results for this specific user
    const myResults = (currentSession.results || []).filter(r => r.name === userName);

    if (myResults.length > 0) {
        listEl.innerHTML = myResults.map(r => `
            <div class="card" style="margin-bottom: 10px; border-color: var(--accent);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size: 14px; color: var(--text-secondary);">AIKA</span>
                    <span style="font-size: 32px; font-weight: 800; color: var(--text-primary);">${formatDuration(r.totalTime)}</span>
                </div>
                ${r.splits.length ? `<p style="font-size: 12px; margin-top: 8px;">Väliaika: ${formatDuration(r.splits[0].duration)}</p>` : ''}
            </div>
        `).join('');
    } else {
        listEl.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">Ei vielä suorituksia.</p>`;
    }
}

function renderStarterView() {
    const listEl = document.getElementById('starter-skier-list');
    const queueEl = document.getElementById('starter-queue-view');
    const athletes = currentSession.allAthletes || [];
    const queue = currentSession.activeQueue || [];

    listEl.innerHTML = athletes.length ? athletes.map(a => `
        <div class="card" style="margin-bottom:10px; padding:15px; display:flex; justify-content:space-between; align-items:center;">
            <span>${a.name}</span>
            <button class="btn btn-primary btn-mini" onclick="addToQueue('${a.id}')">LISÄÄ LÄHTÖÖN</button>
        </div>
    `).join('') : '<p>Ei laskijoita.</p>';

    queueEl.innerHTML = queue.length ? queue.map((a, i) => `
        <div class="queue-item">#${i + 1} <b>${a.name}</b></div>
    `).join('') : '<p>Jono tyhjä.</p>';
}
