// --- Alppikello Ghost Comparison (Alpha Overlay, Wipe, Ghost Stickman & Trigger Sync) + Coach Voice-Over ---

let ghostState = {
    active: false,
    mode: 'alpha',        // 'alpha' | 'wipe' | 'stickman'
    syncMode: 'trigger',  // 'trigger' (Portti-synk) | 'start' (Lähtö T=0)
    opacity: 0.48,
    wipePct: 50,
    mainRun: null,
    mainVideos: [],
    compRun: null,
    compVideos: [],
    compClip: null,
    ghostLandmarks: null,
    lastGhostPoseTime: -1,
    poseBusy: false
};

let ghostPoseEngine = null;
let coachRecorder = null;
let coachRecChunks = [];
let coachRecStream = null;
let coachRecRaf = null;
let isCoachRecording = false;

function initGhostComparisonUI(runData, normalizedMainVideos, telemetryModel) {
    ghostState.mainRun = runData;
    ghostState.mainVideos = normalizedMainVideos || [];
    ghostState.active = false;
    ghostState.compRun = null;
    ghostState.compVideos = [];
    ghostState.ghostLandmarks = null;

    const ghostVideo = document.getElementById('card-ghost-video');
    const wipeLine = document.getElementById('card-ghost-wipe-line');
    const panel = document.getElementById('card-ghost-panel');
    const selectEl = document.getElementById('ghost-run-select');
    const toggleBtn = document.getElementById('btn-toggle-ghost');

    if (ghostVideo) {
        ghostVideo.pause();
        ghostVideo.removeAttribute('src');
        ghostVideo.style.display = 'none';
    }
    if (wipeLine) wipeLine.style.display = 'none';
    if (panel) panel.style.display = 'none';
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.style.background = 'rgba(255,255,255,0.06)';
        toggleBtn.style.borderColor = 'rgba(255,255,255,0.32)';
    }

    if (!selectEl || !telemetryModel) return;

    const selfId = runData.runId || runData.id;
    const candidates = (telemetryModel.validRuns || []).filter(r => (r.runId || r.id) !== selfId);

    if (candidates.length === 0) {
        selectEl.innerHTML = `<option value="">Ei muita laskuja tässä harjoituksessa</option>`;
        return;
    }

    const fastestId = candidates[0] ? (candidates[0].runId || candidates[0].id) : '';
    const myOtherRuns = candidates.filter(r => r.name === runData.name);
    const myBestId = myOtherRuns[0] ? (myOtherRuns[0].runId || myOtherRuns[0].id) : '';

    selectEl.innerHTML = candidates.map(r => {
        const rid = r.runId || r.id;
        const rNum = (telemetryModel.runNumberMap && telemetryModel.runNumberMap[rid]) || '?';
        const diffMs = (Number(r.totalTime) || 0) - (Number(runData.totalTime) || 0);
        const diffSign = diffMs > 0 ? `+${formatDuration(diffMs)}` : `–${formatDuration(Math.abs(diffMs))}`;
        let prefix = '';
        if (rid === fastestId) prefix = '🏆 NOPEIN: ';
        else if (rid === myBestId) prefix = '⭐ OMA PARAS: ';

        return `<option value="${rid}">${prefix}${r.name.toUpperCase()} #${rNum} (${formatDuration(r.totalTime)} s, ${diffSign})</option>`;
    }).join('');
}

async function toggleGhostMode() {
    ghostState.active = !ghostState.active;
    const panel = document.getElementById('card-ghost-panel');
    const toggleBtn = document.getElementById('btn-toggle-ghost');
    const ghostVideo = document.getElementById('card-ghost-video');
    const wipeLine = document.getElementById('card-ghost-wipe-line');

    if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', ghostState.active ? 'true' : 'false');
        toggleBtn.style.border = ghostState.active ? '2px solid #fff' : '2px solid rgba(255,255,255,0.32)';
        toggleBtn.style.background = ghostState.active ? 'var(--accent)' : 'rgba(255,255,255,0.06)';
    }

    if (!ghostState.active) {
        if (panel) panel.style.display = 'none';
        if (ghostVideo) {
            ghostVideo.pause();
            ghostVideo.style.display = 'none';
        }
        if (wipeLine) wipeLine.style.display = 'none';
        ghostState.ghostLandmarks = null;
        return;
    }

    if (panel) panel.style.display = 'block';
    const selectEl = document.getElementById('ghost-run-select');
    if (selectEl && selectEl.value) {
        await loadGhostComparisonRun(selectEl.value);
    }
}

async function openGhostComparisonWith(targetRunId, sectorIndex = null) {
    const selectEl = document.getElementById('ghost-run-select');
    if (selectEl && targetRunId) {
        selectEl.value = targetRunId;
    }
    if (!ghostState.active) {
        await toggleGhostMode();
    } else {
        await loadGhostComparisonRun(targetRunId);
    }
    if (sectorIndex !== null && typeof window.jumpToSectorVideo === 'function') {
        window.jumpToSectorVideo(sectorIndex);
    }
}

async function loadGhostComparisonRun(compRunId) {
    if (!compRunId || !activeTelemetryModel) return;

    let compData = (activeTelemetryModel.validRuns || []).find(r => (r.runId || r.id) === compRunId);

    // Fetch full run card if videos array is missing or empty
    if (!compData || (!Array.isArray(compData.videos) || compData.videos.length === 0)) {
        try {
            const resp = await fetch(`${API_URL}?action=get_run&runId=${encodeURIComponent(compRunId)}`);
            if (resp.ok) {
                const full = await resp.json();
                compData = { ...(compData || {}), ...full };
            }
        } catch (e) {
            console.warn("[GHOST] Could not fetch comparison run details:", e);
        }
    }

    if (!compData) return;

    ghostState.compRun = compData;
    ghostState.compVideos = typeof window.normalizeRunVideos === 'function'
        ? window.normalizeRunVideos(compData)
        : (compData.videos || []);

    matchGhostClipToMainCamera();
    applyGhostVisualStyle();
    syncGhostToMainVideo();
}

function matchGhostClipToMainCamera() {
    const mainVidEl = document.getElementById('card-video');
    const ghostVidEl = document.getElementById('card-ghost-video');
    const statusEl = document.getElementById('ghost-sync-status');
    if (!mainVidEl || !ghostVidEl) return;

    if (!ghostState.compVideos || ghostState.compVideos.length === 0) {
        if (statusEl) statusEl.innerText = 'Vertailulaskussa ei ole videota.';
        ghostVidEl.style.display = 'none';
        return;
    }

    // Find current main clip
    const currentSrc = mainVidEl.getAttribute('src') || mainVidEl.src || '';
    const mainClip = ghostState.mainVideos.find(v => currentSrc.includes(v.url)) || ghostState.mainVideos[0];

    // Match comparison clip by cameraLabel or role, fallback to closest relative start time
    let matched = null;
    if (mainClip) {
        matched = ghostState.compVideos.find(v => v.cameraLabel === mainClip.cameraLabel)
            || ghostState.compVideos.find(v => v.role === mainClip.role);
    }
    if (!matched) {
        matched = ghostState.compVideos[0];
    }

    ghostState.compClip = matched;
    if (ghostVidEl.getAttribute('src') !== matched.url) {
        ghostVidEl.src = matched.url;
        ghostVidEl.load();
    }

    if (statusEl && ghostState.compRun) {
        const syncDesc = ghostState.syncMode === 'trigger'
            ? 'Portti-synkronoitu (ohittavat kameran yhtä aikaa)'
            : 'Lähtö-synkronoitu (T=0 lähtöportista)';
        statusEl.innerText = `Haamu: ${ghostState.compRun.name.toUpperCase()} (${matched.cameraLabel}) • ${syncDesc}`;
    }
}

function setGhostVisualMode(mode) {
    ghostState.mode = mode;
    ['alpha', 'wipe', 'stickman'].forEach(m => {
        const btn = document.getElementById(`ghost-mode-${m}`);
        if (btn) {
            const active = m === mode;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.style.background = active ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
            btn.style.borderColor = active ? '#fff' : 'rgba(255,255,255,0.22)';
        }
    });

    if (mode === 'stickman' && !strickmanActive && typeof window.toggleStickman === 'function') {
        window.toggleStickman();
    }

    applyGhostVisualStyle();
    syncGhostToMainVideo();
}

function setGhostSyncMode(syncMode) {
    ghostState.syncMode = syncMode;
    ['trigger', 'start'].forEach(sm => {
        const btn = document.getElementById(`ghost-sync-${sm}`);
        if (btn) {
            const active = sm === syncMode;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.style.background = active ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
            btn.style.borderColor = active ? '#fff' : 'rgba(255,255,255,0.22)';
        }
    });
    matchGhostClipToMainCamera();
    syncGhostToMainVideo();
}

function setGhostSliderValue(val) {
    const num = Number(val);
    if (ghostState.mode === 'wipe') {
        ghostState.wipePct = Math.max(5, Math.min(95, num));
    } else {
        ghostState.opacity = Math.max(0.1, Math.min(0.9, num / 100));
    }
    applyGhostVisualStyle();
}

function applyGhostVisualStyle() {
    const ghostVideo = document.getElementById('card-ghost-video');
    const wipeLine = document.getElementById('card-ghost-wipe-line');
    const sliderLabel = document.getElementById('ghost-slider-label');
    const sliderEl = document.getElementById('ghost-blend-slider');
    if (!ghostVideo) return;

    if (!ghostState.active || !ghostState.compClip) {
        ghostVideo.style.display = 'none';
        if (wipeLine) wipeLine.style.display = 'none';
        return;
    }

    ghostVideo.style.display = 'block';

    if (ghostState.mode === 'alpha') {
        ghostVideo.style.opacity = String(ghostState.opacity);
        ghostVideo.style.clipPath = 'none';
        ghostVideo.style.filter = 'contrast(1.18) saturate(1.25)';
        if (wipeLine) wipeLine.style.display = 'none';
        if (sliderLabel) sliderLabel.innerText = `HAAMUN LÄPINÄKYVYYS: ${Math.round(ghostState.opacity * 100)}%`;
        if (sliderEl) sliderEl.value = String(Math.round(ghostState.opacity * 100));
    } else if (ghostState.mode === 'wipe') {
        ghostVideo.style.opacity = '1';
        ghostVideo.style.filter = 'none';
        ghostVideo.style.clipPath = `inset(0 0 0 ${ghostState.wipePct}%)`;
        if (wipeLine) {
            wipeLine.style.display = 'block';
            wipeLine.style.left = `${ghostState.wipePct}%`;
        }
        if (sliderLabel) sliderLabel.innerText = `JAETUN RUUDUN RAJA: ${Math.round(ghostState.wipePct)}%`;
        if (sliderEl) sliderEl.value = String(Math.round(ghostState.wipePct));
    } else if (ghostState.mode === 'stickman') {
        // Hide video pixels but keep decoding frames for MediaPipe Pose
        ghostVideo.style.opacity = '0.01';
        ghostVideo.style.clipPath = 'none';
        if (wipeLine) wipeLine.style.display = 'none';
        if (sliderLabel) sliderLabel.innerText = 'HAAMU-LUURANKO (KELTAINEN) PÄÄLLÄ';
    }
}

/**
 * Computes exact target currentTime on the comparison video clip for the current main video frame.
 */
function syncGhostToMainVideo() {
    if (!ghostState.active || !ghostState.compClip) return;
    const mainVid = document.getElementById('card-video');
    const ghostVid = document.getElementById('card-ghost-video');
    if (!mainVid || !ghostVid) return;

    const currentSrc = mainVid.getAttribute('src') || mainVid.src || '';
    const mainClip = ghostState.mainVideos.find(v => currentSrc.includes(v.url)) || ghostState.mainVideos[0];
    const compClip = ghostState.compClip;
    if (!mainClip || !compClip) return;

    let targetCompSec = mainVid.currentTime || 0;

    if (ghostState.syncMode === 'trigger') {
        // Anchor both clips so their CV trigger moments align on the exact same frame
        const mainTrigOffsetSec = (mainClip.triggerTime && mainClip.videoStartTime)
            ? (mainClip.triggerTime - mainClip.videoStartTime) / 1000
            : 4.0;
        const compTrigOffsetSec = (compClip.triggerTime && compClip.videoStartTime)
            ? (compClip.triggerTime - compClip.videoStartTime) / 1000
            : 4.0;
        const relToTrigger = (mainVid.currentTime || 0) - mainTrigOffsetSec;
        targetCompSec = compTrigOffsetSec + relToTrigger;
    } else {
        // Start-synced (T=0 from start gate)
        const raceSec = typeof window.getVideoRaceTimeSec === 'function'
            ? window.getVideoRaceTimeSec(mainVid)
            : (mainVid.currentTime || 0);
        const compStart = Number(ghostState.compRun && ghostState.compRun.startTime) || 0;
        if (compStart > 0 && compClip.videoStartTime > 0) {
            const targetAbsMs = compStart + raceSec * 1000;
            targetCompSec = (targetAbsMs - compClip.videoStartTime) / 1000;
        }
    }

    const dur = ghostVid.duration || 20;
    const clampedSec = Math.max(0, Math.min(dur - 0.05, targetCompSec));
    ghostVid.playbackRate = mainVid.playbackRate || 1.0;

    if (Math.abs((ghostVid.currentTime || 0) - clampedSec) > 0.09 || mainVid.paused) {
        try { ghostVid.currentTime = clampedSec; } catch (e) {}
    }

    if (!mainVid.paused && ghostVid.paused && targetCompSec >= 0 && targetCompSec <= dur) {
        ghostVid.play().catch(() => {});
    } else if (mainVid.paused && !ghostVid.paused) {
        ghostVid.pause();
    }

    // Trigger Ghost Stickman pose extraction if in stickman mode
    if (ghostState.mode === 'stickman') {
        processGhostStickmanFrame(ghostVid);
    }
}

async function processGhostStickmanFrame(ghostVid) {
    if (!ghostVid || ghostVid.readyState < 2 || ghostState.poseBusy) return;
    if (Math.abs(ghostVid.currentTime - ghostState.lastGhostPoseTime) < 0.03) return;

    if (!ghostPoseEngine && window.Pose) {
        ghostPoseEngine = new window.Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });
        ghostPoseEngine.setOptions({
            modelComplexity: 0,
            smoothLandmarks: true,
            minDetectionConfidence: 0.15,
            minTrackingConfidence: 0.15
        });
        ghostPoseEngine.onResults((res) => {
            if (res && res.poseLandmarks) {
                ghostState.ghostLandmarks = res.poseLandmarks;
            }
        });
    }

    if (ghostPoseEngine) {
        ghostState.poseBusy = true;
        try {
            await ghostPoseEngine.send({ image: ghostVid });
            ghostState.lastGhostPoseTime = ghostVid.currentTime;
        } catch (e) {}
        ghostState.poseBusy = false;
    }
}

function drawGhostStickmanIfActive(ctx, w, h) {
    if (!ghostState.active || !ghostState.ghostLandmarks || !window.drawConnectors || !window.POSE_CONNECTIONS) return;
    ctx.save();
    window.drawConnectors(ctx, ghostState.ghostLandmarks, window.POSE_CONNECTIONS, {
        color: 'rgba(245, 158, 11, 0.9)',
        lineWidth: 3.5
    });
    if (window.drawLandmarks) {
        window.drawLandmarks(ctx, ghostState.ghostLandmarks, {
            color: '#fde047',
            lineWidth: 1.5,
            radius: 3
        });
    }
    ctx.restore();
}

// ============================================================================
// COACH VOICE-OVER VIDEO REVIEW RECORDER
// ============================================================================

async function toggleCoachVoiceOverRecording() {
    const btn = document.getElementById('btn-coach-voiceover');
    if (isCoachRecording) {
        stopCoachVoiceOverRecording();
        return;
    }

    const mainVid = document.getElementById('card-video');
    const ghostVid = document.getElementById('card-ghost-video');
    const aiCvs = document.getElementById('card-ai-canvas');
    if (!mainVid) return;

    try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const compCanvas = document.createElement('canvas');
        compCanvas.width = 960;
        compCanvas.height = 540;
        const compCtx = compCanvas.getContext('2d');

        isCoachRecording = true;
        coachRecChunks = [];

        const renderCompositeFrame = () => {
            if (!isCoachRecording) return;
            compCtx.fillStyle = '#000';
            compCtx.fillRect(0, 0, compCanvas.width, compCanvas.height);

            if (mainVid.readyState >= 2) {
                compCtx.drawImage(mainVid, 0, 0, compCanvas.width, compCanvas.height);
            }
            if (ghostState.active && ghostVid && ghostVid.readyState >= 2 && ghostState.mode !== 'stickman') {
                compCtx.save();
                compCtx.globalAlpha = ghostState.mode === 'alpha' ? ghostState.opacity : 1.0;
                compCtx.drawImage(ghostVid, 0, 0, compCanvas.width, compCanvas.height);
                compCtx.restore();
            }
            if (aiCvs) {
                compCtx.drawImage(aiCvs, 0, 0, compCanvas.width, compCanvas.height);
            }
            coachRecRaf = requestAnimationFrame(renderCompositeFrame);
        };
        renderCompositeFrame();

        const videoStream = compCanvas.captureStream(30);
        coachRecStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);

        const mime = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
        coachRecorder = new MediaRecorder(coachRecStream, mime ? { mimeType: mime } : undefined);
        coachRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) coachRecChunks.push(e.data);
        };
        coachRecorder.onstop = () => {
            audioStream.getTracks().forEach(t => t.stop());
            if (coachRecChunks.length > 0) {
                const blob = new Blob(coachRecChunks, { type: coachRecorder.mimeType || 'video/webm' });
                const url = URL.createObjectURL(blob);
                const dlBox = document.getElementById('coach-voiceover-result');
                if (dlBox) {
                    dlBox.style.display = 'flex';
                    dlBox.innerHTML = `
                        <span style="font-size: 12px; font-weight: 800; color: #4ade80;">🎙️ Palautevideo valmis!</span>
                        <a href="${url}" download="Valmentajan_analyysi_${(ghostState.mainRun?.name || 'lasku')}.webm"
                           style="background: var(--accent); color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 900; text-decoration: none;">
                           LATAA / JAA PALAUTEVIDEO
                        </a>
                    `;
                }
            }
        };

        coachRecorder.start(500);
        if (btn) {
            btn.setAttribute('aria-pressed', 'true');
            btn.style.background = '#ef4444';
            btn.style.borderColor = '#fff';
            btn.innerHTML = `${iconHtml('stop_circle', 'icon-sm')} <span>LOPETA ÄÄNITYS</span>`;
        }
    } catch (err) {
        alert("Mikrofonilupa tarvitaan valmentajan äänipalautteen tallennukseen.");
    }
}

function stopCoachVoiceOverRecording() {
    isCoachRecording = false;
    if (coachRecRaf) cancelAnimationFrame(coachRecRaf);
    if (coachRecorder && coachRecorder.state !== 'inactive') {
        coachRecorder.stop();
    }
    const btn = document.getElementById('btn-coach-voiceover');
    if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        btn.style.background = 'rgba(255,255,255,0.06)';
        btn.style.borderColor = 'rgba(255,255,255,0.32)';
        btn.innerHTML = `${iconHtml('mic', 'icon-sm')} <span>ÄÄNITÄ PALAUTE</span>`;
    }
}

window.initGhostComparisonUI = initGhostComparisonUI;
window.toggleGhostMode = toggleGhostMode;
window.openGhostComparisonWith = openGhostComparisonWith;
window.loadGhostComparisonRun = loadGhostComparisonRun;
window.matchGhostClipToMainCamera = matchGhostClipToMainCamera;
window.setGhostVisualMode = setGhostVisualMode;
window.setGhostSyncMode = setGhostSyncMode;
window.setGhostSliderValue = setGhostSliderValue;
window.syncGhostToMainVideo = syncGhostToMainVideo;
window.drawGhostStickmanIfActive = drawGhostStickmanIfActive;
window.toggleCoachVoiceOverRecording = toggleCoachVoiceOverRecording;
