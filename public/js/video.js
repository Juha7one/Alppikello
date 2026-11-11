// --- Alppikello Video Recording & Multi-Camera Timestamp Uploads ---

let pendingRunnerMetadata = null;
let recordingSafetyTimer = null;
let videoCaptureStartTime = 0;

function startVideoBuffer(stream) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    try {
        const types = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
        let supportedType = types.find(t => MediaRecorder.isTypeSupported(t));
        if (!supportedType) return;

        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedType });
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordingChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const runner = pendingRunnerMetadata;
            const captureEndTime = getSyncedTime();
            console.log(`[VIDEO] Recorder stopped. Metadata for: ${runner ? runner.name : 'BUFFER_RESET'}, Chunks: ${recordingChunks.length}`);
            pendingRunnerMetadata = null;

            if (runner && recordingChunks.length > 0) {
                runner.videoCaptureEndTime = captureEndTime;
                processAndSaveVideo(runner, recordingChunks);
            } else if (runner) {
                console.warn("[VIDEO] Skip save: missing chunks for runner", runner.name);
            }

            // Always restart rolling buffer if camera stream is active
            if (cvStream) {
                setTimeout(() => startVideoBuffer(cvStream), 100);
            }
        };

        mediaRecorder.start(1000);
        // CRITICAL: Anchor buffer start to the calibrated monotonic clock
        videoCaptureStartTime = getSyncedTime();

        if (bufferResetTimer) clearTimeout(bufferResetTimer);
        bufferResetTimer = setTimeout(() => {
            // Reset rolling buffer when idle so clips stay compact (~40s max)
            if (!pendingRunnerMetadata && !activeRunnerOnCourse && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, 40000);
    } catch (e) {
        console.error("MediaRecorder start failed:", e);
    }
}

function saveVideoClip(explicitRunner = null, triggerType = 'clip', triggerTime = null) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    const syncedTriggerTime = triggerTime || getSyncedTime();

    // Even if activeRunnerOnCourse is not yet known on this device, record the clip!
    // The PHP backend pairs clips by synchronized [videoStartTime, videoEndTime] overlap.
    const runner = explicitRunner || (activeRunnerOnCourse ? { ...activeRunnerOnCourse } : {
        id: '',
        runId: '',
        name: 'Laskija'
    });

    const isSameRun = pendingRunnerMetadata && runner.runId && pendingRunnerMetadata.runId === runner.runId;
    const captureRole = (isSameRun && pendingRunnerMetadata.captureRole)
        ? pendingRunnerMetadata.captureRole
        : (currentRole || 'VIDEO');

    pendingRunnerMetadata = {
        ...runner,
        triggerType,
        triggerTime: syncedTriggerTime,
        videoCaptureStartTime: videoCaptureStartTime,
        captureRole: captureRole,
        cameraName: userName || captureRole
    };

    // Role-based post-trigger duration
    let safetyDuration = 8000; // Default post-trigger tail (8s after passing camera)
    if (captureRole === 'MAALI') {
        safetyDuration = 4000; // 4s after crossing finish line
    } else if (captureRole === 'LÄHTÖ' || captureRole === 'LÄHETTÄJÄ') {
        safetyDuration = 6000; // 6s after start gate
    }

    const activeRunKey = runner.runId || ('ts_' + syncedTriggerTime);
    pendingRunnerMetadata._stopKey = activeRunKey;

    console.log(`[VIDEO] Trigger for ${runner.name} (Cam: ${pendingRunnerMetadata.cameraName}). Post-trigger tail: ${safetyDuration / 1000}s`);

    if (recordingSafetyTimer) {
        clearTimeout(recordingSafetyTimer);
    }

    recordingSafetyTimer = setTimeout(() => {
        stopRecordingForRun(activeRunKey);
    }, safetyDuration);
}

function stopRecordingForRun(stopKey) {
    if (pendingRunnerMetadata && (pendingRunnerMetadata.runId === stopKey || pendingRunnerMetadata._stopKey === stopKey)) {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log(`[VIDEO] Stopping recording for clip: ${stopKey}`);
            mediaRecorder.requestData();
            setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            }, 100);
        }
        if (recordingSafetyTimer) {
            clearTimeout(recordingSafetyTimer);
            recordingSafetyTimer = null;
        }
    }
}

function stopAndUploadRunVideo(runner) {
    console.log("[VIDEO] stopAndUploadRunVideo skipped - using timestamped clips.");
}

function processAndSaveVideo(runner, chunks) {
    const blob = new Blob(chunks, { type: chunks[0].type });
    console.log(`[VIDEO] Created blob: ${Math.round(blob.size / 1024)} KB, window: [${runner.videoCaptureStartTime} -> ${runner.videoCaptureEndTime}]`);
    const url = URL.createObjectURL(blob);

    recordedClips.unshift({
        name: runner.name || 'Laskija',
        cameraName: runner.cameraName || currentRole || 'VIDEO',
        url: url,
        time: new Date().toLocaleTimeString(),
        size: Math.round(blob.size / 1024)
    });

    if (recordedClips.length > 20) {
        const removed = recordedClips.pop();
        if (removed && removed.url) URL.revokeObjectURL(removed.url);
    }

    renderVideoGallery();
    showVideoNotification(`VIDEO TALLESSA: ${(runner.name || 'LASKIJA').toUpperCase()}`);

    // Try matching runId locally if available, otherwise backend pairs by timestamp window
    if (!runner.runId && currentSession) {
        const candidates = [...(currentSession.onCourse || []), ...(currentSession.results || [])];
        const vStart = runner.videoCaptureStartTime || 0;
        const vEnd = runner.videoCaptureEndTime || getSyncedTime();
        const found = candidates.find(r => {
            if (runner.id && r.id === runner.id) return true;
            const rStart = r.startTime || 0;
            const rEnd = r.finishTime || (rStart + 90000);
            return (vStart <= rEnd + 5000) && (vEnd >= rStart - 5000);
        });
        if (found && found.runId) {
            runner.runId = found.runId;
            runner.name = found.name || runner.name;
        }
    }

    // Upload immediately — no artificial 2000ms delay needed because server pairs by timestamps!
    uploadVideoToServer(blob, runner);
}

function clearVideoGallery() {
    if (confirm("Tyhjennetäänkö laitteen välimuisti videoista?")) {
        recordedClips.forEach(r => URL.revokeObjectURL(r.url));
        recordedClips = [];
        renderVideoGallery();
    }
}

function uploadVideoToServer(blob, runner, retryCount = 0) {
    if (!currentSession) return;

    const formData = new FormData();
    const captureRole = runner.captureRole || currentRole || 'VIDEO';
    const cameraName = runner.cameraName || userName || captureRole;
    const safeRole = cameraName.replace(/[ÄÖäö]/g, (m) => m.toUpperCase() === 'Ä' ? 'A' : 'O').replace(/[^a-zA-Z0-9]/g, '_');

    formData.append('action', 'upload_video');
    formData.append('sessionId', currentSession ? currentSession.id : '');
    formData.append('sessionName', currentSession ? currentSession.name : 'HARJOITUS');
    formData.append('runnerId', runner.id || '');
    formData.append('runId', runner.runId || 'N/A');
    formData.append('runnerName', runner.name || 'LASKIJA');
    formData.append('triggerType', runner.triggerType || 'clip');
    formData.append('triggerTime', String(runner.triggerTime || getSyncedTime()));
    formData.append('videoCaptureStartTime', String(runner.videoCaptureStartTime || 0));
    formData.append('videoCaptureEndTime', String(runner.videoCaptureEndTime || getSyncedTime()));
    formData.append('role', captureRole);
    formData.append('cameraName', cameraName);
    formData.append('video', blob, `${safeRole}_${runner.name || 'Laskija'}.mp4`);

    const uploadUrl = `${API_URL}?action=upload_video`;

    fetch(uploadUrl, { method: 'POST', body: formData })
        .then(async res => {
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Virheellinen palvelinvastaus (${res.status})`);
            }
        })
        .then(data => {
            if (data.success && data.url) {
                console.log("[UPLOAD SUCCESS] Video URL:", data.url, "Paired:", data.paired);
                if (data.session && typeof applyServerSessionState === 'function') {
                    applyServerSessionState(data.session);
                }
            } else {
                console.error("[UPLOAD ERROR] Server returned error:", data);
                showVideoNotification(`VIRHE TALLENNUKSESSA: ${data.error || 'Tuntematon syy'}`);
            }
        })
        .catch(err => {
            console.warn("[UPLOAD RETRY] Video upload failed, retrying in 5s:", err.message);
            if (retryCount < 5) {
                setTimeout(() => uploadVideoToServer(blob, runner, retryCount + 1), 5000);
            } else {
                showVideoNotification("VIDEON LÄHETYS EPÄONNISTUI (Tallennettu laitteelle)");
            }
        });
}

function renderVideoGallery() {
    const gallery = document.getElementById('video-gallery');
    if (!gallery) return;

    if (recordedClips.length === 0) {
        gallery.innerHTML = '<p style="font-size: 14px; opacity: 0.5; text-align: center; padding: 10px;">Ei tallenteita tässä istunnossa.</p>';
        return;
    }

    gallery.innerHTML = recordedClips.map((clip) => `
        <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--accent); margin-bottom: 8px;">
            <div>
                <div style="font-weight: 800; font-size: 14px;">${(clip.name || 'LASKIJA').toUpperCase()} <span style="font-size:10px; color:var(--accent);">(${clip.cameraName || 'VIDEO'})</span></div>
                <div style="font-size: 10px; opacity: 0.5;">${clip.time} • ${clip.size} KB</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-mini" onclick="window.open('${clip.url}')" style="background: var(--accent);">${iconHtml('play_arrow', 'icon-sm')} KATSO</button>
            </div>
        </div>
    `).join('');
}
