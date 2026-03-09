// --- Alppikello Video Recording & Uploads ---

let pendingRunnerMetadata = null;
let recordingSafetyTimer = null;

function startVideoBuffer(stream) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    try {
        const types = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
        let supportedType = types.find(t => MediaRecorder.isTypeSupported(t));
        if (!supportedType) return;

        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedType });
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const runner = pendingRunnerMetadata;
            console.log(`[VIDEO] Recorder stopped. Metadata for: ${runner ? runner.name : 'NULL'}, Chunks: ${recordingChunks.length}`);
            pendingRunnerMetadata = null; // Clear immediately
            
            if (runner && recordingChunks.length > 0) {
                processAndSaveVideo(runner, recordingChunks);
            } else if (runner) {
                // Runner was set but no chunks - this is a real issue
                console.warn("[VIDEO] Skip save: missing chunks for runner", runner.name);
            }
            // else: runner is null, this was just a buffer reset or view switch, no need for warning
            
            // Always restart buffer if stream is active
            if (cvStream) {
                setTimeout(() => startVideoBuffer(cvStream), 100);
            }
        };
        mediaRecorder.start(1000);

        if (bufferResetTimer) clearTimeout(bufferResetTimer);
        bufferResetTimer = setTimeout(() => {
            // Buffer reset - just stop, onstop will restart it and skip saving since runner is null
            if (!activeRunnerOnCourse && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, 30000); // 30s buffer
    } catch (e) {
        console.error("MediaRecorder start failed:", e);
    }
}

function saveVideoClip(explicitRunner = null, triggerType = 'clip', triggerTime = null) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    // 1. Capture metadata
    const runner = explicitRunner || (activeRunnerOnCourse ? { ...activeRunnerOnCourse } : null);
    if (!runner) return;

    // 2. Prevent overlapping captures for same runner in same role
    if (pendingRunnerMetadata && pendingRunnerMetadata.runId === runner.runId) return;

    pendingRunnerMetadata = { ...runner, triggerType, triggerTime: triggerTime || Date.now() };
    
    console.log(`[VIDEO] Captured trigger for ${runner.name}. Saving dyna-clip (max 20s)...`);
    
    // 3. Safety timeout: 20 seconds
    if (recordingSafetyTimer) clearTimeout(recordingSafetyTimer);
    recordingSafetyTimer = setTimeout(() => {
        stopRecordingForRun(runner.runId);
    }, 20000);
}

function stopRecordingForRun(runId) {
    if (pendingRunnerMetadata && pendingRunnerMetadata.runId === runId) {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log(`[VIDEO] Stopping recording for run: ${runId}`);
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
    // Deprecated for now, using trigger-based clips
    console.log("[VIDEO] stopAndUploadRunVideo skipped - using clips.");
}

function processAndSaveVideo(runner, chunks) {
    const blob = new Blob(chunks, { type: chunks[0].type });
    console.log(`[VIDEO] Created blob: ${Math.round(blob.size / 1024)} KB, type: ${chunks[0].type}, chunks: ${chunks.length}`);
    const url = URL.createObjectURL(blob);

    recordedClips.unshift({
        name: runner.name,
        url: url,
        time: new Date().toLocaleTimeString(),
        size: Math.round(blob.size / 1024)
    });

    // Limit stored clips to 20 to prevent memory bloat
    if (recordedClips.length > 20) {
        const removed = recordedClips.pop();
        if (removed && removed.url) URL.revokeObjectURL(removed.url);
    }

    renderVideoGallery();
    showVideoNotification(`VIDEO TALLESSA: ${runner.name.toUpperCase()} 🎬`);
    
    // Attempt one last deep search for runId if it was missing during capture
    if (!runner.runId && currentSession) {
        const foundOnCourse = (currentSession.onCourse || []).find(r => r.id === runner.id);
        if (foundOnCourse && foundOnCourse.runId) {
            runner.runId = foundOnCourse.runId;
            console.log("[VIDEO] Late runId recovery success!");
        }
    }

    // Delay upload slightly to ensure the server has processed the timing trigger
    // and generated the runId, and the client has received it back.
    setTimeout(() => {
        // One LAST attempt to recover runId from state before sending
        if (!runner.runId && activeRunnerOnCourse && activeRunnerOnCourse.id === runner.id) {
            runner.runId = activeRunnerOnCourse.runId;
            console.log("[VIDEO] Recovered runId from activeRunnerOnCourse at upload time!");
        }
        uploadVideoToServer(blob, runner);
    }, 1500); // 1.5s delay is safe
}

function clearVideoGallery() {
    if (confirm("Tyhjennetäänkö laitteen välimuisti videoista?")) {
        recordedClips.forEach(r => URL.revokeObjectURL(r.url));
        recordedClips = [];
        renderVideoGallery();
    }
}

function uploadVideoToServer(blob, runner) {
    if (!currentSession) return;

    const formData = new FormData();
    const safeRole = (currentRole || 'VIDEO').replace(/[ÄÖ]/g, (m) => m === 'Ä' ? 'A' : 'O').replace(/[^a-zA-Z0-9]/g, '_');
    formData.append('video', blob, `${safeRole}_${runner.name}.mp4`);
    formData.append('sessionId', currentSession ? currentSession.id : '');
    formData.append('runnerId', runner.id || '');
    formData.append('runId', runner.runId || 'N/A');
    formData.append('runnerName', runner.name || 'LASKIJA');
    formData.append('triggerType', runner.triggerType || 'clip');
    formData.append('triggerTime', runner.triggerTime || Date.now());
    formData.append('role', currentRole || 'unknown');

    if (!runner.runId) {
        console.warn("[VIDEO UPLOAD] Runner runId is missing! Video might not pair correctly.", runner);
    }

    const uploadUrl = (typeof SERVER_URL !== 'undefined' && SERVER_URL) ? `${SERVER_URL}/upload` : '/upload';

    fetch(uploadUrl, { method: 'POST', body: formData })
        .then(async res => {
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Server returned non-JSON: ${text.substring(0, 100)}... (Status: ${res.status})`);
            }
        })
        .then(data => {
            if (data.success && data.url) {
                console.log("[UPLOAD SUCCESS] Video URL:", data.url);
            } else {
                console.error("[UPLOAD ERROR] Server returned error or missing URL:", data);
                showVideoNotification(`VIRHE TALLENNUKSESSA: ${data.error || 'Tuntematon syy'}`);
            }
        })
        .catch(err => {
            console.error("[UPLOAD CRITICAL] Fetch failed:", err.message);
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
                <div style="font-weight: 800; font-size: 14px;">${(clip.name || 'TUNTEMATON').toUpperCase()}</div>
                <div style="font-size: 10px; opacity: 0.5;">${clip.time} • ${clip.size} KB</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-mini" onclick="window.open('${clip.url}')" style="background: var(--accent);">KATSO</button>
            </div>
        </div>
    `).join('');
}
