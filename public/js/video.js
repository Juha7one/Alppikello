// --- Alppikello Video Recording & Uploads ---

let pendingRunnerMetadata = null;

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
            pendingRunnerMetadata = null; // Clear immediately
            
            if (runner && recordingChunks.length > 0) {
                processAndSaveVideo(runner, recordingChunks);
            }
            
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

function saveVideoClip(explicitRunner = null) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    pendingRunnerMetadata = explicitRunner || (activeRunnerOnCourse ? { ...activeRunnerOnCourse } : null);
    if (pendingRunnerMetadata) {
        mediaRecorder.stop();
    }
}

function processAndSaveVideo(runner, chunks) {
    const blob = new Blob(chunks, { type: chunks[0].type });
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
    uploadVideoToServer(blob, runner);
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
    formData.append('sessionId', currentSession.id);
    formData.append('runnerId', runner.id);
    formData.append('runId', runner.runId);
    formData.append('runnerName', runner.name);

    const uploadUrl = (typeof SERVER_URL !== 'undefined' && SERVER_URL) ? `${SERVER_URL}/upload` : '/upload';

    fetch(uploadUrl, { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => console.log("Upload success:", data.url))
        .catch(err => console.error("Upload failed:", err));
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
                <div style="font-weight: 800; font-size: 14px;">${clip.name.toUpperCase()}</div>
                <div style="font-size: 10px; opacity: 0.5;">${clip.time} • ${clip.size} KB</div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-mini" onclick="window.open('${clip.url}')" style="background: var(--accent);">KATSO</button>
            </div>
        </div>
    `).join('');
}
