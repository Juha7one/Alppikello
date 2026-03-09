// --- Alppikello Computer Vision (Digital Photocell) ---

function stopCV() {
    if (cvStream) {
        cvStream.getTracks().forEach(track => track.stop());
        cvStream = null;
        console.log("[CV] Stopped stream.");
    }
    // Reset overlays across all possible views
    ['start', 'maali', 'väliaika', 'video'].forEach(prefix => {
        const status = document.getElementById(`${prefix}-status-overlay`);
        if (status) {
            status.innerText = "CV POIS PÄÄLTÄ";
            status.style.background = "rgba(0,0,0,0.6)";
        }
    });

    if (bufferResetTimer) {
        clearTimeout(bufferResetTimer);
        bufferResetTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
    }
}

async function initTriggerCV(roleType) {
    if (cvStream) {
        // If already streaming, just re-attach to new role elements without stopping
        console.log(`[CV] Re-targeting existing stream to ${roleType}`);
        await startCV(roleType);
        return;
    }
    await startCV(roleType);
}

async function startCV(roleType) {
    const isStart = roleType === 'lähtö';
    const isFinish = roleType === 'maali';
    const isSplit = roleType === 'väliaika';
    const isVideo = roleType === 'video';

    const videoId = isStart ? 'start-video' : (isFinish ? 'maali-video' : (isSplit ? 'väliaika-video' : 'video-video'));
    const canvasId = isStart ? 'start-overlay' : (isFinish ? 'maali-overlay' : (isSplit ? 'väliaika-overlay' : 'video-overlay'));
    const statusId = isStart ? 'start-status-overlay' : (isFinish ? 'maali-status-overlay' : (isSplit ? 'väliaika-status-overlay' : 'video-status-overlay'));

    const video = document.getElementById(videoId);
    const canvas = document.getElementById(canvasId);
    const status = document.getElementById(statusId);

    if (!video || !canvas) return;

    try {
        if (!cvStream) {
            console.log("[CV] Starting NEW stream");
            cvStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: 640, height: 480 },
                audio: false
            }).catch(() => navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            }));
        } else {
            console.log("[CV] Re-using existing stream");
        }

        video.srcObject = cvStream;
        video.play().catch(e => console.warn("Video play failed:", e));
        
        if (status) {
            status.innerText = "CV AKTIIVINEN";
            status.style.background = "var(--success)";
        }

        // ONLY start buffer if not already recording/buffering
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            startVideoBuffer(cvStream);
        }
        startCVLogic(roleType, video, canvas);
    } catch (err) {
        console.error("Kameravirhe:", err);
        alert("Kameran avaaminen epäonnistui. Varmista luvat.");
    }
}

window.stopCV = stopCV;
window.startCV = startCV;

function startCVLogic(roleType, video, canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const procCanvas = document.createElement('canvas');
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    let triggerType = 'split';
    if (roleType === 'lähtö') triggerType = 'start';
    if (roleType === 'maali') triggerType = 'finish';
    if (roleType === 'video') triggerType = 'video_clip';

    let previousIntensity = -1;
    const threshold = 12; 
    const gateX = 0.5; 

    const processFrame = () => {
        if (!cvStream) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            if (canvas.width !== video.videoWidth) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                procCanvas.width = video.videoWidth / 2;
                procCanvas.height = video.videoHeight / 2;
            }

            procCtx.drawImage(video, 0, 0, procCanvas.width, procCanvas.height);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const x = canvas.width * gateX;
            ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

            const procX = Math.round(procCanvas.width * gateX);
            const imageData = procCtx.getImageData(Math.max(0, procX - 1), 0, 2, procCanvas.height);
            const data = imageData.data;
            let totalB = 0;
            for (let i = 0; i < data.length; i += 4) totalB += (data[i] + data[i + 1] + data[i + 2]) / 3;
            const avgIntensity = totalB / (data.length / 4);

            const now = Date.now();
            const diff = (previousIntensity !== -1) ? Math.abs(avgIntensity - previousIntensity) : 0;

            ctx.fillStyle = "white";
            ctx.font = "bold 18px Courier";
            ctx.fillText(`RAW: ${avgIntensity.toFixed(0)}  DIFF: ${diff.toFixed(1)}`, 15, 30);

            if (previousIntensity !== -1) {
                const meterW = Math.min((diff / 40) * canvas.width, canvas.width);
                ctx.fillStyle = diff > threshold ? "#ef4444" : "#22c55e";
                ctx.fillRect(0, canvas.height - 15, meterW, 15);

                if (diff > threshold && (now - lastTriggerTime > 3000)) {
                    const queueCount = (currentSession.activeQueue || []).length;
                    const onCourseCount = (currentSession.onCourse || []).length;

                    if (roleType === 'video') {
                        // Check if someone is on course OR just finished (within 10s)
                        let runnerToSave = null;
                        if (onCourseCount > 0) {
                            runnerToSave = { ...currentSession.onCourse[0] };
                        } else if ((currentSession.results || []).length > 0) {
                            const lastResult = currentSession.results[0];
                            const timeSinceFinish = now - (lastResult.finishTime || 0);
                            if (timeSinceFinish < 10000) { // 10s grace period for video role
                                runnerToSave = { ...lastResult };
                            }
                        }

                        if (runnerToSave && !hasRecordedForCurrentRunner) {
                            lastTriggerTime = now;
                            hasRecordedForCurrentRunner = true; 
                            showVideoNotification(`TALLENNETAAN: ${runnerToSave.name.toUpperCase()} 📹`);
                            setTimeout(() => saveVideoClip(runnerToSave), 5000);
                            ctx.fillStyle = "rgba(16, 185, 129, 0.6)"; 
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                    } else {
                        let shouldTrigger = false;
                        if (roleType === 'lähtö' && queueCount > 0) shouldTrigger = true;
                        if (roleType === 'maali' && onCourseCount > 0) shouldTrigger = true;
                        if (roleType === 'väliaika' && onCourseCount > 0) shouldTrigger = true;

                        if (shouldTrigger) {
                            // 1. Capture metadata FIRST based on role
                            let runnerToSave = null;
                            if (roleType === 'lähtö') {
                                runnerToSave = currentSession.activeQueue && currentSession.activeQueue[0] ? { ...currentSession.activeQueue[0] } : null;
                                console.log("[CV] Triggered START for:", runnerToSave ? runnerToSave.name : 'NONE');
                            } else {
                                runnerToSave = currentSession.onCourse && currentSession.onCourse[0] ? { ...currentSession.onCourse[0] } : null;
                                console.log(`[CV] Triggered ${roleType.toUpperCase()} for:`, runnerToSave ? runnerToSave.name : 'NONE');
                            }

                            lastTriggerTime = now;
                            simulateTrigger(triggerType);

                            ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                    }
                }
            }
            if (avgIntensity > 0 || previousIntensity === -1) previousIntensity = avgIntensity;
        }
        requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
}
