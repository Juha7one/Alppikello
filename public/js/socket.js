// --- Alppikello Stateless Sync, One-Shot Clock Calibration & Store-and-Forward Outbox ---

const OUTBOX_STORAGE_KEY = 'alppikello_event_outbox_v1';
let outboxFlushInFlight = false;
let sessionPollTimer = null;
let currentSessionVersion = -1;
let lastLocationSentAt = 0;

/**
 * Update the footer status indicator (Connected / Offline Queue / Calibrated)
 */
function setConnectionStatus(state, detail = '') {
    const connDot = document.getElementById('conn-dot');
    const connText = document.getElementById('conn-text');
    if (!connDot || !connText) return;

    if (state === 'online') {
        connDot.classList.add('connected');
        connDot.style.background = '';
        connText.innerText = detail || 'Kalibroitu (Valmis)';
    } else if (state === 'queued') {
        connDot.classList.add('connected');
        connDot.style.background = '#f59e0b';
        connText.innerText = detail || 'Puskurissa (Odottaa verkkoa)';
    } else {
        connDot.classList.remove('connected');
        connDot.style.background = '#ef4444';
        connText.innerText = detail || 'Offline (Kello toimii paikallisesti)';
    }
}

/**
 * Calibrate the device's internal monotonic clock (performance.now()) ONCE against
 * the server clock using 5 quick HTTP samples and picking the minimum-RTT sample.
 */
async function calibrateClockOnce() {
    let bestRtt = Infinity;
    let bestServerTimeAtPerf = 0;
    let bestPerfTime = 0;
    let bestWallOffset = 0;

    for (let i = 0; i < 5; i++) {
        try {
            const wallStart = Date.now();
            const p0 = performance.now();
            const resp = await fetch(`${API_URL}?action=time&_=${wallStart}_${i}`, {
                cache: 'no-store'
            });
            const p1 = performance.now();
            const wallEnd = Date.now();

            if (!resp.ok) continue;
            const data = await resp.json();
            const sampleRtt = p1 - p0;
            const serverTime = Number(data.serverTime);

            if (typeof data.storageActive === 'boolean') {
                s3Active = data.storageActive;
            }

            if (serverTime > 0 && sampleRtt < bestRtt) {
                bestRtt = sampleRtt;
                // At the moment p1, server time was serverTime + (sampleRtt / 2)
                bestServerTimeAtPerf = serverTime + (sampleRtt / 2);
                bestPerfTime = p1;
                bestWallOffset = ((wallStart + wallEnd) / 2) - serverTime;
            }
        } catch (err) {
            console.warn('[CLOCK] Calibration sample failed:', err.message);
        }
    }

    if (bestRtt < Infinity) {
        clockBaseServerTime = bestServerTimeAtPerf;
        clockBasePerfTime = bestPerfTime;
        serverTimeOffset = Math.round(bestWallOffset);
        rtt = Math.round(bestRtt);
        clockCalibrated = true;

        const syncOffsetEl = document.getElementById('sync-offset');
        if (syncOffsetEl) {
            const sign = serverTimeOffset >= 0 ? '+' : '';
            syncOffsetEl.innerText = `${sign}${serverTimeOffset}ms (RTT: ${rtt}ms, LUKITTU)`;
        }
        setConnectionStatus('online', 'Kello lukittu');
        console.log(`[CLOCK] Calibrated ONCE! Offset=${serverTimeOffset}ms, MinRTT=${rtt}ms`);
        return true;
    } else {
        setConnectionStatus('offline', 'Offline (Paikallinen kello)');
        return false;
    }
}

// ============================================================================
// STORE & FORWARD OUTBOX (Offline-Resilient Event Queue)
// ============================================================================

function getOutbox() {
    try {
        const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveOutbox(list) {
    try {
        localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('[OUTBOX] Could not save to localStorage:', e);
    }
}

function enqueueEvent(type, payload = {}) {
    const ev = {
        eventId: 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
        type: type,
        sessionId: payload.sessionId || (currentSession ? currentSession.id : ''),
        timestamp: payload.timestamp || getSyncedTime(),
        deviceId: deviceId,
        ...payload
    };

    const box = getOutbox();
    box.push(ev);
    saveOutbox(box);

    // Apply immediate optimistic local state update so UI never lags
    applyOptimisticEvent(ev);

    // Trigger immediate flush attempt
    flushOutbox();
    return ev;
}

function applyOptimisticEvent(ev) {
    if (!currentSession || ev.sessionId !== currentSession.id) return;

    if (ev.type === 'trigger_start' && currentSession.activeQueue && currentSession.activeQueue.length > 0) {
        const nextAthlete = currentSession.activeQueue[0];
        const optimisticRunner = {
            id: nextAthlete.id,
            runId: ev.runId || ('run_' + ev.timestamp),
            name: nextAthlete.name,
            startTime: ev.timestamp,
            splits: [],
            videos: [],
            done: false
        };
        activeRunnerOnCourse = optimisticRunner;
        hasRecordedForCurrentRunner = false;
    }
}

async function flushOutbox() {
    if (outboxFlushInFlight) return;
    const box = getOutbox();
    if (box.length === 0) return;

    outboxFlushInFlight = true;
    try {
        // Group by sessionId
        const targetSessionId = box[0].sessionId;
        const batch = box.filter(item => item.sessionId === targetSessionId);
        const batchIds = new Set(batch.map(b => b.eventId));

        const resp = await fetch(`${API_URL}?action=event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: targetSessionId,
                events: batch
            })
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();

        // Remove sent events from outbox
        const currentBox = getOutbox().filter(item => !batchIds.has(item.eventId));
        saveOutbox(currentBox);

        if (currentBox.length === 0) {
            setConnectionStatus('online', 'Tallennettu');
        } else {
            setConnectionStatus('queued', `Jonossa (${currentBox.length})`);
        }

        if (data.session) {
            applyServerSessionState(data.session, data.timingEvent || null);
        }
    } catch (err) {
        const remaining = getOutbox().length;
        setConnectionStatus('queued', `Puskurissa (${remaining} odottaa verkkoa)`);
        console.warn('[OUTBOX] Network busy/offline, will retry automatically:', err.message);
    } finally {
        outboxFlushInFlight = false;
    }
}

// ============================================================================
// SESSION STATE SYNCHRONIZATION
// ============================================================================

function applyServerSessionState(session, timingEvent = null) {
    if (!session) return;

    // Detect if session was ended by coach
    if (session.ended) {
        stopSessionPolling();
        currentSession = null;
        showPremiumModal({
            title: 'HARJOITUS LOPETETTU',
            text: 'Valmentaja on lopettanut harjoituksen. Kaikki suoritukset on arkistoitu.',
            icon: '🏁',
            confirmText: 'SELVÄ',
            cancelText: '',
            onConfirm: () => {
                location.reload();
            }
        });
        return;
    }

    const prevVideoCount = currentSession && currentSession.results
        ? currentSession.results.reduce((acc, r) => acc + (r.videos ? r.videos.length : 0), 0)
        : 0;

    currentSession = session;
    currentSessionVersion = session.version || currentSessionVersion;

    if (currentSession.onCourse && currentSession.onCourse.length > 0) {
        const firstRunner = currentSession.onCourse[0];
        if (!activeRunnerOnCourse || activeRunnerOnCourse.runId !== firstRunner.runId) {
            activeRunnerOnCourse = firstRunner;
            hasRecordedForCurrentRunner = false;
            if (currentRole === 'VIDEO') {
                showVideoNotification(`LASKIJA LÄHTI: ${firstRunner.name}`);
            }
        } else {
            activeRunnerOnCourse = firstRunner;
        }
    } else {
        activeRunnerOnCourse = null;
        hasRecordedForCurrentRunner = false;
    }

    const newVideoCount = currentSession.results
        ? currentSession.results.reduce((acc, r) => acc + (r.videos ? r.videos.length : 0), 0)
        : 0;

    if (newVideoCount > prevVideoCount && currentSession.results.length > 0) {
        const latestRunner = currentSession.results[0];
        if (typeof showVideoNotification === 'function') {
            showVideoNotification(`VIDEO VALMIS: ${latestRunner.name.toUpperCase()} 🎬`);
        }
    }

    updateUILayout();
    updateUI();
}

async function pollSessionState() {
    if (!currentSession || !currentSession.id) return;

    // First flush any pending events in outbox
    if (getOutbox().length > 0) {
        await flushOutbox();
    }

    try {
        const params = new URLSearchParams({
            action: 'session_state',
            sessionId: currentSession.id,
            v: String(currentSessionVersion),
            deviceId: deviceId
        });

        // Piggyback GPS coordinates at most every 15 seconds if available
        if (userLocation && (Date.now() - lastLocationSentAt > 15000)) {
            params.set('lat', String(userLocation.lat));
            params.set('lon', String(userLocation.lon));
            lastLocationSentAt = Date.now();
        }

        const resp = await fetch(`${API_URL}?${params.toString()}`, { cache: 'no-store' });
        if (!resp.ok) return;

        const data = await resp.json();
        if (data.ended) {
            applyServerSessionState({ ended: true });
            return;
        }

        if (!data.notModified && data.session) {
            applyServerSessionState(data.session);
        }
    } catch (err) {
        // Silent in background during temporary cellular drop
    }
}

function startSessionPolling() {
    stopSessionPolling();
    // Poll every 1.5s for UI updates (timing itself does NOT depend on polling)
    sessionPollTimer = setInterval(pollSessionState, 1500);
}

function stopSessionPolling() {
    if (sessionPollTimer) {
        clearInterval(sessionPollTimer);
        sessionPollTimer = null;
    }
}

// ============================================================================
// API DISPATCHER (Replaces socket.emit calls cleanly)
// ============================================================================

async function handleApiEmit(event, payload) {
    switch (event) {
        case 'sync_time': {
            if (!clockCalibrated) {
                await calibrateClockOnce();
            }
            break;
        }

        case 'create_session': {
            try {
                const resp = await fetch(`${API_URL}?action=create_session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...payload,
                        deviceId: deviceId
                    })
                });
                const data = await resp.json();
                if (data.success && data.session) {
                    currentSessionVersion = data.session.version || 1;
                    handleSessionJoin(data.session, 'VALMENTAJA');
                    startSessionPolling();
                } else {
                    alert('Harjoituksen luonti epäonnistui: ' + (data.error || 'Tuntematon virhe'));
                }
            } catch (e) {
                alert('Palvelimeen ei saatu yhteyttä: ' + e.message);
            }
            break;
        }

        case 'join_session': {
            try {
                const resp = await fetch(`${API_URL}?action=join_session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...payload,
                        deviceId: deviceId,
                        location: userLocation
                    })
                });
                const data = await resp.json();
                if (data.success && data.session) {
                    currentSessionVersion = data.session.version || 1;
                    handleSessionJoin(data.session, data.role);
                    startSessionPolling();
                } else {
                    alert('Liittyminen epäonnistui: ' + (data.error || 'Istuntoa ei löytynyt'));
                    showOnboardingStep('name');
                }
            } catch (e) {
                alert('Liittyminen epäonnistui (verkkovirhe): ' + e.message);
            }
            break;
        }

        case 'find_nearby_sessions':
        case 'get_nearby_sessions': {
            try {
                const lat = payload?.lat ?? userLocation?.lat ?? '';
                const lon = payload?.lon ?? userLocation?.lon ?? '';
                const resp = await fetch(`${API_URL}?action=nearby_sessions&lat=${lat}&lon=${lon}`, {
                    cache: 'no-store'
                });
                if (!resp.ok) return;
                const data = await resp.json();
                renderNearbySessionsList(data.sessions || []);
            } catch (e) {
                // Ignore discovery errors
            }
            break;
        }

        case 'update_location': {
            if (payload && payload.lat && payload.lon) {
                userLocation = {
                    lat: payload.lat,
                    lon: payload.lon,
                    accuracy: payload.accuracy
                };
            }
            break;
        }

        case 'end_session': {
            const sid = typeof payload === 'object' ? payload.sessionId : payload;
            enqueueEvent('end_session', { sessionId: sid });
            break;
        }

        default: {
            // All timing and queue actions go through the offline-safe Outbox
            enqueueEvent(event, typeof payload === 'object' ? payload : { value: payload });
            break;
        }
    }
}

window.handleApiEmit = handleApiEmit;
window.calibrateClockOnce = calibrateClockOnce;
window.enqueueEvent = enqueueEvent;
window.flushOutbox = flushOutbox;

function renderNearbySessionsList(sessions) {
    const listEl = document.getElementById('nearby-sessions-list');
    const container = document.getElementById('nearby-sessions-container');
    if (!listEl || !container) return;

    if (sessions && sessions.length > 0) {
        const filtered = sessions.filter(s => !currentSession || s.id !== currentSession.id);
        if (filtered.length > 0) {
            container.style.display = 'block';
            const manualCont = document.getElementById('manual-join-container');
            const toggleBtn = document.getElementById('btn-toggle-manual');
            if (manualCont) manualCont.style.display = 'none';
            if (toggleBtn) toggleBtn.style.display = 'block';

            listEl.innerHTML = filtered.map(s => `
                <div class="card" onclick="joinNearbySession('${s.id}')" style="padding: 16px; margin: 0 0 10px 0; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; background: rgba(59, 130, 246, 0.1); border-color: var(--accent);">
                    <div>
                        <div style="font-weight: 800; font-size: 16px;">${s.name.toUpperCase()}</div>
                        <div style="font-size: 11px; opacity: 0.6; font-weight: 700;">${s.athleteCount} LASKIJAA</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: 900; color: var(--accent); font-size: 14px;">${s.distance} km</div>
                        <div style="font-size: 9px; opacity: 0.5;">ETÄISYYS</div>
                    </div>
                </div>
            `).join('');
            return;
        }
    }
    container.style.display = 'none';
}

// ============================================================================
// INITIALIZATION ON PAGE LOAD
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Calibrate device monotonic clock ONCE at startup
    await calibrateClockOnce();

    // 2. Flush any leftover offline events from previous run
    flushOutbox();
    setInterval(flushOutbox, 2500);
    window.addEventListener('online', () => {
        if (!clockCalibrated) calibrateClockOnce();
        flushOutbox();
    });

    // 3. Deep link & Onboarding setup
    const deepLinkHandled = (typeof checkDeepLink === 'function') ? checkDeepLink() : false;
    if (typeof startDiscoveryGPS === 'function') startDiscoveryGPS();

    if (userName && document.getElementById('input-profile-name')) {
        document.getElementById('input-profile-name').value = userName;
    }

    if (!deepLinkHandled && typeof showOnboardingStep === 'function') {
        showOnboardingStep('name');
    }
});
