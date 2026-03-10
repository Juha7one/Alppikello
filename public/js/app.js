// --- Alppikello MAIN CONTROLLER ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Check for Splash Screen
    const splash = document.getElementById('deployment-splash');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => splash.style.visibility = 'hidden', 800);
        }, 2500);
    }

    // 2. Initialize UI
    if (userName) document.getElementById('input-profile-name').value = userName;
    showOnboardingStep('name');
});

// --- Session Management ---

async function createSession() {
    if (!userName) return showOnboardingStep('name');

    const btn = document.querySelector('#ob-step-session .btn-primary');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "LUODAAN...";
    }

    const days = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
    const now = new Date();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${days[now.getDay()]} ${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()} klo ${now.getHours()}:${minutes}`;
    let sessionName = `Treeni ${timeStr}`;

    let initialLocation = null;
    if ("geolocation" in navigator) {
        try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 }));
            initialLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await resp.json();
            const place = data.address.suburb || data.address.city || data.address.town;
            if (place) sessionName = `${place} ${timeStr}`;
        } catch (e) { }
    }
    socket.emit('create_session', { 
        name: sessionName, 
        creatorName: userName,
        location: initialLocation 
    });
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

function joinNearbySession(sid) {
    const input = document.getElementById('input-session-id');
    if (input) {
        input.value = sid;
        joinSession();
    }
}

function handleSessionJoin(session, role) {
    currentSession = session;
    currentRole = role;

    const input = document.getElementById('input-session-id');
    if (input) input.value = session.id;

    if (discoveryWatchId) {
        navigator.geolocation.clearWatch(discoveryWatchId);
        discoveryWatchId = null;
    }

    // View switching
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');

    let viewId = `view-${role.toLowerCase()}`;
    if (role === 'KATSOMO') viewId = 'view-valmentaja';
    if (role === 'LÄHTÖ') viewId = 'view-lahto';
    if (role === 'LÄHETTÄJÄ') viewId = 'view-lahettaja';
    if (role === 'VÄLIAIKA') viewId = 'view-valiaika';
    if (role === 'MAALI') viewId = 'view-maali';

    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.classList.add('active');

    // UI Feedback
    const roleBtn = document.getElementById('btn-change-role');
    if (roleBtn) roleBtn.style.display = "block";
    
    document.getElementById('current-user-name-display').innerText = userName || "Tuntematon";

    if (!uiUpdateTimer) uiUpdateTimer = setInterval(updateUI, 100);

    if (role === 'VALMENTAJA') {
        const sNameEl = document.getElementById('coach-session-name');
        if (sNameEl) sNameEl.innerText = session.name;
        const codeEl = document.getElementById('session-code');
        if (codeEl) codeEl.innerText = session.id;
        generateQR(session.id);
    }

    startGPSTracking();

    // AUTO-ACTIVATE CAMERA/CV based on role
    const roleForCV = {
        'LÄHTÖ': 'lähtö',
        'MAALI': 'maali',
        'VÄLIAIKA': 'väliaika',
        'VIDEO': 'video'
    }[role];
    
    if (roleForCV && typeof startCV === 'function') {
        console.log(`[AUTO-CV] Smarter activation for ${role}`);
        startCV(roleForCV);
    } else if (typeof stopCV === 'function') {
        // Only stop CV if we are not recording a run or a clip
        const isRecording = (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording' && pendingRunnerMetadata);
        if (!isRecording) stopCV();
    }

    updateUILayout();
    updateUI();
}

// --- Onboarding Helpers ---

function saveNameAndNext() {
    const val = document.getElementById('input-profile-name').value.trim();
    if (!val) return alert("Kirjoita nimesi ensin!");
    userName = val;
    localStorage.setItem('alppikello_user_name', userName);
    showOnboardingStep('role');
}

function showOnboardingStep(step) {
    document.querySelectorAll('.ob-step').forEach(el => el.style.display = 'none');
    const stepEl = document.getElementById('ob-step-' + step);
    if (stepEl) stepEl.style.display = 'block';

    if (step === 'session') {
        const isCoach = selectedRole === 'VALMENTAJA';
        const coachCreate = document.getElementById('coach-only-create');
        if (coachCreate) coachCreate.style.display = isCoach ? 'block' : 'none';
        
        const titleEl = document.getElementById('session-step-title');
        if (titleEl) titleEl.innerText = isCoach ? 'LUO HARJOITUS' : 'LIITY HARJOITUKSEEN';
        
        // RESET BUTTON from previous "LUODAAN..." state
        const createBtn = document.querySelector('#ob-step-session .btn-primary');
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerText = "LUO UUSI HARJOITUS";
        }

        // RESET Manual Join Toggle
        const manualToggle = document.getElementById('btn-toggle-manual');
        if (manualToggle) manualToggle.style.display = 'none';

        // Fetch fresh nearby sessions
        if (socket && socket.connected) socket.emit('get_nearby_sessions', { lat: userLocation?.lat, lon: userLocation?.lon });

        const contCont = document.getElementById('continue-session-container');
        if (contCont) {
            if (currentSession) {
                contCont.style.display = 'block';
                contCont.innerHTML = `
                    <button class="btn btn-outline" onclick="joinNearbySession('${currentSession.id}')" style="width:100%; border-color: var(--success); color: var(--success); margin-bottom: 25px; background: rgba(34, 197, 94, 0.05);">
                        JATKA NYKYISESSÄ:<br>
                        <span style="font-size: 18px; font-weight: 900;">${currentSession.name.toUpperCase()}</span>
                    </button>
                `;
            } else {
                contCont.style.display = 'none';
            }
        }
    }
}

function selectRole(role) {
    selectedRole = role;
    document.querySelectorAll('.role-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.role === role) card.classList.add('selected');
    });
    showOnboardingStep('session');
}

function saveName() {
    const val = document.getElementById('name-input').value.trim();
    if (!val) return alert("Anna nimi!");
    userName = val;
    localStorage.setItem('alppikello_user_name', userName);
    joinSession();
}

function showRoleSelection() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.add('active');
    showOnboardingStep('role');
    const roleBtn = document.getElementById('btn-change-role');
    if (roleBtn) roleBtn.style.display = "none";
}

// --- GPS Tracking ---

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
        }, null, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
    }
}

function startDiscoveryGPS() {
    if (!navigator.geolocation) return;
    discoveryWatchId = navigator.geolocation.watchPosition((pos) => {
        socket.emit('find_nearby_sessions', { lat: pos.coords.latitude, lon: pos.coords.longitude });
    }, null, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
}

// --- Time Sync ---

function startTimeSync() {
    for (let i = 0; i < 5; i++) setTimeout(() => socket.emit('sync_time', Date.now()), i * 500);
    setInterval(() => socket.emit('sync_time', Date.now()), 30000);
}

// --- Global Actions (Links) ---

function shareRun(runId) {
    if (!runId || runId === 'undefined') return alert("Tallenne ei ole vielä valmis.");
    // Use query parameter so static host doesn't 404/500
    const url = window.location.origin + window.location.pathname + '?run=' + runId;
    if (navigator.share) {
        navigator.share({ title: 'Alppikello - Tulokortti', url: url });
    } else {
        copyToClipboard(url);
    }
}

function shareSession() {
    if (!currentSession) return;
    const url = `${window.location.origin}${window.location.pathname}?s=${currentSession.id}`;
    if (navigator.share) {
        navigator.share({
            title: 'Alppikello - Liity Harjoitukseen',
            text: `Liity harjoitukseen: ${currentSession.name.toUpperCase()}`,
            url: url
        });
    } else {
        copyToClipboard(url);
    }
}

function checkDeepLink() {
    const params = new URLSearchParams(window.location.search);
    
    // 1. Session join
    const sid = params.get('s');
    if (sid) {
        document.getElementById('input-session-id').value = sid.toUpperCase();
        showOnboardingStep('name');
    }

    // 2. Individual Run Card view
    const runId = params.get('run');
    if (runId) {
        loadRunCard(runId);
    }
}

async function loadRunCard(runId) {
    // Show view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');
    document.getElementById('view-run-card').classList.add('active');
    
    const loading = document.getElementById('run-card-loading');
    const content = document.getElementById('run-card-content');
    
    try {
        // Fetch from Render backend
        const baseUrl = SERVER_URL || window.location.origin;
        const resp = await fetch(`${baseUrl}/api/run/${runId}`);
        if (!resp.ok) throw new Error("Suoritusta ei löytynyt");
        
        const data = await resp.json();
        
        // Populate UI
        document.getElementById('card-runner-name').innerText = data.name.toUpperCase();
        document.getElementById('card-session-badge').innerText = (data.sessionName || "Harkat").toUpperCase();
        
        const date = new Date(data.timestamp);
        document.getElementById('card-run-date').innerText = date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
        
        const duration = (data.totalTime / 1000).toFixed(2);
        document.getElementById('card-total-time').innerText = duration + 's';
        
        // Splits
        const splitsEl = document.getElementById('card-splits');
        if (data.splits && data.splits.length > 0) {
            splitsEl.innerHTML = data.splits.map((s, idx) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
                    <span style="opacity: 0.5; font-weight: 700;">VÄLIAIKA ${idx+1}</span>
                    <span style="font-weight: 900;">${(s.duration / 1000).toFixed(2)}s</span>
                </div>
            `).join('');
            splitsEl.style.display = 'block';
        } else {
            splitsEl.style.display = 'none';
        }

        // Video Handling
        const vCont = document.getElementById('card-video-container');
        const vEl = document.getElementById('card-video');
        const vPlaceholder = document.getElementById('card-video-placeholder');
        const vOverlay = document.getElementById('card-video-overlay');
        const vClock = document.getElementById('card-video-clock');
        const vName = document.getElementById('card-video-name');

        vCont.style.display = 'flex'; // ALWAYS show container

        let videos = (data.videos || []).sort((a, b) => (a.triggerTime || 0) - (b.triggerTime || 0));
        if (videos.length === 0 && data.videoUrl) {
            videos = [{ url: data.videoUrl, role: 'video', triggerTime: (data.startTime || data.timestamp) + (data.totalTime || 0) }];
        }
        
        const startTime = parseInt(data.startTime) || parseInt(data.timestamp) || Date.now();

        if (videos.length > 0) {
            let currentIdx = 0;
            const loadClip = (idx) => {
                currentIdx = idx;
                const vid = videos[idx];
                vEl.src = vid.url;
                vEl.setAttribute('data-trigger-time', vid.triggerTime || startTime);
                vEl.setAttribute('data-video-start-time', vid.videoStartTime || 0);
                vEl.setAttribute('data-start-time', startTime);
                vName.innerText = data.name.toUpperCase();
                
                // Update dots if container exists
                const dots = document.getElementById('card-playlist-dots');
                if (dots) {
                    dots.innerHTML = videos.map((_, i) => 
                        `<div style="width:20px; height:4px; background:${i === idx ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}; border-radius:2px; cursor:pointer;" onclick="window.cardPlayerLoad(${i})"></div>`
                    ).join('');
                }

                vEl.play().catch(() => {});
            };

            window.cardPlayerLoad = loadClip; // For dot clicks
            
            vEl.onended = () => {
                if (currentIdx < videos.length - 1) loadClip(currentIdx + 1);
            };

            vEl.ontimeupdate = () => {
                const sTime = parseInt(vEl.getAttribute('data-start-time'));
                const vAbsStart = parseInt(vEl.getAttribute('data-video-start-time'));
                const officialTotalMs = data.totalTime || 0;
                vOverlay.style.opacity = '1';

                let raceTimeSec = 0;
                if (sTime && vAbsStart && vAbsStart > 0) {
                    const nowMs = vAbsStart + (vEl.currentTime * 1000);
                    raceTimeSec = Math.max(0, (nowMs - sTime) / 1000);
                } else {
                    const tTime = parseInt(vEl.getAttribute('data-trigger-time'));
                    const clipRelRace = (tTime - sTime) - 2000;
                    const raceTimeMs = clipRelRace + (vEl.currentTime * 1000);
                    raceTimeSec = Math.max(0, raceTimeMs / 1000);
                }

                if (officialTotalMs > 0) {
                    raceTimeSec = Math.min(raceTimeSec, officialTotalMs / 1000);
                }
                vClock.innerText = raceTimeSec.toFixed(2);
            };

            vEl.onplay = () => { vOverlay.style.opacity = '1'; };
            vEl.onpause = () => { vOverlay.style.opacity = '0.5'; };
            
            vEl.style.display = 'block';
            vPlaceholder.style.display = 'none';
            loadClip(0);
        } else {
            vEl.style.display = 'none';
            vPlaceholder.style.display = 'flex';
        }

        loading.style.display = 'none';
        content.style.display = 'block';

    } catch (e) {
        loading.innerHTML = `<div style="color:var(--danger); font-weight:900;">VIRHE: ${e.message}</div>
        <button class="btn btn-mini" onclick="location.href='/'" style="margin-top:20px;">TAKAISIN</button>`;
    }
}

async function loadArchives() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');
    document.getElementById('view-archive').classList.add('active');

    const listEl = document.getElementById('archive-list');
    listEl.innerHTML = '<p style="opacity:0.4; text-align:center; padding:40px;">Ladataan arkistoa...</p>';

    try {
        const baseUrl = SERVER_URL || window.location.origin;
        const resp = await fetch(`${baseUrl}/api/archives`);
        const archives = await resp.json();

        if (archives.length === 0) {
            listEl.innerHTML = '<p style="opacity:0.4; text-align:center; padding:40px;">Ei vielä arkistoituja harjoituksia.</p>';
            return;
        }

        listEl.innerHTML = archives.map(a => `
            <div class="card" onclick="openArchive('${a.filename}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:900; font-size:18px;">${a.name.toUpperCase()}</div>
                    <div style="font-size:11px; opacity:0.5; font-weight:700;">${new Date(a.date).toLocaleDateString()} • ${a.athleteCount} SUORITUSTA</div>
                </div>
                <div style="color:var(--accent); font-weight:900;">KATSO →</div>
            </div>
        `).join('');
    } catch (e) {
        listEl.innerHTML = '<p style="color:var(--danger); text-align:center;">Virhe ladattaessa arkistoa.</p>';
    }
}

async function openArchive(filename) {
    const listEl = document.getElementById('archive-list');
    const resultsEl = document.getElementById('archive-results');
    const resultsList = document.getElementById('archive-results-list');
    const titleEl = document.getElementById('archive-session-title');

    try {
        const baseUrl = SERVER_URL || window.location.origin;
        const resp = await fetch(`${baseUrl}/api/archives/${filename}`);
        const session = await resp.json();

        titleEl.innerText = session.name.toUpperCase();
        listEl.style.display = 'none';
        resultsEl.style.display = 'block';

        if (session.results.length === 0) {
            resultsList.innerHTML = '<p style="opacity:0.4; text-align:center;">Ei tuloksia tässä harjoituksessa.</p>';
            return;
        }

        resultsList.innerHTML = session.results.map((r, i) => {
            const splitList = (r.splits || []).map((s, idx) => 
                `<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
                    <span style="color: var(--accent); font-weight: 800;">⏱️ V${idx + 1}:</span> 
                    <span style="font-weight: 700;">${formatDuration(s.duration)} s</span> 
                </div>`
            ).join('');

            const videoHtml = `
                <div class="video-container" id="arc-video-placeholder-${r.runId}" style="width: 100%; aspect-ratio: 16/9; background: #000; margin: 12px 0; border-radius: 12px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1);">
                    ${r.videoUrl ? `
                        <video id="arc-video-${r.runId}" src="${r.videoUrl}" controls style="width: 100%; height: 100%; object-fit: contain;"></video>
                        <div id="arc-clock-${r.runId}" style="position: absolute; bottom: 50px; left: 15px; pointer-events: none; background: rgba(0,0,0,0.6); padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px); transition: opacity 0.3s; opacity: 0;">
                            <div style="font-size: 8px; font-weight: 900; color: var(--accent); letter-spacing: 1px; line-height: 1;">${r.name.toUpperCase()}</div>
                            <div class="clock-val" style="font-size: 20px; font-weight: 900; font-family: monospace; line-height: 1.2;">0.00</div>
                        </div>
                    ` : `
                        <div style="text-align: center; opacity: 0.5;">
                            <div style="font-size: 24px; margin-bottom: 8px;">🎬</div>
                            <div style="font-size: 11px; font-weight: 900; letter-spacing: 1px;">VIDEOA EI LÖYDY</div>
                            <div style="font-size: 9px; margin-top: 4px; opacity: 0.6;">(ID: ${r.runId})</div>
                        </div>
                    `}
                </div>
            `;

            return `
                <div class="card" style="margin-bottom:15px; border-left: 4px solid #fff;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                        <div>
                            <span style="opacity:0.3; font-size: 11px;">#${session.results.length - i}</span>
                            <div style="font-weight: 900; font-size: 22px; margin: 4px 0;">${r.name.toUpperCase()}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size: 28px; font-weight: 900; color: var(--accent);">${formatDuration(r.totalTime)}</div>
                        </div>
                    </div>
                    ${videoHtml}
                    <div style="margin-top: 10px;">${splitList}</div>
                    <button class="btn-mini" onclick="shareRun('${r.runId}')" style="margin-top: 15px; width: 100%; background: rgba(255,255,255,0.05);">JAA TULOSKORTTI 🔗</button>
                </div>
            `;
        }).join('');

        // Attach clock logic to archive videos
        session.results.forEach(r => {
            const vEl = document.getElementById(`arc-video-${r.runId}`);
            const vClock = document.getElementById(`arc-clock-${r.runId}`);
            if (vEl && vClock) {
                const clockVal = vClock.querySelector('.clock-val');
                vEl.ontimeupdate = () => {
                    vClock.style.opacity = '1';
                    const displayMs = Math.min(vEl.currentTime * 1000, r.totalTime);
                    if (clockVal) clockVal.innerText = (displayMs / 1000).toFixed(2);
                };
                vEl.onpause = () => vClock.style.opacity = '0.5';
                vEl.onplay = () => vClock.style.opacity = '1';
            }
        });

    } catch (e) {
        alert("Virhe avattaessa arkistoa.");
    }
}

function generateQR(sid) {
    const url = `${window.location.origin}${window.location.pathname}?s=${sid}`;
    
    // Large Modal QR (Fixed and simplified)
    const canvasLarge = document.getElementById('session-qr-large');
    if (canvasLarge && typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvasLarge, url, { 
            width: 300, 
            margin: 2, 
            color: { dark: '#000000', light: '#ffffff' } 
        }, function (error) {
            if (error) console.error('[QR] Error generating QR:', error);
            else console.log('[QR] Generated for session:', sid);
        });
    }
}

function showQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.style.display = 'flex';
        if (currentSession) generateQR(currentSession.id);
    }
}

function hideQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'none';
}

window.showQRModal = showQRModal;
window.hideQRModal = hideQRModal;
