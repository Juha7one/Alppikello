// --- Alppikello MAIN CONTROLLER ---
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
    if (userName) document.getElementById('input-profile-name').value = userName;
    showOnboardingStep('name');
});

// --- Session Management ---

async function createSession() {
    if (!userName) return showOnboardingStep('name');

    const btn = document.querySelector('#coach-only-create .btn-outline');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "LUODAAN...";
    }

    let placeStr = "TREENI";
    let initialLocation = null;
    if ("geolocation" in navigator) {
        try {
            // Increased timeout for slow mobile GPS
            const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, enableHighAccuracy: true }));
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
        name: generatedId, // Name and code are now the same
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
        const createBtn = document.querySelector('#coach-only-create .btn-outline');
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerText = "LUO UUSI HARJOITUS";
        }

        // RESET Manual Join Toggle
        const manualToggle = document.getElementById('btn-toggle-manual');
        if (manualToggle) manualToggle.style.display = 'none';

        // SMART AGGRESSIVE DEDUPLICATION:
        const manualCont = document.getElementById('manual-join-container');
        const contCont = document.getElementById('continue-session-container');
        const nearbyCont = document.getElementById('nearby-sessions-container');
        const toggle = document.getElementById('btn-toggle-manual');
        
        // Fetch fresh nearby sessions
        if (socket && socket.connected) socket.emit('get_nearby_sessions', { lat: userLocation?.lat, lon: userLocation?.lon });

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

        // Initial UI state: if we have currentSession, hide manual section
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
        userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        socket.emit('find_nearby_sessions', { lat: pos.coords.latitude, lon: pos.coords.longitude });
    }, null, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
}

// --- Time Sync ---

function startTimeSync() {
    for (let i = 0; i < 5; i++) setTimeout(() => socket.emit('sync_time', Date.now()), i * 500);
    setInterval(() => socket.emit('sync_time', Date.now()), 30000);
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
    
    // Consistent with shareRun: use query parameter on the main page
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
    
    // 1. Session join (Still needs onboarding to confirm name/role)
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
        console.log(`[DEEP LINK] Opening archive run: ${runId} from ${cleanFile}`);
        loadRunCard(runId, cleanFile + '.json');
        return true;
    }

    // 2. Individual Run Card view (Bypasses onboarding)
    if (runId) {
        loadRunCard(runId);
        return true;
    }

    // 3. Whole Archive view (Bypasses onboarding)
    if (archFile) {
        const cleanFile = archFile.trim();
        console.log(`[DEEP LINK] Opening archive: ${cleanFile}`);
        openArchive(cleanFile + '.json');
        return true;
    }

    return false;
}

async function loadRunCard(runId, archiveFilename = null) {
    // Show view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-onboarding').classList.remove('active');
    document.getElementById('view-run-card').classList.add('active');
    
    const loading = document.getElementById('run-card-loading');
    const content = document.getElementById('run-card-content');
    loading.style.display = 'flex';
    content.style.display = 'none';
    
    try {
        let data;
        const baseUrl = SERVER_URL || window.location.origin;
        
        if (archiveFilename) {
            const resp = await fetch(`${baseUrl}/api/archives/${archiveFilename}`);
            if (!resp.ok) throw new Error("Arkistoa ei löytynyt");
            const session = await resp.json();
            const foundRun = (session.results || []).find(r => r.runId === runId);
            if (!foundRun) throw new Error("Suoritusta ei löytynyt arkistosta");
            
            const userRuns = session.results.filter(r => r.name === foundRun.name);
            const finalRunNumber = userRuns.findIndex(r => r.runId === runId) + 1;
            
            data = {
                id: foundRun.runId,
                name: foundRun.name,
                runNumber: finalRunNumber,
                startTime: foundRun.startTime || session.timestamp || Date.now(),
                totalTime: foundRun.totalTime,
                videoUrl: foundRun.videoUrl || null,
                videos: foundRun.videos || [],
                splits: foundRun.splits || [],
                sessionName: session.name || "Arkistoitu Harkka",
                timestamp: session.archivedAt || Date.now(),
                status: foundRun.status,
                sessionResults: session.results.map(r => ({ name: r.name, totalTime: r.totalTime, status: r.status, runId: r.runId }))
            };
        } else {
            const resp = await fetch(`${baseUrl}/api/run/${runId}`);
            if (!resp.ok) throw new Error("Suoritusta ei löytynyt aktiivisista harjoituksista. Onko se kenties arkistoitu?");
            data = await resp.json();
        }
        
        // NEW REDESIGN context: Use sessionResults if available to calculate labels
        const sessionResults = data.sessionResults || [];
        const validResults = [...sessionResults]
            .filter(r => r.totalTime > 0 && r.status !== 'DNF')
            .sort((a,b) => a.totalTime - b.totalTime);
        const bestTime = validResults.length > 0 ? validResults[0].totalTime : 0;
        const isDNF = data.status === 'DNF';
        const rank = isDNF ? null : (validResults.findIndex(vr => vr.runId === data.id) + 1 || null);
        
        // Personal best in this session
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

        // Populate UI
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
        
        // Hide standard time-box if we used the header above
        const standardTimeBox = document.getElementById('card-total-time-box');
        if (standardTimeBox) standardTimeBox.style.display = 'none';
        
        // Splits
        const splitsEl = document.getElementById('card-splits');
        if (data.splits && data.splits.length > 0) {
            splitsEl.innerHTML = data.splits.map((s, idx) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
                    <span style="opacity: 0.5; font-weight: 700;">VÄLIAIKA ${idx+1}</span>
                    <span style="font-weight: 900;">${formatDuration(s.duration)}</span>
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
                vClock.innerText = formatSeconds(raceTimeSec);
                vClock.parentElement.querySelector('.role-badge').innerText = (videos[currentIdx].role || 'VIDEO').toUpperCase();
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
        allArchives = await resp.json();
        renderArchiveList(allArchives);
    } catch (e) {
        listEl.innerHTML = '<p style="color:var(--danger); text-align:center;">Virhe ladattaessa arkistoa.</p>';
    }
}

function renderArchiveList(archives) {
    const listEl = document.getElementById('archive-list');
    if (archives.length === 0) {
        listEl.innerHTML = '<p style="opacity:0.4; text-align:center; padding:40px;">Ei löydettyjä harjoituksia.</p>';
        return;
    }

    listEl.innerHTML = archives.map(a => {
        const dateStr = new Date(a.date).toLocaleDateString('fi-FI');
        const autoLabel = a.autoArchived ? '<span style="font-size:9px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px; margin-left:8px; opacity:0.5;">AUTOMAATTINEN</span>' : '';
        const athleteNames = (a.athletes || []).slice(0, 3).join(', ') + ((a.athletes && a.athletes.length > 3) ? '...' : '');
        
        const deleteBtn = (selectedRole === 'VALMENTAJA' || currentRole === 'VALMENTAJA') 
            ? `<button onclick="event.stopPropagation(); deleteArchive('${a.filename}')" style="background:#ef4444; color:#fff; border:none; padding:8px 12px; border-radius:8px; font-weight:900; font-size:10px; cursor:pointer; margin-left:10px;">POISTA 🗑️</button>` 
            : '';

        return `
            <div class="card" onclick="openArchive('${a.filename}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-left: 4px solid ${a.autoArchived ? 'rgba(255,255,255,0.2)' : 'var(--accent)'};">
                <div style="flex-grow:1; padding-right:15px;">
                    <div style="font-weight:900; font-size:18px; display:flex; align-items:center;">
                        ${a.name.toUpperCase()} ${autoLabel}
                    </div>
                    <div style="font-size:11px; opacity:0.5; font-weight:700; margin-bottom:4px;">
                        ${dateStr} • ${a.athleteCount} SUORITUSTA
                    </div>
                    <div style="font-size:10px; opacity:0.3; font-weight:600; text-transform:uppercase;">
                        ${athleteNames || 'Ei nimitietoja'}
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <div style="color:var(--accent); font-weight:900; white-space:nowrap; font-size:12px;">KATSO →</div>
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

    // Ensure we show the archive view and hide onboarding (important for deep links)
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const archView = document.getElementById('view-archive');
    if (archView) archView.classList.add('active');

    try {
        const baseUrl = SERVER_URL || window.location.origin;
        const fetchUrl = `${baseUrl}/api/archives/${filename}`;
        console.log(`[ARCHIVE] Fetching: ${fetchUrl}`);
        
        const resp = await fetch(fetchUrl);
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        
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
                        <video id="arc-video-${r.runId}" src="${r.videoUrl}" controls playsinline style="width: 100%; height: 100%; object-fit: contain;"></video>
                        <div id="arc-clock-${r.runId}" class="clock-overlay" style="position: absolute; bottom: 15px; right: 15px; pointer-events: none; background: rgba(0,0,0,0.8); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px); transition: opacity 0.3s; opacity: 0; text-align: right; z-index: 10;">
                            <div style="font-size: 8px; font-weight: 900; color: var(--accent); letter-spacing: 0.5px; line-height: 1; text-transform: uppercase; margin-bottom: 2px;">${r.name.toUpperCase()}</div>
                            <div class="clock-val" style="font-size: 16px; font-weight: 900; font-family: monospace; line-height: 1; color: #fff;">0.00</div>
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

            const deleteRunBtn = (selectedRole === 'VALMENTAJA' || currentRole === 'VALMENTAJA')
                ? `<button onclick="deleteRunFromArchive('${filename}', '${r.runId}')" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:4px 8px; border-radius:4px; font-size:9px; font-weight:800; cursor:pointer;">POISTA SUORITUS 🗑️</button>`
                : '';

            return `
                <div class="card" id="run-card-${r.runId}" style="margin-bottom:15px; border-left: 4px solid #fff;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                        <div>
                            <span style="opacity:0.3; font-size: 11px;">#${session.results.length - i}</span>
                            <div style="font-weight: 900; font-size: 22px; margin: 4px 0;">${r.name.toUpperCase()}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size: 28px; font-weight: 900; color: var(--accent);">${formatDuration(r.totalTime)}</div>
                            ${deleteRunBtn}
                        </div>
                    </div>
                    ${videoHtml}
                    <div style="margin-top: 10px;">${splitList}</div>
                    <button class="btn-mini" onclick="shareRun('${r.runId}', '${filename}')" style="margin-top: 15px; width: 100%; background: rgba(255,255,255,0.05);">JAA TULOSKORTTI 🔗</button>
                </div>
            `;
        }).join('');

        // Add Share Entire Session Button at the bottom
        resultsList.innerHTML += `
            <div style="margin: 40px 0 20px 0; border-top: 2px solid rgba(255,255,255,0.05); padding-top: 30px;">
                <button class="btn btn-primary" onclick="shareArchive('${filename}')" style="width: 100%; height: 80px; font-size: 20px;">JAA KOKO HARJOITUS 🔗</button>
            </div>
        `;

        // Attach clock logic to archive videos
        session.results.forEach(r => {
            const vEl = document.getElementById(`arc-video-${r.runId}`);
            const vClock = document.getElementById(`arc-clock-${r.runId}`);
            if (vEl && vClock) {
                const clockVal = vClock.querySelector('.clock-val');
                vEl.ontimeupdate = () => {
                    vClock.style.opacity = '1';
                    const displayMs = Math.min(vEl.currentTime * 1000, r.totalTime || 999999);
                    if (clockVal) clockVal.innerText = formatSeconds(displayMs / 1000);
                };
                vEl.onpause = () => vClock.style.opacity = '0.5';
                vEl.onplay = () => vClock.style.opacity = '1';
            }
        });

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
            console.error(`[QR] FAIL: canvas=${!!canvas} lib=${!!lib}`);
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
        // Force a reflow for transition if needed, then add active
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
        const baseUrl = SERVER_URL || window.location.origin;
        const resp = await fetch(`${baseUrl}/api/archives/${filename}/delete`, { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            alert("Harjoitus poistettu.");
            loadArchives(); // Refresh list
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
        const baseUrl = SERVER_URL || window.location.origin;
        const resp = await fetch(`${baseUrl}/api/archives/${filename}/runs/${runId}/delete`, { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            const card = document.getElementById(`run-card-${runId}`);
            if (card) {
                card.style.opacity = '0.3';
                card.style.pointerEvents = 'none';
                card.innerHTML = `<div style="padding:40px; text-align:center; font-weight:900; color:#ef4444;">SUORITUS POISTETTU</div>`;
            }
            if (data.remaining === 0) {
                // If last run was deleted, the archive might still exist but be empty.
                // We could just reload archives list.
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
window.cardPlayerLoad = (idx) => { /* Placeholder if needed globally */ };
window.showQRModal = showQRModal;
window.hideQRModal = hideQRModal;
