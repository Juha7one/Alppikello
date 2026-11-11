// --- Alppikello Timing Actions ---

function addToQueue(athleteId, options = {}) {
    if (!currentSession) return console.error("[CLIENT] No active session!");
    console.log("[CLIENT] Emitting move_to_queue for athlete:", athleteId);

    const queue = currentSession.activeQueue || [];
    const isAlreadyQueued = queue.some(q => String(q.id) === String(athleteId));

    if (isAlreadyQueued) {
        if (typeof cancelFisStartSequence === 'function') cancelFisStartSequence();
    } else {
        window.starterArmingUntil = Date.now() + 2000;
        const isCourseClear = (currentSession.onCourse || []).length === 0;
        if (!options.fromVoice && currentRole === 'LÄHETTÄJÄ' && isCourseClear && typeof playFisStartSequence === 'function') {
            playFisStartSequence();
        }
    }

    socket.emit('move_to_queue', { 
        sessionId: currentSession.id, 
        athleteId: String(athleteId) 
    });
}

function markReady() {
    if (!currentSession) return;
    socket.emit('athlete_ready', { sessionId: currentSession.id, name: userName });
    const btn = document.getElementById('ready-btn');
    if (btn) {
        btn.innerText = "ODOTETAAN LÄHTÖÄ...";
        btn.disabled = true;
    }
}

function simulateTrigger(type, explicitTimestamp = null) {
    if (!currentSession) return;
    const timestamp = explicitTimestamp || getSyncedTime();
    const runId = (type === 'start')
        ? ('run_' + timestamp + '_' + Math.random().toString(36).substring(2, 6))
        : undefined;

    if (type === 'start' && typeof cancelFisStartSequence === 'function') {
        cancelFisStartSequence();
    }

    socket.emit(`trigger_${type}`, {
        sessionId: currentSession.id,
        timestamp,
        runId,
        deviceName: userName || 'Tuntematon laite'
    });

    // Visual Feedback on sensor / starter node info
    const ids = type === 'start' ? ['start-node-info', 'starter-node-info'] : (type === 'finish' ? ['finish-node-info'] : ['split-node-info']);
    ids.forEach(nodeId => {
        const infoEl = document.getElementById(nodeId);
        if (infoEl) {
            infoEl.innerText = "LAUKAISTU!";
            infoEl.style.color = "var(--success)";
            setTimeout(() => {
                infoEl.innerText = "VALMIINA";
                infoEl.style.color = "var(--text-secondary)";
            }, 2000);
        }
    });
}

function markRunnerDNF(runnerId) {
    if (confirm("Merkitäänkö keskeytys?")) {
        socket.emit('mark_dnf', { sessionId: currentSession.id, runnerId });
    }
}

function confirmResult(runnerId) {
    socket.emit('confirm_result', { sessionId: currentSession.id, runnerId });
}

function rejectResult(runnerId) {
    if (confirm("Hylätäänkö tulos?")) {
        socket.emit('reject_result', { sessionId: currentSession.id, runnerId });
    }
}

function manualFinish(runnerId) {
    if (confirm("Lopetetaanko ajanotto manuaalisesti?")) {
        socket.emit('manual_finish', { sessionId: currentSession.id, runnerId, timestamp: getSyncedTime() });
    }
}

function confirmEndSession() {
    if (!currentSession) return;
    
    showPremiumModal({
        title: 'LOPETETAANKO HARJOITUS?',
        text: 'Kaikkien laitteiden yhteys katkaistaan ja tulokset arkistoidaan pysyvästi.',
        icon: 'sports_score',
        confirmText: 'KYLLÄ, LOPETA NYT',
        cancelText: 'PYSY HARJOITUKSESSA',
        onConfirm: () => {
            socket.emit('end_session', currentSession.id);
        }
    });
}

function selectExistingName(name) {
    const input = document.getElementById('name-input');
    if (input) {
        input.value = name;
        saveName();
    }
}

function addAthleteManually(inputId = 'input-manual-athlete') {
    const input = document.getElementById(inputId);
    const name = input ? input.value.trim() : "";
    if (!currentSession || !name) return alert("Anna urheilijan nimi!");

    window.starterArmingUntil = Date.now() + 2000;
    const isCourseClear = (currentSession.onCourse || []).length === 0;

    socket.emit('add_athlete', {
        sessionId: currentSession.id,
        name: name,
        autoQueue: true // Starter adds directly to queue
    });

    if (currentRole === 'LÄHETTÄJÄ' && isCourseClear && typeof playFisStartSequence === 'function') {
        playFisStartSequence();
    }

    if (input) input.value = '';
}

function clearQueue() {
    if (!currentSession) return;
    if (typeof cancelFisStartSequence === 'function') {
        cancelFisStartSequence();
    }
    console.log("[CLIENT] Clearing queue for session:", currentSession.id);
    socket.emit('clear_queue', { sessionId: currentSession.id });
}

// Global exposure
window.addToQueue = addToQueue;
window.clearQueue = clearQueue;
window.addAthleteManually = addAthleteManually;
