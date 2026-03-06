// --- Alppikello Timing Actions ---

function addToQueue(athleteId) {
    if (!currentSession) return;
    socket.emit('move_to_queue', { sessionId: currentSession.id, athleteId });
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

function simulateTrigger(type) {
    if (!currentSession) return;
    const timestamp = getSyncedTime();
    socket.emit(`trigger_${type}`, {
        sessionId: currentSession.id,
        timestamp,
        deviceName: userName || 'Tuntematon laite'
    });

    // Feedback
    const id = type === 'start' ? 'start' : (type === 'finish' ? 'finish' : 'split');
    const infoEl = document.getElementById(`${id}-node-info`);
    if (infoEl) {
        const old = infoEl.innerText;
        infoEl.innerText = "LAUKAISTU! ⏱️";
        setTimeout(() => infoEl.innerText = old, 2000);
    }
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
        socket.emit('manual_finish', { sessionId: currentSession.id, runnerId });
    }
}

function confirmEndSession() {
    if (endSessionStep === 0) {
        if (confirm('Lopetetaanko harjoitus?')) {
            endSessionStep = 1;
            const btn = document.querySelector('#coach-only-end .btn-danger');
            if (btn) btn.innerText = "VAHVISTA LOPETUS!";
            setTimeout(() => { endSessionStep = 0; if (btn) btn.innerText = "LOPETA HARJOITUS"; }, 5000);
        }
    } else {
        socket.emit('end_session', currentSession.id);
    }
}

function selectExistingName(name) {
    const input = document.getElementById('name-input');
    if (input) {
        input.value = name;
        saveName();
    }
}

function addAthleteManually() {
    const input = document.getElementById('input-manual-athlete');
    const name = input ? input.value.trim() : "";
    if (!currentSession || !name) return alert("Anna urheilijan nimi!");

    socket.emit('add_athlete', {
        sessionId: currentSession.id,
        name: name,
        autoQueue: true // Starter adds directly to queue
    });

    if (input) input.value = '';
}

function clearQueue() {
    if (!currentSession) return;
    socket.emit('clear_queue', { sessionId: currentSession.id });
}
