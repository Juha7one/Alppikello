// --- Alppikello Socket Event Listeners ---

socket.on('connect', () => {
    const connDot = document.getElementById('conn-dot');
    const connText = document.getElementById('conn-text');
    if (connDot) connDot.classList.add('connected');
    if (connText) connText.innerText = 'Yhdistetty';
    
    startTimeSync();
    checkDeepLink();
    startDiscoveryGPS(); 
    
    if (userName) document.getElementById('input-user-name').value = userName;
    showOnboardingStep('name');
});

socket.on('disconnect', () => {
    const connDot = document.getElementById('conn-dot');
    const connText = document.getElementById('conn-text');
    if (connDot) connDot.classList.remove('connected');
    if (connText) connText.innerText = 'Yhteys katkesi';
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
    if (currentSession.onCourse && currentSession.onCourse.length > 0) {
        const firstRunner = currentSession.onCourse[0];
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
    location.reload();
});

socket.on('timing_update', (data) => {
    currentSession = data.session;
    updateUI();

    if (currentRole === 'VIDEO' && data.type === 'START') {
        showVideoNotification(`LASKIJA LÄHTI: ${data.runner.name}`);
    }
    console.log(`TIMING [${data.type}]: ${data.runner.name}`);
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
        if (data.devices) itemsToShow = data.devices.filter(d => d.role === 'VÄLIAIKA');
    } else if (selectedRole === 'VIDEO') {
        introEl.innerText = "Valitse kamera tai luo uusi:";
        labelEl.innerText = "TAI UUSI KAMERA:";
        inputEl.placeholder = "KAMERAN NIMI";
        icon = '📹';
        if (data.devices) itemsToShow = data.devices.filter(d => d.role === 'VIDEO');
    } else if (selectedRole === 'LÄHTÖ') {
        introEl.innerText = "Valitse korvattava Starttikello tai nimeä tämä laite:";
        labelEl.innerText = "TAI UUSI LAITENIMI:";
        inputEl.placeholder = "ESIM. VARAPUHELIN";
        icon = '⏲️';
        if (data.devices) itemsToShow = data.devices.filter(d => d.role === 'LÄHTÖ');
    } else if (selectedRole === 'MAALI') {
        introEl.innerText = "Valitse korvattava Maalikamera tai nimeä tämä laite:";
        labelEl.innerText = "TAI UUSI LAITENIMI:";
        inputEl.placeholder = "ESIM. IPAD LOPPU";
        icon = '🏁';
        if (data.devices) itemsToShow = data.devices.filter(d => d.role === 'MAALI');
    } else if (selectedRole === 'VALMENTAJA' || selectedRole === 'LÄHETTÄJÄ' || selectedRole === 'KATSOMO') {
        introEl.innerText = "Anna laitteelle tai sijainnille nimi:";
        labelEl.innerText = "LAITTEEN NIMI:";
        inputEl.placeholder = "NIMI TAI TUNNISTE";
        itemsToShow = [];
    } else {
        introEl.innerText = "Valitse nimesi alta tai kirjoita uusi:";
        labelEl.innerText = "TAI UUSI LASKIJA:";
        inputEl.placeholder = "OMA NIMESI";
        itemsToShow = data.athletes || [];
    }

    if (userName) inputEl.value = userName;
    showOnboardingStep('setup-name');

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
    }
});

socket.on('sync_response', (data) => {
    const t4 = Date.now();
    serverTimeOffset = ((data.serverReceivedTime - data.clientSentTime) + (data.serverReceivedTime - t4)) / 2;
    rtt = t4 - data.clientSentTime;
    const syncOffsetEl = document.getElementById('sync-offset');
    if (syncOffsetEl) syncOffsetEl.innerText = `${Math.round(serverTimeOffset)}ms (RTT: ${rtt}ms)`;
});
