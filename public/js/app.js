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
        const sNameEl = document.getElementById('session-name');
        if (sNameEl) sNameEl.innerText = session.name;
        document.getElementById('session-code').innerText = session.id;
        generateQR(session.id);
    }

    startGPSTracking();
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
    const url = window.location.origin + '/run/' + runId;
    if (navigator.share) {
        navigator.share({ title: 'Alppikello Run', url: url });
    } else {
        copyToClipboard(url);
    }
}

function checkDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('s');
    if (sid) {
        document.getElementById('input-session-id').value = sid.toUpperCase();
        showOnboardingStep('name');
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
