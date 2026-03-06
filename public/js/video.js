// --- Alppikello Video Recording & Uploads ---

function startVideoBuffer(stream) {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    try {
        const types = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
        let supportedType = types.find(t => MediaRecorder.isTypeSupported(t));
        if (!supportedType) return;

        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedType });
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
        mediaRecorder.onstop = () => finalizeVideoSave();
        mediaRecorder.start(1000);

        if (bufferResetTimer) clearTimeout(bufferResetTimer);
        bufferResetTimer = setTimeout(() => {
            if (!activeRunnerOnCourse && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                setTimeout(() => startVideoBuffer(stream), 100);
            }
        }, 20000);
    } catch (e) {
        console.error("MediaRecorder start failed:", e);
    }
}

let pendingRunnerMetadata = null;

function saveVideoClip() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    pendingRunnerMetadata = activeRunnerOnCourse ? { ...activeRunnerOnCourse } : { name: "Tuntematon" };
    mediaRecorder.stop();
}

function finalizeVideoSave() {
    if (recordingChunks.length === 0 && !pendingRunnerMetadata) return;

    const runner = pendingRunnerMetadata || { name: "Tuntematon" };
    pendingRunnerMetadata = null;

    const blob = new Blob(recordingChunks, { type: recordingChunks[0].type });
    const url = URL.createObjectURL(blob);

    recordedClips.unshift({
        name: runner.name,
        url: url,
        time: new Date().toLocaleTimeString(),
        size: Math.round(blob.size / 1024)
    });

    renderVideoGallery();
    showVideoNotification(`VIDEO TALLESSA: ${runner.name.toUpperCase()} 🎬`);
    uploadVideoToServer(blob, runner);

    if (cvStream) startVideoBuffer(cvStream);
}

function uploadVideoToServer(blob, runner) {
    if (!currentSession) return;

    const formData = new FormData();
    const safeRole = (currentRole || 'VIDEO').replace(/[ÄÖ]/g, (m) => m === 'Ä' ? 'A' : 'O').replace(/[^a-zA-Z0-9]/g, '_');
    formData.append('video', blob, `${safeRole}_${runner.name}.mp4`);
    formData.append('sessionId', currentSession.id);
    formData.append('runnerId', runner.id);
    formData.append('runnerName', runner.name);

    fetch('/upload', { method: 'POST', body: formData })
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
