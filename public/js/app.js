// --- Alppikello MAIN CONTROLLER (Stateless ToD & Multi-Camera Edition) ---
let allArchives = []; // Global store for searching list

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
    if (userName && document.getElementById('input-profile-name')) {
        document.getElementById('input-profile-name').value = userName;
    }
});

// --- Session Management ---

async function createSession() {
    if (!userName) return showOnboardingStep('name');

    const btn = document.getElementById('btn-create-session') || document.querySelector('#coach-only-create .btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${iconHtml('hourglass_top', 'icon-md')} LUODAAN...`;
    }

    let placeStr = "TREENI";
    let initialLocation = null;
    if ("geolocation" in navigator) {
        try {
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, enableHighAccuracy: true }));
            initialLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await resp.json();
            const place = data.address.suburb || data.address.city || data.address.town || data.address.municipality || data.address.county;
            if (place) placeStr = place.replace(/[^äöåÄÖÅa-zA-Z]/g, '').substring(0, 5).toUpperCase();
        } catch (e) {
            console.warn("[LOC] Could not resolve place name:", e);
        }
    }

    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).substring(2)}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    const generatedId = `${placeStr}-${dateStr}-${timeStr}`;

    socket.emit('create_session', { 
        id: generatedId,
        name: generatedId,
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

function toggleManualJoin() {
    const manualCont = document.getElementById('manual-join-container');
    const btn = document.getElementById('btn-toggle-manual');
    if (manualCont) {
        const isHidden = manualCont.style.display === 'none';
        manualCont.style.display = isHidden ? 'block' : 'none';
        if (btn) btn.innerText = isHidden ? "PIILOTA KOODI" : "SYÖTÄ KOODI MANUAALISESTI";
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
    } else if (role === 'LÄHETTÄJÄ') {
        if (typeof handleStarterRoleEntry === 'function') {
            handleStarterRoleEntry(session);
        }
    } else if (typeof stopCV === 'function') {
        const isRecording = (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording' && pendingRunnerMetadata);
        if (!isRecording) stopCV();
    }

    if (typeof applyRolePowerAndVoicePolicy === 'function') {
        applyRolePowerAndVoicePolicy(role);
    }
    if (typeof handleVoiceSessionUpdate === 'function') {
        handleVoiceSessionUpdate(null, session);
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

    if (step !== 'role' && typeof stopVoiceListening === 'function' && voiceListenMode === 'role') {
        stopVoiceListening();
    }

    if (step === 'session') {
        const isCoach = selectedRole === 'VALMENTAJA';
        const coachCreate = document.getElementById('coach-only-create');
        if (coachCreate) coachCreate.style.display = isCoach ? 'block' : 'none';
        
        const titleEl = document.getElementById('session-step-title');
        if (titleEl) titleEl.innerText = isCoach ? 'LUO HARJOITUS' : 'LIITY HARJOITUKSEEN';
        
        const createBtn = document.getElementById('btn-create-session') || document.querySelector('#coach-only-create .btn');
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = `${iconHtml('add_circle', 'icon-md')} LUO UUSI HARJOITUS`;
        }

        const manualToggle = document.getElementById('btn-toggle-manual');
        if (manualToggle) manualToggle.style.display = 'none';

        const manualCont = document.getElementById('manual-join-container');
        const contCont = document.getElementById('continue-session-container');
        const toggle = document.getElementById('btn-toggle-manual');
        
        socket.emit('get_nearby_sessions', { lat: userLocation?.lat, lon: userLocation?.lon });

        let hasEasyJoin = false;

        if (currentSession) {
            hasEasyJoin = true;
            if (contCont) {
                contCont.style.display = 'block';
                contCont.innerHTML = `
                    <button class="btn btn-success" onclick="joinNearbySession('${currentSession.id}')" style="width:100%; margin-bottom: 25px; height: 85px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3); border: none;">
                        JATKA HARJOITUKSESSA:<br>
                        <span style="font-size: 20px; font-weight: 900;">${currentSession.name.toUpperCase()}</span>
                    </button>
                `;
            }
        } else if (contCont) {
            contCont.style.display = 'none';
        }

        if (hasEasyJoin) {
            if (manualCont) manualCont.style.display = 'none';
            if (toggle) toggle.style.display = 'block';
        } else {
            if (manualCont) manualCont.style.display = 'block';
            if (toggle) toggle.style.display = 'none';
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
    if (typeof wakeSensorScreen === 'function') wakeSensorScreen(false);
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.add('active');
    showOnboardingStep('role');
    const roleBtn = document.getElementById('btn-change-role');
    if (roleBtn) roleBtn.style.display = "none";
}

// --- GPS Tracking ---

function startGPSTracking() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    gpsFixCount = 0;
    gpsLockedForSession = false;
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            if (typeof handleGpsPositionForBattery === 'function') {
                handleGpsPositionForBattery(pos);
            } else if (currentSession) {
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
        userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        socket.emit('find_nearby_sessions', { lat: pos.coords.latitude, lon: pos.coords.longitude });
    }, null, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
}

// --- One-Shot Time Sync ---

function startTimeSync() {
    if (typeof calibrateClockOnce === 'function') {
        calibrateClockOnce();
    }
}

// --- Global Actions (Links) ---

let isSharing = false;
async function shareRun(runId, archiveFilename = null) {
    if (isSharing) return;
    if (!runId || runId === 'undefined') return alert("Tallenne ei ole vielä valmis.");
    
    let url = window.location.origin + window.location.pathname;
    if (archiveFilename) {
        url += `?archive=${archiveFilename.replace(/\.json$/i, '')}&run=${runId}`;
    } else {
        url += `?run=${runId}`;
    }
    
    if (navigator.share) {
        isSharing = true;
        try {
            await navigator.share({ title: 'Alppikello - Tulokortti', url: url });
        } catch (e) {
            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                console.warn("[SHARE] Navigation share failed:", e);
            }
        } finally {
            isSharing = false;
        }
    } else {
        copyToClipboard(url);
    }
}

async function shareSession() {
    if (isSharing || !currentSession) return;
    const url = `${window.location.origin}${window.location.pathname}?s=${currentSession.id}`;
    if (navigator.share) {
        isSharing = true;
        try {
            await navigator.share({
                title: `Alppikello - Liity: ${currentSession.name.toUpperCase()}`,
                url: url
            });
        } catch (e) {
            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                console.warn("[SHARE] Navigation share failed:", e);
            }
        } finally {
            isSharing = false;
        }
    } else {
        copyToClipboard(url);
    }
}

async function shareArchive(filename) {
    if (isSharing) return;
    
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}?archive=${filename.replace(/\.json$/i, '')}`;
    
    if (navigator.share) {
        isSharing = true;
        try {
            await navigator.share({
                title: 'Alppikello - Harjoituksen Tulokset',
                url: url
            });
        } catch (e) {
            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
                console.warn("[SHARE] Archive share failed:", e);
            }
        } finally {
            isSharing = false;
        }
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
        return true; 
    }

    const archFile = params.get('archive');
    const runId = params.get('run');

    if (archFile && runId) {
        const cleanFile = archFile.trim();
        loadRunCard(runId, cleanFile + '.json');
        return true;
    }

    // 2. Individual Run Card view
    if (runId) {
        loadRunCard(runId);
        return true;
    }

    // 3. Whole Archive view
    if (archFile) {
        const cleanFile = archFile.trim();
        openArchive(cleanFile + '.json');
        return true;
    }

    return false;
}

async function loadRunCard(runId, archiveFilename = null) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');
    document.getElementById('view-run-card').classList.add('active');
    
    const loading = document.getElementById('run-card-loading');
    const content = document.getElementById('run-card-content');
    loading.style.display = 'flex';
    content.style.display = 'none';
    
    try {
        let data;
        if (archiveFilename) {
            const resp = await fetch(`${API_URL}?action=get_archive&filename=${encodeURIComponent(archiveFilename)}`);
            if (!resp.ok) throw new Error("Arkistoa ei löytynyt");
            const session = await resp.json();
            const foundRun = (session.results || []).find(r => r.runId === runId);
            if (!foundRun) throw new Error("Suoritusta ei löytynyt arkistosta");
            
            const userRuns = session.results.filter(r => r.name === foundRun.name);
            const finalRunNumber = userRuns.findIndex(r => r.runId === runId) + 1;
            
            data = {
                id: foundRun.runId,
                runId: foundRun.runId,
                name: foundRun.name,
                runNumber: finalRunNumber,
                startTime: foundRun.startTime || session.timestamp || Date.now(),
                finishTime: foundRun.finishTime,
                totalTime: foundRun.totalTime,
                videoUrl: foundRun.videoUrl || null,
                videos: foundRun.videos || [],
                splits: foundRun.splits || [],
                sessionName: session.name || "Arkistoitu Harkka",
                timestamp: session.archivedAt || Date.now(),
                status: foundRun.status,
                sessionResults: session.results.map(r => ({
                    name: r.name,
                    totalTime: r.totalTime,
                    startTime: r.startTime || session.timestamp || 0,
                    finishTime: r.finishTime || null,
                    status: r.status,
                    runId: r.runId,
                    splits: r.splits || [],
                    videos: r.videos || [],
                    videoUrl: r.videoUrl || null
                }))
            };
        } else {
            const resp = await fetch(`${API_URL}?action=get_run&runId=${encodeURIComponent(runId)}`);
            if (!resp.ok) throw new Error("Suoritusta ei löytynyt aktiivisista harjoituksista tai arkistosta.");
            data = await resp.json();
        }
        
        const sessionResults = data.sessionResults || [];
        const validResults = [...sessionResults]
            .filter(r => r.totalTime > 0 && r.status !== 'DNF')
            .sort((a,b) => a.totalTime - b.totalTime);
        const bestTime = validResults.length > 0 ? validResults[0].totalTime : 0;
        const isDNF = data.status === 'DNF';
        const rank = isDNF ? null : (validResults.findIndex(vr => vr.runId === data.id) + 1 || null);
        
        const myRuns = sessionResults.filter(r => r.name === data.name && r.totalTime > 0);
        const personalBestTime = myRuns.length > 0 ? Math.min(...myRuns.map(r => r.totalTime)) : (data.totalTime || 0);
        const isPersonalBest = (data.totalTime > 0 && data.totalTime <= personalBestTime);

        let label = "Laskuaika:";
        let gapHtml = "";
        let timeVal = isDNF ? 'DNF' : formatDuration(data.totalTime);

        if (!isDNF) {
            if (rank === 1) {
                label = "Paras aika:";
                if (validResults.length > 1) {
                    const lead = validResults[1].totalTime - validResults[0].totalTime;
                    gapHtml = `<span style="color: var(--success); font-size: 16px; font-weight: 700; margin-left: 8px;">–${formatDuration(lead)}</span>`;
                }
            } else if (rank === 2) {
                label = "2. paras aika:";
                const gap = data.totalTime - bestTime;
                gapHtml = `<span style="color: var(--accent); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else if (rank === 3) {
                label = "3. paras aika:";
                const gap = data.totalTime - bestTime;
                gapHtml = `<span style="color: var(--accent); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else if (isPersonalBest) {
                label = "Paras oma aika:";
                const gap = data.totalTime - bestTime;
                gapHtml = `<span style="color: var(--accent); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else {
                const gap = data.totalTime - bestTime;
                gapHtml = `<span style="font-size: 16px; opacity: 0.5; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            }
        }

        document.getElementById('card-runner-name').innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                <div style="font-size: 24px; font-weight: 900; letter-spacing: -0.5px;">${data.name.toUpperCase()}, #${data.runNumber || '?'}</div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; font-weight: 800; opacity: 0.5; letter-spacing: 0.5px; text-transform: uppercase;">${label}</div>
                    <div style="font-size: 24px; font-weight: 900;">${timeVal}${gapHtml}</div>
                </div>
            </div>`;
        document.getElementById('card-session-badge').innerText = (data.sessionName || "Harkat").toUpperCase();
        
        const date = new Date(data.timestamp);
        document.getElementById('card-run-date').innerText = date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
        
        const standardTimeBox = document.getElementById('card-total-time-box');
        if (standardTimeBox) standardTimeBox.style.display = 'none';
        
        // Multi-Camera Synchronized Video Handling in Run Card
        const vCont = document.getElementById('card-video-container');
        const vEl = document.getElementById('card-video');
        const vPlaceholder = document.getElementById('card-video-placeholder');
        const vOverlay = document.getElementById('card-video-overlay');
        const vClock = document.getElementById('card-video-clock');
        const vName = document.getElementById('card-video-name');
        const vBadge = document.getElementById('card-role-badge');
        const multiControls = document.getElementById('card-multicam-controls');
        const dualCont = document.getElementById('card-dual-container');

        vCont.style.display = 'flex';
        if (multiControls) multiControls.style.display = 'none';
        if (dualCont) dualCont.style.display = 'none';

        const videos = normalizeRunVideos(data);
        const startTime = parseInt(data.startTime) || parseInt(data.timestamp) || Date.now();
        const totalTimeMs = parseInt(data.totalTime) || 25000;

        // Build Micro-Sector Telemetry, Fastest/Slowest Highlights & Initialize Ghost Comparison
        const splitsEl = document.getElementById('card-splits');
        const telemetryModel = typeof window.buildRunTelemetry === 'function'
            ? window.buildRunTelemetry(data, videos)
            : null;
        if (telemetryModel && typeof window.renderRunTelemetryUI === 'function') {
            window.renderRunTelemetryUI(splitsEl, telemetryModel);
        } else if (splitsEl) {
            splitsEl.style.display = 'none';
        }
        if (typeof window.initGhostComparisonUI === 'function') {
            window.initGhostComparisonUI(data, videos, telemetryModel);
        }

        if (videos.length > 0) {
            let currentIdx = 0;

            const updateCardCamButtons = (raceSec) => {
                videos.forEach((v, idx) => {
                    const btn = document.getElementById(`card-cam-btn-${idx}`);
                    const dot = document.getElementById(`card-cam-dot-${idx}`);
                    if (!btn || !dot) return;
                    const covers = (raceSec >= v.relStartSec - 0.2) && (raceSec <= v.relEndSec + 0.2);
                    if (idx === currentIdx) {
                        btn.style.background = 'var(--accent)';
                        btn.style.borderColor = '#fff';
                        dot.style.background = '#fff';
                    } else if (covers) {
                        btn.style.background = 'rgba(16, 185, 129, 0.2)';
                        btn.style.borderColor = '#10b981';
                        dot.style.background = '#10b981';
                    } else {
                        btn.style.background = 'rgba(255,255,255,0.06)';
                        btn.style.borderColor = 'rgba(255,255,255,0.15)';
                        dot.style.background = 'rgba(255,255,255,0.25)';
                    }
                });
            };

            const loadClip = (idx, preserveRaceTime = false, explicitRaceSec = null) => {
                const prevRaceSec = explicitRaceSec !== null
                    ? explicitRaceSec
                    : (preserveRaceTime ? getVideoRaceTimeSec(vEl) : 0);
                const wasPaused = vEl.paused;
                currentIdx = idx;
                const vid = videos[idx];

                vEl.src = vid.url;
                vEl.setAttribute('data-trigger-time', vid.triggerTime || startTime);
                vEl.setAttribute('data-video-start-time', vid.videoStartTime || 0);
                vEl.setAttribute('data-start-time', startTime);
                vEl.setAttribute('data-total-time', totalTimeMs);
                vName.innerText = data.name.toUpperCase();
                if (vBadge) vBadge.innerHTML = `${iconHtml('videocam', 'icon-sm')} ${vid.cameraLabel}`;

                const dots = document.getElementById('card-playlist-dots');
                if (dots) {
                    dots.innerHTML = videos.map((_, i) => 
                        `<button type="button" aria-label="Kamera ${i + 1}" style="width:24px; height:6px; border:none; padding:0; background:${i === idx ? 'var(--accent)' : 'rgba(255,255,255,0.25)'}; border-radius:3px; cursor:pointer;" onclick="window.cardPlayerLoad(${i}, true)"></button>`
                    ).join('');
                }

                updateCardCamButtons(prevRaceSec);
                if (typeof window.matchGhostClipToMainCamera === 'function') {
                    window.matchGhostClipToMainCamera();
                }

                const onLoaded = () => {
                    vEl.removeEventListener('loadedmetadata', onLoaded);
                    if ((preserveRaceTime || explicitRaceSec !== null) && startTime > 0 && vid.videoStartTime > 0) {
                        const targetSec = getClipTimeForRaceSec(vid, startTime, prevRaceSec);
                        if (targetSec > 0.05 && targetSec < (vEl.duration - 0.1)) {
                            vEl.currentTime = targetSec;
                        }
                    }
                    if (!wasPaused || !preserveRaceTime || explicitRaceSec !== null) {
                        vEl.play().catch(() => {});
                    }
                    if (typeof window.syncGhostToMainVideo === 'function') {
                        window.syncGhostToMainVideo();
                    }
                };
                vEl.addEventListener('loadedmetadata', onLoaded);
            };

            window.cardPlayerLoad = loadClip;

            // Render Multi-Camera Angle Switch Bar & Dual Split-Screen View if 2+ cameras filmed this run
            if (videos.length > 1 && multiControls && dualCont) {
                const first = videos[0];
                const second = videos[1] || first;
                const totalSec = (totalTimeMs / 1000).toFixed(2);

                multiControls.style.display = 'block';
                multiControls.innerHTML = `
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between;">
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; flex: 1;">
                            ${videos.map((v, idx) => `
                                <button type="button" id="card-cam-btn-${idx}" onclick="window.cardPlayerLoad(${idx}, true)"
                                    style="background: ${idx === 0 ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}; color: #fff; border: 1px solid rgba(255,255,255,0.22); min-height: 38px; padding: 7px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                    <span id="card-cam-dot-${idx}" style="width: 7px; height: 7px; border-radius: 50%; background: #fff; display: inline-block;"></span>
                                    ${iconHtml('videocam', 'icon-sm')} ${v.cameraLabel} <span style="opacity: 0.75; font-size: 9px;">(${v.relStartSec.toFixed(0)}–${v.relEndSec.toFixed(0)}s)</span>
                                </button>
                            `).join('')}
                        </div>
                        <button type="button" id="dual-btn-cardmain" onclick="toggleCardDualMode()"
                            style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.45); min-height: 38px; padding: 7px 12px; border-radius: 8px; font-size: 11px; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            ${iconHtml('grid_view', 'icon-sm')} 2 KAMERAA RINNAKKAIN
                        </button>
                    </div>
                `;

                const videoDataJson = JSON.stringify(videos).replace(/"/g, '&quot;');
                dualCont.innerHTML = `
                    <div id="player-cardmain" data-videos="${videoDataJson}" data-start-time="${startTime}" data-total-time="${totalTimeMs}" style="display:none;"></div>
                    <div style="background: #050505; border-radius: 12px; padding: 10px; border: 1px solid rgba(16, 185, 129, 0.3);">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px;">
                            <div style="position: relative; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                                <video id="dual-vid-a-cardmain" src="${first.url}" playsinline muted style="width: 100%; height: 100%; object-fit: contain;"></video>
                                <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.75); padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; color: var(--accent); display: inline-flex; align-items: center; gap: 4px;">${iconHtml('videocam', 'icon-sm')} ${first.cameraLabel}</div>
                                <div id="dual-wait-a-cardmain" style="position: absolute; inset: 0; background: rgba(0,0,0,0.75); display: none; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.7); text-align: center; padding: 10px;"></div>
                            </div>
                            <div style="position: relative; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                                <video id="dual-vid-b-cardmain" src="${second.url}" playsinline muted style="width: 100%; height: 100%; object-fit: contain;"></video>
                                <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.75); padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; color: #10b981; display: inline-flex; align-items: center; gap: 4px;">${iconHtml('videocam', 'icon-sm')} ${second.cameraLabel}</div>
                                <div id="dual-wait-b-cardmain" style="position: absolute; inset: 0; background: rgba(0,0,0,0.75); display: none; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.7); text-align: center; padding: 10px;"></div>
                            </div>
                        </div>
                        <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                <button type="button" id="dual-play-btn-cardmain" onclick="toggleDualPlay('cardmain')"
                                    style="background: var(--accent); color: #fff; border: none; min-height: 40px; padding: 8px 14px; border-radius: 8px; font-weight: 900; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                                    ${iconHtml('play_arrow', 'icon-sm')} TOISTA SYNKRONOITUNA
                                </button>
                                <div style="display: flex; gap: 4px;">
                                    <button type="button" onclick="setDualSpeed('cardmain', 1.0)" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.2); min-height: 36px; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer;">1x</button>
                                    <button type="button" onclick="setDualSpeed('cardmain', 0.5)" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.2); min-height: 36px; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer;">0.5x</button>
                                    <button type="button" onclick="setDualSpeed('cardmain', 0.25)" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.2); min-height: 36px; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer;">0.25x</button>
                                </div>
                                <div id="dual-clock-cardmain" style="margin-left: auto; font-family: monospace; font-size: 18px; font-weight: 900; color: #fff;">0,00 s</div>
                            </div>
                            <input type="range" id="dual-scrub-cardmain" aria-label="Aika-akseli" min="0" max="${totalSec}" step="0.02" value="0"
                                oninput="scrubDualCameras('cardmain', this.value)"
                                style="width: 100%; accent-color: var(--accent); cursor: pointer;">
                        </div>
                    </div>
                `;

                window.toggleCardDualMode = () => {
                    const isOpening = dualCont.style.display === 'none';
                    const btn = document.getElementById('dual-btn-cardmain');
                    if (isOpening) {
                        const raceSec = getVideoRaceTimeSec(vEl);
                        vEl.pause();
                        vCont.style.display = 'none';
                        dualCont.style.display = 'block';
                        if (btn) {
                            btn.innerHTML = `${iconHtml('close', 'icon-sm')} SULJE RINNAKKAISNÄKYMÄ`;
                            btn.style.background = 'var(--accent)';
                            btn.style.color = '#fff';
                        }
                        scrubDualCameras('cardmain', raceSec);
                    } else {
                        stopDualPlay('cardmain');
                        dualCont.style.display = 'none';
                        vCont.style.display = 'flex';
                        if (btn) {
                            btn.innerHTML = `${iconHtml('grid_view', 'icon-sm')} 2 KAMERAA RINNAKKAIN`;
                            btn.style.background = 'rgba(16, 185, 129, 0.15)';
                            btn.style.color = '#10b981';
                        }
                    }
                };
            }

            vEl.onended = () => {
                // Smart TV-Cut: advance to next camera at the exact current race timestamp
                if (currentIdx < videos.length - 1) {
                    loadClip(currentIdx + 1, true);
                }
            };

            vEl.ontimeupdate = () => {
                vOverlay.style.opacity = '1';
                const raceTimeSec = getVideoRaceTimeSec(vEl);
                vClock.innerText = formatSeconds(raceTimeSec);
                updateCardCamButtons(raceTimeSec);
                if (typeof window.updateLiveTelemetryHUD === 'function') {
                    window.updateLiveTelemetryHUD(raceTimeSec);
                }
                if (typeof window.syncGhostToMainVideo === 'function') {
                    window.syncGhostToMainVideo();
                }
            };

            vEl.onseeked = () => {
                const raceTimeSec = getVideoRaceTimeSec(vEl);
                if (typeof window.updateLiveTelemetryHUD === 'function') {
                    window.updateLiveTelemetryHUD(raceTimeSec);
                }
                if (typeof window.syncGhostToMainVideo === 'function') {
                    window.syncGhostToMainVideo();
                }
            };

            vEl.onplay = () => {
                vOverlay.style.opacity = '1';
                if (typeof window.syncGhostToMainVideo === 'function') window.syncGhostToMainVideo();
            };
            vEl.onpause = () => {
                vOverlay.style.opacity = '0.75';
                if (typeof window.syncGhostToMainVideo === 'function') window.syncGhostToMainVideo();
            };
            
            vEl.style.display = 'block';
            vPlaceholder.style.display = 'none';
            loadClip(0, false);
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
        const resp = await fetch(`${API_URL}?action=archives`);
        allArchives = await resp.json();
        renderArchiveList(allArchives);
    } catch (e) {
        listEl.innerHTML = '<p style="color:var(--danger); text-align:center;">Virhe ladattaessa arkistoa.</p>';
    }
}

function renderArchiveList(archives) {
    const listEl = document.getElementById('archive-list');
    if (!archives || archives.length === 0) {
        listEl.innerHTML = '<p style="opacity:0.4; text-align:center; padding:40px;">Ei löydettyjä harjoituksia.</p>';
        return;
    }

    listEl.innerHTML = archives.map(a => {
        const dateStr = new Date(a.date).toLocaleDateString('fi-FI');
        const autoLabel = a.autoArchived ? '<span style="font-size:9px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px; margin-left:8px; opacity:0.5;">AUTOMAATTINEN</span>' : '';
        const athleteNames = (a.athletes || []).slice(0, 3).join(', ') + ((a.athletes && a.athletes.length > 3) ? '...' : '');
        
        const deleteBtn = (selectedRole === 'VALMENTAJA' || currentRole === 'VALMENTAJA') 
            ? `<button type="button" onclick="event.stopPropagation(); deleteArchive('${a.filename}')" style="background:#ef4444; color:#fff; border:none; min-height:40px; padding:8px 12px; border-radius:8px; font-weight:900; font-size:11px; cursor:pointer; margin-left:10px; display:inline-flex; align-items:center; gap:4px;">${iconHtml('delete', 'icon-sm')} POISTA</button>` 
            : '';

        return `
            <div class="card" role="button" tabindex="0" onclick="openArchive('${a.filename}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openArchive('${a.filename}');}" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-left: 4px solid ${a.autoArchived ? 'rgba(255,255,255,0.2)' : 'var(--accent)'};">
                <div style="flex-grow:1; padding-right:15px;">
                    <div style="font-weight:900; font-size:18px; display:flex; align-items:center;">
                        ${a.name.toUpperCase()} ${autoLabel}
                    </div>
                    <div style="font-size:11px; opacity:0.65; font-weight:700; margin-bottom:4px;">
                        ${dateStr} • ${a.athleteCount} SUORITUSTA
                    </div>
                    <div style="font-size:10px; opacity:0.45; font-weight:600; text-transform:uppercase;">
                        ${athleteNames || 'Ei nimitietoja'}
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <div style="color:var(--accent); font-weight:900; white-space:nowrap; font-size:12px; display:inline-flex; align-items:center; gap:4px;">KATSO ${iconHtml('arrow_forward', 'icon-sm')}</div>
                    ${deleteBtn}
                </div>
            </div>
        `;
    }).join('');
}

function filterArchives() {
    const query = document.getElementById('input-archive-search').value.toUpperCase();
    if (!query) {
        renderArchiveList(allArchives);
        return;
    }
    
    const filtered = allArchives.filter(a => {
        const nameMatch = a.name.toUpperCase().includes(query);
        const athleteMatch = a.athletes && a.athletes.some(name => name.toUpperCase().includes(query));
        const dateMatch = new Date(a.date).toLocaleDateString('fi-FI').includes(query);
        return nameMatch || athleteMatch || dateMatch;
    });
    
    renderArchiveList(filtered);
}

async function openArchive(filename) {
    const listEl = document.getElementById('archive-list');
    const resultsEl = document.getElementById('archive-results');
    const resultsList = document.getElementById('archive-results-list');
    const titleEl = document.getElementById('archive-session-title');

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const archView = document.getElementById('view-archive');
    if (archView) archView.classList.add('active');

    try {
        const fetchUrl = `${API_URL}?action=get_archive&filename=${encodeURIComponent(filename)}`;
        const resp = await fetch(fetchUrl);
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        
        const session = await resp.json();

        titleEl.innerText = session.name.toUpperCase();
        listEl.style.display = 'none';
        resultsEl.style.display = 'block';

        if (!session.results || session.results.length === 0) {
            resultsList.innerHTML = '<p style="opacity:0.4; text-align:center;">Ei tuloksia tässä harjoituksessa.</p>';
            return;
        }

        resultsList.innerHTML = session.results.map((r, i) => {
            const splitList = (r.splits || []).map((s, idx) => 
                `<div style="font-size: 11px; opacity: 0.8; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; margin-right: 12px;">
                    <span style="color: var(--accent); font-weight: 800; display: inline-flex; align-items: center; gap: 3px;">${iconHtml('timer', 'icon-sm')} V${idx + 1}:</span> 
                    <span style="font-weight: 700;">${formatDuration(s.duration)} s</span> 
                </div>`
            ).join('');

            const safeArcId = `arc_${r.runId || i}`;
            const videos = normalizeRunVideos(r);
            const videoHtml = buildMultiCamPlayerHtml(safeArcId, r, videos);

            const deleteRunBtn = (selectedRole === 'VALMENTAJA' || currentRole === 'VALMENTAJA')
                ? `<button type="button" onclick="deleteRunFromArchive('${filename}', '${r.runId}')" style="background:rgba(239, 68, 68, 0.14); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.35); min-height:36px; padding:6px 10px; border-radius:6px; font-size:10px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin-top:6px;">${iconHtml('delete', 'icon-sm')} POISTA SUORITUS</button>`
                : '';

            return `
                <div class="card" id="run-card-${r.runId}" style="margin-bottom:15px; border-left: 4px solid #fff;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                        <div>
                            <span style="opacity:0.45; font-size: 11px;">#${session.results.length - i}</span>
                            <div style="font-weight: 900; font-size: 22px; margin: 4px 0;">${r.name.toUpperCase()}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size: 28px; font-weight: 900; color: var(--accent);">${formatDuration(r.totalTime)}</div>
                            ${deleteRunBtn}
                        </div>
                    </div>
                    ${videoHtml}
                    <div style="margin-top: 10px;">${splitList}</div>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button type="button" class="btn btn-outline" onclick="shareRun('${r.runId}', '${filename}')" style="flex: 1; margin: 0; padding: 15px; font-size: 14px;">${iconHtml('share', 'icon-sm')} JAA TULOS</button>
                        <button type="button" class="btn btn-primary" onclick="loadRunCard('${r.runId}', '${filename}')" style="flex: 1; margin: 0; padding: 15px; font-size: 14px;">${iconHtml('analytics', 'icon-sm')} ANALYSOI</button>
                    </div>
                </div>
            `;
        }).join('');

        resultsList.innerHTML += `
            <div style="margin: 40px 0 20px 0; border-top: 2px solid rgba(255,255,255,0.05); padding-top: 30px;">
                <button type="button" class="btn btn-primary" onclick="shareArchive('${filename}')" style="width: 100%; height: 80px; font-size: 20px;">${iconHtml('share', 'icon-md')} JAA KOKO HARJOITUS</button>
            </div>
        `;
    } catch (e) {
        console.error("[ARCHIVE] Load failed:", e);
        alert(`Virhe avattaessa arkistoa: ${e.message}`);
    }
}

function generateQR(sid) {
    if (!sid) return console.error("[QR] No session ID provided");
    const url = `${window.location.origin}${window.location.pathname}?s=${sid}`;
    
    let attempts = 0;
    const tryRender = () => {
        const canvas = document.getElementById('session-qr-large');
        const lib = window.QRCode;
        
        if (canvas && lib && typeof lib.toCanvas === 'function') {
            lib.toCanvas(canvas, url, { 
                width: 300, 
                margin: 2, 
                color: { dark: '#000000', light: '#ffffff' } 
            }, function (error) {
                if (error) {
                    console.error('[QR] Render error:', error);
                    canvas.parentElement.innerHTML = `<div style="color:#000; font-weight:900; padding:20px;">QR VIRHE</div>`;
                }
            });
        } else if (attempts < 5) {
            attempts++;
            setTimeout(tryRender, 200);
        } else {
            if (canvas) {
                canvas.parentElement.innerHTML = `
                    <div style="color:#000; padding:20px; font-weight:800; text-align:center;">
                        QR-KOODI EI LATAUTUNUT<br>
                        <span style="font-size:10px; font-weight:400; opacity:0.6; margin-top:10px; display:block;">
                            Käytä koodia:<br>
                            <span style="font-size:18px; color:var(--accent);">${sid}</span>
                        </span>
                    </div>`;
            }
        }
    };
    tryRender();
}

function showQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
        if (currentSession) generateQR(currentSession.id);
    }
}

function hideQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

async function deleteArchive(filename) {
    if (!confirm("Haluatko varmasti poistaa koko harjoituksen arkistosta? Tätä ei voi perua.")) return;

    try {
        const resp = await fetch(`${API_URL}?action=delete_archive&filename=${encodeURIComponent(filename)}`, { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            alert("Harjoitus poistettu.");
            loadArchives();
        } else {
            throw new Error(data.error || "Poisto epäonnistui.");
        }
    } catch (e) {
        alert("Virhe poistettaessa: " + e.message);
    }
}

async function deleteRunFromArchive(filename, runId) {
    if (!confirm("Haluatko varmasti poistaa tämän yksittäisen suorituksen?")) return;

    try {
        const resp = await fetch(`${API_URL}?action=delete_archive_run&filename=${encodeURIComponent(filename)}&runId=${encodeURIComponent(runId)}`, { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            const card = document.getElementById(`run-card-${runId}`);
            if (card) {
                card.style.opacity = '0.3';
                card.style.pointerEvents = 'none';
                card.innerHTML = `<div style="padding:40px; text-align:center; font-weight:900; color:#ef4444;">SUORITUS POISTETTU</div>`;
            }
        } else {
            throw new Error(data.error || "Poisto epäonnistui.");
        }
    } catch (e) {
        alert("Virhe poistettaessa suoritusta: " + e.message);
    }
}

window.deleteArchive = deleteArchive;
window.deleteRunFromArchive = deleteRunFromArchive;
window.cardPlayerLoad = (idx) => {};
window.showQRModal = showQRModal;
window.hideQRModal = hideQRModal;
