// --- Alppikello Computer Vision (Digital Photocell) ---

async function initTriggerCV(roleType) {
    const isStart = roleType === 'lähtö';
    const isFinish = roleType === 'maali';
    const isSplit = roleType === 'väliaika';
    const isVideo = roleType === 'video';

    const videoId = isStart ? 'start-video' : (isFinish ? 'maali-video' : (isSplit ? 'väliaika-video' : 'video-video'));
    const canvasId = isStart ? 'start-overlay' : (isFinish ? 'maali-overlay' : (isSplit ? 'väliaika-overlay' : 'video-overlay'));
    const statusId = isStart ? 'start-status-overlay' : (isFinish ? 'maali-status-overlay' : (isSplit ? 'väliaika-status-overlay' : 'video-status-overlay'));
    const btnId = isStart ? 'btn-start-cv' : (isFinish ? 'btn-maali-cv' : (isSplit ? 'btn-väliaika-cv' : 'btn-video-cv'));

    const video = document.getElementById(videoId);
    const canvas = document.getElementById(canvasId);
    const status = document.getElementById(statusId);
    const btn = document.getElementById(btnId);

    if (!video || !canvas) return;

    if (cvStream) {
        cvStream.getTracks().forEach(track => track.stop());
        cvStream = null;
        if (status) {
            status.innerText = "CV POIS PÄÄLTÄ";
            status.style.background = "rgba(0,0,0,0.6)";
        }
        if (btn) {
            btn.innerText = isVideo ? "AKTIVOI KAMERA" : "AKTIVOI KENNO";
            btn.classList.remove('btn-danger');
            btn.classList.add(isStart ? 'btn-primary' : (isFinish ? 'btn-success' : (isSplit ? 'btn-warning' : 'btn-danger')));
        }
        return;
    }

    try {
        try {
            cvStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: 640, height: 480 },
                audio: false
            });
        } catch (e) {
            cvStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
        }

        video.srcObject = cvStream;
        video.play().catch(e => console.warn("Video play failed:", e));
        if (status) {
            status.innerText = "CV AKTIIVINEN";
            status.style.background = "var(--success)";
        }
        if (btn) {
            btn.innerText = "SULJE KAMERA";
            btn.classList.remove('btn-primary', 'btn-success', 'btn-warning');
            btn.classList.add('btn-danger');
        }

        startVideoBuffer(cvStream);
        startCVLogic(roleType, video, canvas);
    } catch (err) {
        console.error("Kameravirhe:", err);
        alert("Kameran avaaminen epäonnistui. Varmista luvat.");
    }
}

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
                        if (onCourseCount > 0 && !hasRecordedForCurrentRunner) {
                            lastTriggerTime = now;
                            hasRecordedForCurrentRunner = true; 
                            showVideoNotification("TALLENNETAAN... 📹");
                            setTimeout(() => saveVideoClip(), 5000);
                            ctx.fillStyle = "rgba(16, 185, 129, 0.6)"; 
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                    } else {
                        let shouldTrigger = false;
                        if (roleType === 'lähtö' && queueCount > 0) shouldTrigger = true;
                        if (roleType === 'maali' && onCourseCount > 0) shouldTrigger = true;
                        if (roleType === 'väliaika' && onCourseCount > 0) shouldTrigger = true;

                        if (shouldTrigger) {
                            lastTriggerTime = now;
                            simulateTrigger(triggerType);
                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                showVideoNotification("TALLENNETAAN... 📹");
                                setTimeout(() => saveVideoClip(), 5000);
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
