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
    if (userName) document.getElementById('input-user-name').value = userName;
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
        const sNameEl = document.getElementById('coach-session-name'); // Updated to use correct ID
        if (sNameEl) sNameEl.innerText = session.name;
        const codeEl = document.getElementById('session-code');
        if (codeEl) codeEl.innerText = session.id;
        generateQR(session.id);
    }

    startGPSTracking();

    // AUTO-ACTIVATE CAMERA/CV based on role
    if (typeof stopCV === 'function') stopCV(); 
    
    const roleForCV = {
        'LÄHTÖ': 'lähtö',
        'MAALI': 'maali',
        'VÄLIAIKA': 'väliaika',
        'VIDEO': 'video'
    }[role];

    if (roleForCV && typeof startCV === 'function') {
        console.log(`[AUTO-CV] Activating for ${role}`);
        startCV(roleForCV);
    }

    refreshStaticViews();
    updateUI();
}

// --- Onboarding Helpers ---

function saveNameAndNext() {
    const val = document.getElementById('input-user-name').value.trim();
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
        const manualContainer = document.getElementById('manual-join-container');
        const manualToggle = document.getElementById('btn-toggle-manual');
        if (manualContainer) manualContainer.style.display = 'none';
        if (manualToggle) manualToggle.style.display = 'block';
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
        const vOverlay = document.getElementById('card-video-overlay');
        const vClock = document.getElementById('card-video-clock');
        const vName = document.getElementById('card-video-name');

        if (data.videoUrl) {
            vEl.src = data.videoUrl;
            vCont.style.display = 'block';
            vName.innerText = data.name.toUpperCase();
            
            // Re-render overlay based on video time
            vEl.ontimeupdate = () => {
                const currentTimeMs = vEl.currentTime * 1000;
                const totalTimeMs = data.totalTime;
                
                // Show clock if video is playing
                vOverlay.style.opacity = '1';
                
                // Simple logic: show time up to totalTime, then freeze
                const displayMs = Math.min(currentTimeMs, totalTimeMs);
                vClock.innerText = (displayMs / 1000).toFixed(2);
            };

            vEl.onplay = () => { vOverlay.style.opacity = '1'; };
            vEl.onpause = () => { vOverlay.style.opacity = '0.5'; };
        } else {
            vCont.style.display = 'none';
        }

        loading.style.display = 'none';
        content.style.display = 'block';

    } catch (e) {
        loading.innerHTML = `<div style="color:var(--danger); font-weight:900;">VIRHE: ${e.message}</div>
        <button class="btn btn-mini" onclick="location.href='/'" style="margin-top:20px;">TAKAISIN</button>`;
    }
}

function generateQR(sid) {
    const canvas = document.getElementById('session-qr-large');
    if (!canvas || typeof QRCode === 'undefined') return;
    const url = `${window.location.origin}${window.location.pathname}?s=${sid}`;
    QRCode.toCanvas(canvas, url, { width: 260 });
}

function showQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) { modal.style.display = 'flex'; if (currentSession) generateQR(currentSession.id); }
}
function hideQRModal() { const modal = document.getElementById('qr-modal'); if (modal) modal.style.display = 'none'; }
