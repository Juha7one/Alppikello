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

    // Start Live Clock for ALL active roles to ensure queue/timing updates
    if (!uiUpdateTimer) {
        uiUpdateTimer = setInterval(updateUI, 100);
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

// --- Computer Vision (Digital Photocell) ---

async function initTriggerCV(roleType) {
    const isStart = roleType === 'lähtö';
    const isFinish = roleType === 'maali';
    const isSplit = roleType === 'väliaika';

    const videoId = isStart ? 'start-video' : (isFinish ? 'maali-video' : 'väliaika-video');
    const canvasId = isStart ? 'start-overlay' : (isFinish ? 'maali-overlay' : 'väliaika-overlay');
    const statusId = isStart ? 'start-status-overlay' : (isFinish ? 'maali-status-overlay' : 'väliaika-status-overlay');
    const btnId = isStart ? 'btn-start-cv' : (isFinish ? 'btn-maali-cv' : 'btn-väliaika-cv');

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
            btn.innerText = "AKTIVOI KENNO";
            btn.classList.remove('btn-danger');
            btn.classList.add(isStart ? 'btn-primary' : (isFinish ? 'btn-success' : 'btn-warning'));
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
            btn.innerText = "SULJE KENNO";
            btn.classList.remove('btn-primary', 'btn-success', 'btn-warning');
            btn.classList.add('btn-danger');
        }

        startCVLogic(roleType, video, canvas);
    } catch (err) {
        console.error("Kameravirhe:", err);
        alert("Kameran avaaminen epäonnistui. Varmista luvat.");
    }
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
                    console.log("!!! CV TRIGGER DETECTED !!!", triggerType, diff.toFixed(1));
                    lastTriggerTime = now;
                    simulateTrigger(triggerType);

                    // Big visual flash
                    ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
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

    // 0. Master Athlete List - CHUNKY BUTTONS
    if (coachListEl) {
        const athletes = currentSession.allAthletes || [];
        coachListEl.innerHTML = athletes.length ? athletes.map(a => `
            <button class="btn btn-outline" style="padding: 15px; margin-bottom: 8px; font-size: 20px; text-align: center; display: block; width: 100%; border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.02);" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `).join('') : '<p style="font-size:14px; opacity:0.5; text-align:center;">Ei nimiä listalla.</p>';
        coachListEl.style.maxHeight = "300px";
    }

    // 1. Show who is currently on course (FIFO-style)
    const onCourse = currentSession.onCourse || [];
    const now = getSyncedTime();

    if (onCourse.length > 0) {
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
    } else {
        activeEl.innerHTML = `<div style="text-align: center; padding: 40px; border: 2px dashed rgba(255,255,255,0.05); border-radius: 20px;">
            <h2 style="opacity: 0.3; font-size: 32px; margin: 0;">RATA VAPAA</h2>
        </div>`;
    }

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
                    <div>
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

    if (results.length > 0 || pending.length > 0) {
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
                        <div style="font-size: 32px; font-weight: 900; color: ${isBest ? 'var(--success)' : 'var(--text-primary)'}; font-family: monospace;">${formatDuration(r.totalTime)}</div>
                        <div style="font-size: 16px; font-weight: 800; color: ${delta === 0 ? 'var(--success)' : 'var(--danger)'};">
                            ${delta === 0 ? 'KÄRKI' : `+${formatDuration(delta)}`}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        resultEl.innerHTML = `<div style="text-align:center; opacity:0.2; padding:40px; border: 1px solid rgba(255,255,255,0.05); border-radius: 20px;">Ei tuloksia</div>`;
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

    // 1. Top Section: SEURAAVA LÄHTIJÄ (Giant)
    if (queue.length > 0) {
        const next = queue[0];
        queueEl.innerHTML = `
            <div style="background: var(--accent); padding: 30px; border-radius: 24px; text-align: center; margin-bottom: 30px; box-shadow: 0 10px 40px rgba(59, 130, 246, 0.4);">
                <p style="font-weight: 900; font-size: 14px; letter-spacing: 2px; opacity: 0.8; margin: 0 0 10px 0;">SEURAAVANA LÄHDÖSSÄ</p>
                <h1 style="font-size: 64px; margin: 0; line-height: 1;">${next.name.toUpperCase()}</h1>
                ${queue.length > 1 ? `<p style="margin-top: 15px; font-weight: 700; opacity: 0.6;">Sitten: ${queue[1].name.toUpperCase()}</p>` : ''}
            </div>
        `;
    } else {
        queueEl.innerHTML = `
            <div style="padding: 40px; border: 3px dashed rgba(255,255,255,0.1); border-radius: 24px; text-align: center; margin-bottom: 30px;">
                <h2 style="opacity: 0.3;">KETÄÄN EI OLE JONOSSA</h2>
            </div>
        `;
    }

    // 2. Bottom Section: All athletes as big selection buttons
    // Filter out people already in queue top position to avoid confusion? 
    // No, show everyone so the starter can re-select if needed.
    listEl.innerHTML = athletes.length ? athletes.map(a => {
        const isInQueue = queue.some(q => q.id === a.id);
        return `
            <button class="btn ${isInQueue ? 'btn-primary' : 'btn-outline'}" 
                style="padding: 25px; margin-bottom: 12px; font-size: 32px; font-weight: 900; border-width: 3px; ${isInQueue ? 'opacity: 0.5;' : ''}" 
                onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
                ${isInQueue ? ' (JONOSSA)' : ''}
            </button>
        `;
    }).join('') : '<p style="text-align:center; opacity:0.5;">Ei nimiä listalla.</p>';
}

// Last Build: Mon Mar  2 17:50:01 EET 2026
