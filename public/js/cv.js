// --- Alppikello Computer Vision (Digital Photocell) ---
let currentCVRole = null;

function stopCV() {
    if (cvStream) {
        cvStream.getTracks().forEach(track => track.stop());
        cvStream = null;
        console.log("[CV] Stopped stream.");
    }
    // Reset overlays across all possible views
    ['start', 'starter', 'maali', 'väliaika', 'video'].forEach(prefix => {
        const status = document.getElementById(`${prefix}-status-overlay`);
        if (status) {
            status.innerText = "CV POIS PÄÄLTÄ";
            status.style.background = "rgba(0,0,0,0.75)";
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
        console.log(`[CV] Re-targeting existing stream to ${roleType}`);
        await startCV(roleType);
        return;
    }
    await startCV(roleType);
}

function getCVDomIds(roleType) {
    if (roleType === 'lähtö') {
        return { videoId: 'start-video', canvasId: 'start-overlay', statusId: 'start-status-overlay' };
    }
    if (roleType === 'lähettäjä') {
        return { videoId: 'starter-video', canvasId: 'starter-overlay', statusId: 'starter-status-overlay' };
    }
    if (roleType === 'maali') {
        return { videoId: 'maali-video', canvasId: 'maali-overlay', statusId: 'maali-status-overlay' };
    }
    if (roleType === 'väliaika') {
        return { videoId: 'väliaika-video', canvasId: 'väliaika-overlay', statusId: 'väliaika-status-overlay' };
    }
    return { videoId: 'video-video', canvasId: 'video-overlay', statusId: 'video-status-overlay' };
}

async function startCV(roleType) {
    const { videoId, canvasId, statusId } = getCVDomIds(roleType);

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
    currentCVRole = roleType;
    const isStart = (roleType === 'lähtö' || roleType === 'lähettäjä');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const procCanvas = document.createElement('canvas');
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    let triggerType = 'split';
    if (isStart) triggerType = 'start';
    if (roleType === 'maali') triggerType = 'finish';
    if (roleType === 'video') triggerType = 'video_clip';

    let previousIntensity = -1;
    let lastEcoFrameAt = 0;
    const threshold = 12; 
    const gateX = 0.5; 

    const { statusId } = getCVDomIds(roleType);
    const statusBadge = document.getElementById(statusId);

    const processFrame = () => {
        if (!cvStream || currentCVRole !== roleType) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Cold-Weather Battery Saver: Throttle pixel analysis to ~4fps when course/queue is idle
        const isEcoIdle = (typeof shouldThrottleCV === 'function') && shouldThrottleCV(roleType);
        const perfNow = performance.now();
        if (isEcoIdle && (perfNow - lastEcoFrameAt < 250)) {
            requestAnimationFrame(processFrame);
            return;
        }
        lastEcoFrameAt = perfNow;

        const queueCount = currentSession ? (currentSession.activeQueue || []).length : 0;
        const onCourseCount = currentSession ? (currentSession.onCourse || []).length : 0;
        const isArmingDelay = isStart && (Date.now() < (window.starterArmingUntil || 0));
        const isCourseBusyForStart = isStart && queueCount > 0 && onCourseCount > 0;

        if (statusBadge) {
            if (isCourseBusyForStart) {
                statusBadge.innerText = "RATA VARATTU (ODOTTAA)";
                statusBadge.style.background = "var(--danger)";
            } else if (isArmingDelay) {
                statusBadge.innerText = "LÄHTÖMERKKI KÄYNNISSÄ...";
                statusBadge.style.background = "var(--warning)";
            } else if (isEcoIdle) {
                statusBadge.innerText = "CV ECO (4 FPS)";
                statusBadge.style.background = "rgba(16, 185, 129, 0.55)";
            } else {
                statusBadge.innerText = "CV AKTIIVINEN (60 FPS)";
                statusBadge.style.background = "var(--success)";
            }
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
            ctx.strokeStyle = isArmingDelay ? "rgba(245, 158, 11, 0.7)" : "rgba(255, 255, 255, 0.45)";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

            const procX = Math.round(procCanvas.width * gateX);
            const imageData = procCtx.getImageData(Math.max(0, procX - 1), 0, 2, procCanvas.height);
            const data = imageData.data;
            let totalB = 0;
            for (let i = 0; i < data.length; i += 4) totalB += (data[i] + data[i + 1] + data[i + 2]) / 3;
            const avgIntensity = totalB / (data.length / 4);

            // Reset baseline during arming delay or when course is busy so movement while settling doesn't trigger
            if (isArmingDelay || isCourseBusyForStart) {
                previousIntensity = avgIntensity;
                requestAnimationFrame(processFrame);
                return;
            }

            const now = getSyncedTime();
            const diff = (previousIntensity !== -1) ? Math.abs(avgIntensity - previousIntensity) : 0;

            ctx.fillStyle = "white";
            ctx.font = "bold 18px Courier";
            ctx.fillText(`RAW: ${avgIntensity.toFixed(0)}  DIFF: ${diff.toFixed(1)}${isEcoIdle ? ' [ECO]' : ''}`, 15, 30);

            if (previousIntensity !== -1) {
                const meterW = Math.min((diff / 40) * canvas.width, canvas.width);
                ctx.fillStyle = diff > threshold ? "#ef4444" : "#22c55e";
                ctx.fillRect(0, canvas.height - 15, meterW, 15);

                if (diff > threshold && (now - lastTriggerTime > 3000) && currentSession) {
                    if (roleType === 'video') {
                        let runnerToSave = null;
                        if (onCourseCount > 0) {
                            runnerToSave = { ...currentSession.onCourse[0] };
                        } else if ((currentSession.results || []).length > 0) {
                            const lastResult = currentSession.results[0];
                            const timeSinceFinish = now - (lastResult.finishTime || 0);
                            if (timeSinceFinish < 10000) {
                                runnerToSave = { ...lastResult };
                            }
                        }

                        if (runnerToSave && !hasRecordedForCurrentRunner) {
                            lastTriggerTime = now;
                            hasRecordedForCurrentRunner = true; 
                            showVideoNotification(`TALLENNETAAN: ${runnerToSave.name.toUpperCase()}`);
                            saveVideoClip(runnerToSave, 'video_clip', now);
                            ctx.fillStyle = "rgba(16, 185, 129, 0.6)"; 
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                    } else {
                        let shouldTrigger = false;
                        // Start gate triggers ONLY when a skier is in queue AND course is clear
                        if (isStart && queueCount > 0 && onCourseCount === 0) shouldTrigger = true;
                        if (roleType === 'maali' && onCourseCount > 0) shouldTrigger = true;
                        if (roleType === 'väliaika' && onCourseCount > 0) shouldTrigger = true;

                        if (shouldTrigger) {
                            let runnerToSave = null;
                            if (isStart) {
                                runnerToSave = currentSession.activeQueue && currentSession.activeQueue[0] ? { ...currentSession.activeQueue[0] } : null;
                                console.log("[CV] Triggered START for:", runnerToSave ? runnerToSave.name : 'NONE');
                            } else {
                                runnerToSave = currentSession.onCourse && currentSession.onCourse[0] ? { ...currentSession.onCourse[0] } : null;
                                console.log(`[CV] Triggered ${roleType.toUpperCase()} for:`, runnerToSave ? runnerToSave.name : 'NONE');
                            }

                            lastTriggerTime = now;
                            simulateTrigger(triggerType, now);

                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                saveVideoClip(runnerToSave, triggerType, now);
                            }

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
