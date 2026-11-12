// --- Alppikello Biomechanics AI v2, Frame-by-Frame & Pro Drawing Tools ---
let strickmanActive = false;
let poseEngine = null;
let aiCanvas = null;
let aiCtx = null;
let aiVideo = null;
let aiRafId = null;

let lastProcessedTime = -1;
let forceProcess = false;
let lastPoseLandmarks = null;
let smoothedLandmarks = null;
let lastPoseTime = 0;

// CoM Trajectory & Turn Apex History
let comTrail = []; // [{x, y, t, lean, angulation}]
let apexHistory = []; // [{timeSec, leanDeg, angDeg, kneeMinDeg}]

// Drawing state: 'free' | 'line' | 'angle'
let isDrawing = false;
let drawingModeActive = false;
let currentDrawTool = 'free';
let drawings = []; // [{type: 'free'|'line'|'angle', points: [{x,y}], angleDeg?: number}]
let drawPath = [];
let pendingAnglePoints = [];

// A-B Turn Loop state
let turnLoopActive = false;
let turnLoopStart = 0;
let turnLoopEnd = 0;

function calcAngle2D(a, b, c) {
    if (!a || !b || !c) return null;
    const abx = a.x - b.x;
    const aby = a.y - b.y;
    const cbx = c.x - b.x;
    const cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
    if (mag < 1e-5) return null;
    const cos = Math.max(-1, Math.min(1, dot / mag));
    return Math.round((Math.acos(cos) * 180) / Math.PI);
}

function smoothPoseLandmarks(raw, alpha = 0.65) {
    if (!raw) return null;
    if (!smoothedLandmarks || smoothedLandmarks.length !== raw.length) {
        smoothedLandmarks = raw.map(p => ({ ...p }));
        return smoothedLandmarks;
    }
    smoothedLandmarks = raw.map((p, i) => {
        const prev = smoothedLandmarks[i] || p;
        return {
            x: prev.x + alpha * (p.x - prev.x),
            y: prev.y + alpha * (p.y - prev.y),
            z: (prev.z || 0) + alpha * ((p.z || 0) - (prev.z || 0)),
            visibility: p.visibility
        };
    });
    return smoothedLandmarks;
}

function computeSkiBiomechanics(lm) {
    if (!lm || lm.length < 29) return null;
    const lSh = lm[11], rSh = lm[12];
    const lHip = lm[23], rHip = lm[24];
    const lKnee = lm[25], rKnee = lm[26];
    const lAnk = lm[27], rAnk = lm[28];

    const leftKneeDeg = calcAngle2D(lHip, lKnee, lAnk);
    const rightKneeDeg = calcAngle2D(rHip, rKnee, rAnk);

    const midSh = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 };
    const midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
    const midKnee = { x: (lKnee.x + rKnee.x) / 2, y: (lKnee.y + rKnee.y) / 2 };
    const midAnk = { x: (lAnk.x + rAnk.x) / 2, y: (lAnk.y + rAnk.y) / 2 };

    // Hip Angulation ("C-curve"): 180° - angle(midShoulder, midHip, midKnee)
    const rawBodyAngle = calcAngle2D(midSh, midHip, midKnee);
    const hipAngulationDeg = rawBodyAngle !== null ? Math.max(0, 180 - rawBodyAngle) : 0;

    // Whole-body Lean Angle relative to vertical (Ankle midpoint -> Hip midpoint)
    const dx = midHip.x - midAnk.x;
    const dy = midAnk.y - midHip.y; // positive upwards
    const leanRad = Math.atan2(dx, Math.max(0.01, dy));
    const leanSignedDeg = Math.round((leanRad * 180) / Math.PI);
    const leanAbsDeg = Math.abs(leanSignedDeg);
    const leanDir = leanSignedDeg > 3 ? 'Oik' : (leanSignedDeg < -3 ? 'Vas' : 'Suora');

    // Shin Parallelism (A-Frame detection): angle difference between left and right shin vectors
    const lShinAngle = (Math.atan2(lAnk.y - lKnee.y, lAnk.x - lKnee.x) * 180) / Math.PI;
    const rShinAngle = (Math.atan2(rAnk.y - rKnee.y, rAnk.x - rKnee.x) * 180) / Math.PI;
    let shinDeltaDeg = Math.round(Math.abs(lShinAngle - rShinAngle));
    if (shinDeltaDeg > 180) shinDeltaDeg = 360 - shinDeltaDeg;

    // Shoulder vs Hip horizon tilt difference
    const shTilt = (Math.atan2(rSh.y - lSh.y, rSh.x - lSh.x) * 180) / Math.PI;
    const hipTilt = (Math.atan2(rHip.y - lHip.y, rHip.x - lHip.x) * 180) / Math.PI;
    const horizonDiffDeg = Math.round(Math.abs(shTilt - hipTilt));

    return {
        leftKneeDeg,
        rightKneeDeg,
        hipAngulationDeg,
        leanAbsDeg,
        leanSignedDeg,
        leanDir,
        shinDeltaDeg,
        horizonDiffDeg,
        midSh,
        midHip,
        midKnee,
        midAnk,
        lSh, rSh, lHip, rHip, lKnee, rKnee, lAnk, rAnk
    };
}

function toggleStickman() {
    strickmanActive = !strickmanActive;
    const btn = document.getElementById('btn-toggle-ai');
    const panel = document.getElementById('card-biomech-panel');

    if (btn) {
        btn.setAttribute('aria-pressed', strickmanActive ? 'true' : 'false');
        btn.style.border = strickmanActive ? "2px solid #fff" : "2px solid rgba(255,255,255,0.32)";
        btn.style.background = strickmanActive ? "var(--accent)" : "rgba(255,255,255,0.06)";
    }
    if (panel) {
        panel.style.display = strickmanActive ? 'block' : 'none';
    }

    if (strickmanActive) {
        comTrail = [];
        apexHistory = [];
        forceProcess = true;
        startAI();
    } else {
        stopAI();
    }
}

function initCanvasContexts() {
    aiVideo = document.getElementById('card-video');
    aiCanvas = document.getElementById('card-ai-canvas');
    if (aiCanvas) {
        aiCtx = aiCanvas.getContext('2d');
        if (aiVideo) {
            const rect = aiVideo.getBoundingClientRect();
            if (rect.width > 0) {
                aiCanvas.width = Math.floor(rect.width);
                aiCanvas.height = Math.floor(rect.height);
            }
        }
    }
}

function toggleDrawingMode(tool = null) {
    if (tool && drawingModeActive && currentDrawTool !== tool) {
        currentDrawTool = tool;
    } else if (tool && !drawingModeActive) {
        currentDrawTool = tool;
        drawingModeActive = true;
    } else {
        drawingModeActive = !drawingModeActive;
    }

    pendingAnglePoints = [];
    const btn = document.getElementById('btn-toggle-draw');
    const cvs = document.getElementById('card-ai-canvas');
    const toolbar = document.getElementById('card-draw-subtools');

    if (drawingModeActive) {
        initCanvasContexts();
    }

    if (btn) {
        btn.setAttribute('aria-pressed', drawingModeActive ? 'true' : 'false');
        btn.style.border = drawingModeActive ? "2px solid #fff" : "2px solid rgba(255,255,255,0.32)";
        btn.style.background = drawingModeActive ? "var(--accent)" : "rgba(255,255,255,0.06)";
    }
    if (toolbar) {
        toolbar.style.display = drawingModeActive ? 'flex' : 'none';
        ['free', 'line', 'angle'].forEach(t => {
            const tBtn = document.getElementById(`draw-tool-${t}`);
            if (tBtn) {
                const active = currentDrawTool === t;
                tBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
                tBtn.style.background = active ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
                tBtn.style.borderColor = active ? '#fff' : 'rgba(255,255,255,0.22)';
            }
        });
    }

    if (cvs) {
        cvs.style.pointerEvents = drawingModeActive ? "auto" : "none";
    }
}

function selectDrawTool(tool) {
    currentDrawTool = tool;
    pendingAnglePoints = [];
    toggleDrawingMode(tool);
}

function startAI() {
    initCanvasContexts();
    if (!aiVideo || !aiCanvas) return;

    const rect = aiVideo.getBoundingClientRect();
    if (rect.width > 0 && (aiCanvas.width !== Math.floor(rect.width) || aiCanvas.height !== Math.floor(rect.height))) {
        aiCanvas.width = Math.floor(rect.width);
        aiCanvas.height = Math.floor(rect.height);
    }

    if (!poseEngine && window.Pose) {
        poseEngine = new window.Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        poseEngine.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.15,
            minTrackingConfidence: 0.15
        });

        poseEngine.onResults(onPoseResults);
    }

    if (poseEngine) {
        if (aiRafId) cancelAnimationFrame(aiRafId);
        aiLoop();
    }
}

function stopAI() {
    if (aiRafId) cancelAnimationFrame(aiRafId);
    if (aiCtx && aiCanvas) {
        aiCtx.clearRect(0, 0, aiCanvas.width, aiCanvas.height);
        redrawUserLines();
    }
}

async function aiLoop() {
    if (!strickmanActive || !poseEngine || !aiVideo) return;

    const currentTime = aiVideo.currentTime;
    const shouldProcess = (aiVideo.readyState >= 2) && (
        (!aiVideo.paused && !aiVideo.ended) ||
        (Math.abs(currentTime - lastProcessedTime) > 0.008) ||
        forceProcess
    );

    if (shouldProcess) {
        try {
            await poseEngine.send({ image: aiVideo });
            lastProcessedTime = currentTime;
            forceProcess = false;
        } catch (e) {
            if (e.name === 'SecurityError' || (e.message && e.message.includes('tainted'))) {
                if (aiCtx && aiCanvas) {
                    aiCtx.clearRect(0, 0, aiCanvas.width, aiCanvas.height);
                    aiCtx.fillStyle = 'rgba(239, 68, 68, 0.9)';
                    aiCtx.fillRect(10, 10, 240, 50);
                    aiCtx.font = "bold 12px Inter, sans-serif";
                    aiCtx.fillStyle = '#fff';
                    aiCtx.fillText("CORS-ESTO VIDEOSSA", 20, 30);
                }
            }
        }
    }

    aiRafId = requestAnimationFrame(aiLoop);
}

function renderBiomechOverlays(ctx, w, h, bio) {
    if (!bio) return;

    // 1. CoM Comet Trail (Hip midpoint history)
    const cx = bio.midHip.x * w;
    const cy = bio.midHip.y * h;
    const vTime = aiVideo ? aiVideo.currentTime : 0;

    if (comTrail.length === 0 || Math.hypot(cx - comTrail[comTrail.length - 1].x, cy - comTrail[comTrail.length - 1].y) > 2) {
        // Reset trail if video scrubbed backwards significantly
        if (comTrail.length > 0 && Math.abs(vTime - comTrail[comTrail.length - 1].t) > 1.2) {
            comTrail = [];
        }
        comTrail.push({ x: cx, y: cy, t: vTime, lean: bio.leanAbsDeg });
        if (comTrail.length > 42) comTrail.shift();
    }

    if (comTrail.length > 2) {
        for (let i = 1; i < comTrail.length; i++) {
            const p0 = comTrail[i - 1];
            const p1 = comTrail[i];
            const alpha = (i / comTrail.length) * 0.85;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = p1.lean > 28 ? `rgba(56, 189, 248, ${alpha})` : `rgba(250, 204, 21, ${alpha})`;
            ctx.lineWidth = 3 + (i / comTrail.length) * 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }

    // 2. Shoulder & Hip Horizon Reference Lines (Spot inside shoulder drop)
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    ctx.moveTo(bio.lSh.x * w, bio.lSh.y * h);
    ctx.lineTo(bio.rSh.x * w, bio.rSh.y * h);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.beginPath();
    ctx.moveTo(bio.lHip.x * w, bio.lHip.y * h);
    ctx.lineTo(bio.rHip.x * w, bio.rHip.y * h);
    ctx.stroke();
    ctx.restore();

    // 3. On-Canvas Joint Angle Badges (Left/Right Knee + Hip Angulation)
    const drawBadge = (normPt, text, bgColor, offsetX = 10, offsetY = 0) => {
        if (!normPt || normPt.visibility < 0.25) return;
        const px = Math.max(8, Math.min(w - 58, normPt.x * w + offsetX));
        const py = Math.max(18, Math.min(h - 10, normPt.y * h + offsetY));
        ctx.font = "900 11px Inter, monospace";
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.roundRect(px - 4, py - 12, tw + 8, 16, 4);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, px, py);
    };

    if (bio.leftKneeDeg !== null) {
        const warnL = bio.leftKneeDeg < 92;
        drawBadge(bio.lKnee, `V:${bio.leftKneeDeg}°`, warnL ? 'rgba(239,68,68,0.9)' : 'rgba(15,23,42,0.85)', -52, -4);
    }
    if (bio.rightKneeDeg !== null) {
        const warnR = bio.rightKneeDeg < 92;
        drawBadge(bio.rKnee, `O:${bio.rightKneeDeg}°`, warnR ? 'rgba(239,68,68,0.9)' : 'rgba(15,23,42,0.85)', 12, -4);
    }
    if (bio.hipAngulationDeg !== null) {
        drawBadge(bio.midHip, `Ang:${bio.hipAngulationDeg}°`, 'rgba(37,99,235,0.88)', 14, -10);
    }

    // 4. Record Apex History & Update Live DOM Telemetry Panel
    if (aiVideo && aiVideo.currentTime > 0) {
        const tSec = Number(aiVideo.currentTime.toFixed(2));
        const minKnee = Math.min(bio.leftKneeDeg || 180, bio.rightKneeDeg || 180);
        const existing = apexHistory.find(a => Math.abs(a.timeSec - tSec) < 0.08);
        const score = bio.leanAbsDeg + bio.hipAngulationDeg * 1.2;
        if (!existing) {
            apexHistory.push({ timeSec: tSec, leanDeg: bio.leanAbsDeg, angDeg: bio.hipAngulationDeg, kneeMinDeg: minKnee, score });
        }
    }

    updateBiomechPanelDOM(bio);
}

function updateBiomechPanelDOM(bio) {
    const lKneeEl = document.getElementById('bio-val-lknee');
    const rKneeEl = document.getElementById('bio-val-rknee');
    const angEl = document.getElementById('bio-val-ang');
    const leanEl = document.getElementById('bio-val-lean');
    const shinEl = document.getElementById('bio-val-shin');

    if (lKneeEl) {
        lKneeEl.innerText = bio.leftKneeDeg !== null ? `${bio.leftKneeDeg}°` : '--°';
        lKneeEl.style.color = (bio.leftKneeDeg && bio.leftKneeDeg < 92) ? '#f87171' : '#fff';
    }
    if (rKneeEl) {
        rKneeEl.innerText = bio.rightKneeDeg !== null ? `${bio.rightKneeDeg}°` : '--°';
        rKneeEl.style.color = (bio.rightKneeDeg && bio.rightKneeDeg < 92) ? '#f87171' : '#fff';
    }
    if (angEl) angEl.innerText = `${bio.hipAngulationDeg}°`;
    if (leanEl) leanEl.innerText = `${bio.leanAbsDeg}° (${bio.leanDir})`;
    if (shinEl) {
        const isParallel = bio.shinDeltaDeg <= 10;
        shinEl.innerText = `${bio.shinDeltaDeg}° ${isParallel ? 'OK' : 'A-FRAME'}`;
        shinEl.style.color = isParallel ? '#4ade80' : '#f87171';
    }
}

function jumpToTurnApex() {
    if (!aiVideo) return;
    if (apexHistory.length === 0) {
        alert("Toista videota hetki Tikku-ukko päällä, jotta tekoäly mittaa käännöksen huippukohdan!");
        return;
    }
    const best = [...apexHistory].sort((a, b) => b.score - a.score)[0];
    if (best) {
        aiVideo.pause();
        aiVideo.currentTime = best.timeSec;
        forceProcess = true;
    }
}

function onPoseResults(results) {
    if (!aiCtx || !aiCanvas) return;

    const rect = aiVideo.getBoundingClientRect();
    if (rect.width > 0 && (aiCanvas.width !== Math.floor(rect.width) || aiCanvas.height !== Math.floor(rect.height))) {
        aiCanvas.width = Math.floor(rect.width);
        aiCanvas.height = Math.floor(rect.height);
    }

    aiCtx.clearRect(0, 0, aiCanvas.width, aiCanvas.height);
    redrawUserLines();

    // Draw Ghost Stickman from comparison run if active
    if (typeof window.drawGhostStickmanIfActive === 'function') {
        window.drawGhostStickmanIfActive(aiCtx, aiCanvas.width, aiCanvas.height);
    }

    const rawLm = results.poseLandmarks;
    if (rawLm && window.drawConnectors && window.drawLandmarks && window.POSE_CONNECTIONS) {
        const lm = smoothPoseLandmarks(rawLm);
        lastPoseLandmarks = lm;
        lastPoseTime = Date.now();

        window.drawConnectors(aiCtx, lm, window.POSE_CONNECTIONS, { color: '#22c55e', lineWidth: 3.5 });
        window.drawLandmarks(aiCtx, lm, { color: '#ef4444', lineWidth: 1.5, radius: 3 });

        const bio = computeSkiBiomechanics(lm);
        renderBiomechOverlays(aiCtx, aiCanvas.width, aiCanvas.height, bio);
    } else if (lastPoseLandmarks && (Date.now() - lastPoseTime) < 1000 && window.drawConnectors && window.POSE_CONNECTIONS) {
        window.drawConnectors(aiCtx, lastPoseLandmarks, window.POSE_CONNECTIONS, { color: 'rgba(34, 197, 94, 0.4)', lineWidth: 3 });
        const bio = computeSkiBiomechanics(lastPoseLandmarks);
        renderBiomechOverlays(aiCtx, aiCanvas.width, aiCanvas.height, bio);
    } else {
        aiCtx.fillStyle = 'rgba(239, 68, 68, 0.85)';
        aiCtx.fillRect(10, 10, 130, 26);
        aiCtx.font = "bold 11px Inter, sans-serif";
        aiCtx.fillStyle = '#fff';
        aiCtx.fillText("HAHMOA EI LÖYDY", 16, 27);
    }
}

// --- FRAME-BY-FRAME, SLOW-MO & A-B LOOP CONTROLS ---

function stepVideoFrame(direction = 1) {
    const v = document.getElementById('card-video');
    if (!v) return;
    v.pause();
    const frameStepSec = 1 / 30; // ~33.3ms per frame
    const nextTime = Math.max(0, Math.min(v.duration || 999, v.currentTime + direction * frameStepSec));
    v.currentTime = nextTime;
    forceProcess = true;
    if (typeof window.syncGhostToMainVideo === 'function') {
        window.syncGhostToMainVideo();
    }
}

function setCardPlaybackSpeed(rate) {
    const v = document.getElementById('card-video');
    if (v) v.playbackRate = rate;
    [1.0, 0.5, 0.25, 0.1].forEach(r => {
        const btn = document.getElementById(`card-speed-${String(r).replace('.', '_')}`);
        if (btn) {
            const active = Math.abs(r - rate) < 0.01;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.style.background = active ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
            btn.style.borderColor = active ? '#fff' : 'rgba(255,255,255,0.22)';
        }
    });
    if (typeof window.syncGhostToMainVideo === 'function') {
        window.syncGhostToMainVideo();
    }
}

function toggleTurnLoop() {
    const v = document.getElementById('card-video');
    const btn = document.getElementById('btn-turn-loop');
    if (!v) return;

    turnLoopActive = !turnLoopActive;
    if (turnLoopActive) {
        const center = v.currentTime || 0;
        turnLoopStart = Math.max(0, center - 1.5);
        turnLoopEnd = Math.min(v.duration || (center + 2.0), center + 1.5);
        if (v.paused) v.play().catch(() => {});
    }
    if (btn) {
        btn.setAttribute('aria-pressed', turnLoopActive ? 'true' : 'false');
        btn.style.background = turnLoopActive ? 'var(--accent)' : 'rgba(255,255,255,0.08)';
        btn.style.borderColor = turnLoopActive ? '#fff' : 'rgba(255,255,255,0.22)';
    }
}

// --- PRO DRAWING TOOLS (Freehand, Line, 3-Point Angle Protractor) ---

function setupCanvasDrawing() {
    const cvs = document.getElementById('card-ai-canvas');
    if (!cvs) return;

    cvs.addEventListener('touchstart', onDrawStart, { passive: false });
    cvs.addEventListener('touchmove', onDrawMove, { passive: false });
    cvs.addEventListener('touchend', onDrawEnd);
    cvs.addEventListener('touchcancel', onDrawEnd);

    cvs.addEventListener('mousedown', onDrawStart);
    cvs.addEventListener('mousemove', onDrawMove);
    window.addEventListener('mouseup', onDrawEnd);
}

function getPointerPos(e) {
    const cvs = document.getElementById('card-ai-canvas');
    const rect = cvs.getBoundingClientRect();
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function onDrawStart(e) {
    if (!drawingModeActive) return;
    if (aiVideo && !aiVideo.paused) aiVideo.pause();
    initCanvasContexts();
    const pos = getPointerPos(e);
    e.preventDefault();

    if (currentDrawTool === 'angle') {
        pendingAnglePoints.push(pos);
        if (pendingAnglePoints.length === 3) {
            const deg = calcAngle2D(pendingAnglePoints[0], pendingAnglePoints[1], pendingAnglePoints[2]);
            drawings.push({ type: 'angle', points: [...pendingAnglePoints], angleDeg: deg });
            pendingAnglePoints = [];
        }
        refreshCanvasStatic();
        return;
    }

    isDrawing = true;
    drawPath = [pos];
}

function onDrawMove(e) {
    if (!isDrawing || !drawingModeActive) return;
    const pos = getPointerPos(e);
    e.preventDefault();

    if (currentDrawTool === 'line') {
        drawPath = [drawPath[0], pos];
        refreshCanvasStatic();
        drawSingleShape(aiCtx, { type: 'line', points: drawPath });
    } else {
        drawPath.push(pos);
        if (aiCtx && drawPath.length >= 2) {
            const p1 = drawPath[drawPath.length - 2];
            aiCtx.lineCap = 'round';
            aiCtx.strokeStyle = '#ef4444';
            aiCtx.lineWidth = 4;
            aiCtx.beginPath();
            aiCtx.moveTo(p1.x, p1.y);
            aiCtx.lineTo(pos.x, pos.y);
            aiCtx.stroke();
        }
    }
}

function onDrawEnd() {
    if (!isDrawing) return;
    isDrawing = false;
    if (drawPath.length > 1) {
        drawings.push({ type: currentDrawTool, points: [...drawPath] });
        refreshCanvasStatic();
    }
}

function drawSingleShape(ctx, item) {
    const pts = item.points || item;
    if (!pts || pts.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (item.type === 'angle') {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        pts.forEach(p => {
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
        if (pts.length === 3 && item.angleDeg !== null) {
            const v = pts[1];
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.fillRect(v.x + 8, v.y - 22, 50, 20);
            ctx.fillStyle = '#facc15';
            ctx.font = '900 12px Inter, monospace';
            ctx.fillText(`${item.angleDeg}°`, v.x + 13, v.y - 8);
        }
    } else {
        ctx.strokeStyle = item.type === 'line' ? '#38bdf8' : '#ef4444';
        ctx.lineWidth = 4;
        if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function redrawUserLines() {
    if (!aiCtx) return;
    for (const item of drawings) {
        drawSingleShape(aiCtx, item);
    }
    if (pendingAnglePoints.length > 0) {
        drawSingleShape(aiCtx, { type: 'angle', points: pendingAnglePoints, angleDeg: null });
    }
}

function refreshCanvasStatic() {
    if (!aiCtx || !aiCanvas) return;
    if (strickmanActive) {
        forceProcess = true;
    } else {
        aiCtx.clearRect(0, 0, aiCanvas.width, aiCanvas.height);
        redrawUserLines();
    }
}

function clearAIDrawings() {
    drawings = [];
    pendingAnglePoints = [];
    comTrail = [];
    refreshCanvasStatic();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupCanvasDrawing, 500);
});

setInterval(() => {
    const v = document.getElementById('card-video');
    const c = document.getElementById('card-ai-canvas');
    if (v && turnLoopActive && !v.paused && turnLoopEnd > turnLoopStart) {
        if (v.currentTime >= turnLoopEnd || v.currentTime < turnLoopStart - 0.2) {
            v.currentTime = turnLoopStart;
        }
    }
    if (v && c && !v.paused) {
        const rect = v.getBoundingClientRect();
        if (rect.width > 0 && (c.width !== Math.floor(rect.width) || c.height !== Math.floor(rect.height))) {
            c.width = Math.floor(rect.width);
            c.height = Math.floor(rect.height);
            redrawUserLines();
        }
    }
}, 120);

window.toggleStickman = toggleStickman;
window.clearAIDrawings = clearAIDrawings;
window.toggleDrawingMode = toggleDrawingMode;
window.selectDrawTool = selectDrawTool;
window.stepVideoFrame = stepVideoFrame;
window.setCardPlaybackSpeed = setCardPlaybackSpeed;
window.toggleTurnLoop = toggleTurnLoop;
window.jumpToTurnApex = jumpToTurnApex;
window.computeSkiBiomechanics = computeSkiBiomechanics;
