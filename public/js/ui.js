// --- Alppikello UI Components & Rendering ---

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
        videoS3.innerText = s3Active ? "S3: PILVITALLENNUS ✅" : "S3: EI KÄYTÖSSÄ ⚠️";
        videoS3.style.color = s3Active ? "var(--success)" : "var(--warning)";
    }

    // Update Role Badge (Coach/Katsomo)
    const coachBadge = document.getElementById('coach-role-badge');
    if (coachBadge) {
        if (currentRole === 'KATSOMO') {
            coachBadge.innerText = 'KATSOMO / LIVE';
            coachBadge.style.background = 'var(--success)';
        } else if (currentRole === 'VALMENTAJA') {
            coachBadge.innerText = 'VALMENTAJA';
            coachBadge.style.background = 'var(--accent)';
        }
    }

    // Update session name headers across all views
    ['start', 'finish', 'lahettaja', 'lahto', 'split', 'coach', 'athlete'].forEach(id => {
        const el = document.getElementById(`${id}-session-name`);
        if (el) el.innerText = currentSession.name;
    });

    if (currentRole === 'VALMENTAJA' || currentRole === 'KATSOMO') renderValmentajaView();
    if (currentRole === 'LÄHETTÄJÄ') renderStarterView();
    if (currentRole === 'URHEILIJA') renderAthleteView();
    if (currentRole === 'VIDEO') renderVideoView();
}

function renderValmentajaView() {
    const activeEl = document.getElementById('active-skier');
    const resultEl = document.getElementById('result-list');
    const coachListEl = document.getElementById('coach-athlete-list');
    const coachCtrlEl = document.getElementById('coach-controls');
    if (!activeEl || !resultEl) return;

    const isCoach = currentRole === 'VALMENTAJA';
    if (coachCtrlEl) coachCtrlEl.style.display = isCoach ? 'block' : 'none';

    const endBtnContainer = document.getElementById('coach-only-end');
    if (endBtnContainer) endBtnContainer.style.display = isCoach ? 'block' : 'none';

    // 1. Athlete List
    const athletes = currentSession.allAthletes || [];
    if (coachListEl && (athletes.length !== lastAthletesCount)) {
        coachListEl.innerHTML = athletes.length ? athletes.map(a => `
            <button class="btn btn-outline" style="padding: 15px; margin-bottom: 8px; font-size: 20px; text-align: center; display: block; width: 100%;" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `).join('') : '<p>Ei nimiä listalla.</p>';
        lastAthletesCount = athletes.length;
    }

    // 2. Active Runners
    const onCourse = currentSession.onCourse || [];
    const now = getSyncedTime();
    if (onCourse.length > 0) {
        activeEl.innerHTML = onCourse.map(r => {
            const runningTime = now - r.startTime;
            return `
                <div class="card" style="border-left: 8px solid var(--accent); padding: 25px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0; font-size: 34px;">${r.name.toUpperCase()}</h3>
                            <p style="color: var(--accent); font-weight: 900; margin: 8px 0; font-size: 18px;">LASKEE...</p>
                        </div>
                        <div style="text-align: right;">
                            <h2 style="margin: 0; font-family: monospace; font-size: 54px; font-weight: 800;">${formatDuration(runningTime)}</h2>
                        </div>
                    </div>
                    ${isCoach ? `<div style="display:flex; gap:10px; margin-top:15px;">
                        <button class="btn btn-danger" onclick="markRunnerDNF('${r.id}')">DNF</button>
                        <button class="btn btn-outline" style="color: var(--warning);" onclick="manualFinish('${r.id}')">MANUAALI</button>
                    </div>` : ''}
                </div>
            `;
        }).join('');
    } else {
        activeEl.innerHTML = `<div style="text-align: center; padding: 40px; opacity:0.3;">RATA VAPAA</div>`;
    }

    // 3. Results
    const results = currentSession.results || [];
    const pending = currentSession.pendingResults || [];
    if (results.length > 0 || pending.length > 0) {
        resultEl.innerHTML = results.map((r, i) => `
            <div class="card" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span style="opacity:0.3;">#${results.length - i}</span>
                    <span style="font-weight: 800; margin-left: 10px;">${r.name.toUpperCase()}</span>
                </div>
                <div style="text-align:right;">
                    <div style="font-size: 24px; font-weight: 900;">${formatDuration(r.totalTime)}</div>
                    ${r.videoUrl ? `<button class="btn-mini" onclick="window.open('${r.videoUrl}')">VIDEO 🎬</button>` : ''}
                </div>
            </div>
        `).join('');
    }
}

function renderStarterView() {
    const queueEl = document.getElementById('starter-queue-view');
    const listEl = document.getElementById('starter-skier-list');
    if (!queueEl || !listEl) return;

    const queue = currentSession.activeQueue || [];
    const athletes = currentSession.allAthletes || [];

    if (queue.length > 0) {
        const next = queue[0];
        queueEl.innerHTML = `
            <div style="background: var(--accent); padding: 40px; border-radius: 24px; text-align: center;">
                <p style="font-weight:900; opacity:0.8; margin:0 0 10px 0;">SEURAAVA LÄHTIJÄ:</p>
                <h1 style="font-size: 72px; margin:0;">${next.name.toUpperCase()}</h1>
            </div>
        `;
    } else {
        queueEl.innerHTML = `<div style="padding: 40px; text-align:center; opacity:0.3;">JONO TYHJÄ</div>`;
    }

    listEl.innerHTML = athletes.map(a => {
        const isInQueue = queue.some(q => q.id === a.id);
        const style = isInQueue ? 'background: var(--accent); border-color: var(--accent);' : '';
        return `
            <button class="btn btn-outline" style="padding:15px; width:100%; margin-bottom:10px; ${style}" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `;
    }).join('');
}

function renderAthleteView() {
    const listEl = document.getElementById('athlete-results-list');
    if (!listEl) return;

    const results = currentSession.results || [];
    const myResults = results.filter(r => r.name === userName);

    listEl.innerHTML = myResults.length ? myResults.map(r => `
        <div class="card" style="margin-bottom:10px; display:flex; justify-content:space-between;">
            <span style="font-weight:800;">LASKU</span>
            <span style="font-size:24px; font-weight:900;">${formatDuration(r.totalTime)}</span>
        </div>
    `).join('') : '<p style="text-align:center; opacity:0.3;">Ei omia laskuja vielä.</p>';
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
        const distText = `SIJAINTI: ${dist.toFixed(0)}m LÄHDÖSTÄ`;

        let statusText = "VALMIINA";
        let countdownText = "";

        if (activeRunnerOnCourse) {
            statusText = `RADALLA: ${activeRunnerOnCourse.name.toUpperCase()}`;
            const elapsed = (getSyncedTime() - activeRunnerOnCourse.startTime) / 1000;
            const remaining = (dist / 18) - elapsed; // 18m/s avg

            if (remaining > 0) countdownText = `ENNUSTE: ${remaining.toFixed(1)}s`;
            else if (remaining > -5) countdownText = "LASKIJA KOHDALLA";
            else countdownText = "OHITETTU";
        }

        if (hasRecordedForCurrentRunner) {
            statusText = "TALLENNETTU ✅";
            countdownText = "Odotetaan seuraavaa...";
        }

        infoEl.innerHTML = `
            <div style="font-size: 22px; color: var(--accent); font-weight: 900;">${statusText}</div>
            <div style="font-size: 16px; color: #fff; font-weight: 700;">${countdownText}</div>
            <div style="font-size: 10px; opacity: 0.6; margin-top:5px;">${distText}</div>
        `;
    } else {
        infoEl.innerHTML = `<div style="opacity:0.5; font-size:12px;">ODOTTAA GPS-YHTEYTTÄ...</div>`;
    }
}
