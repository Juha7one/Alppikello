// --- Alppikello AI & Piirtäminen ---
let strickmanActive = false;
let poseEngine = null;
let aiCanvas = null;
let aiCtx = null;
let aiVideo = null;
let aiRafId = null;

let lastProcessedTime = -1;
let forceProcess = false;
let POSE_WORKER_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose_solution_packed_assets.data';
let lastPoseLandmarks = null;
let lastPoseTime = 0;
let isDrawing = false;
let drawingModeActive = false;
let drawings = []; // Store lines as [{x, y}, {x, y}] paths
let drawPath = [];

function toggleStickman() {
    strickmanActive = !strickmanActive;
    const btn = document.getElementById('btn-toggle-ai');
    if(btn) {
        btn.style.border = strickmanActive ? "2px solid #fff" : "2px solid transparent";
        btn.style.background = strickmanActive ? "var(--accent)" : "rgba(255,255,255,0.05)";
    }

    if(strickmanActive) {
        forceProcess = true;
        startAI();
    } else {
        stopAI();
    }
}

function initCanvasContexts() {
    if(!aiCtx) {
        aiVideo = document.getElementById('card-video');
        aiCanvas = document.getElementById('card-ai-canvas');
        if(aiCanvas) {
            aiCtx = aiCanvas.getContext('2d');
            if(aiVideo) {
                const rect = aiVideo.getBoundingClientRect();
                if(rect.width > 0) {
                    aiCanvas.width = Math.floor(rect.width);
                    aiCanvas.height = Math.floor(rect.height);
                }
            }
        }
    }
}

function toggleDrawingMode() {
    drawingModeActive = !drawingModeActive;
    const btn = document.getElementById('btn-toggle-draw');
    const cvs = document.getElementById('card-ai-canvas');
    
    if(drawingModeActive) {
        initCanvasContexts();
    }

    if(btn) {
        btn.style.border = drawingModeActive ? "2px solid #fff" : "2px solid transparent";
        btn.style.background = drawingModeActive ? "var(--accent)" : "rgba(255,255,255,0.05)";
        btn.innerText = drawingModeActive ? "✏️ PIIRTÄMINEN PÄÄLLÄ" : "✏️ PIIRRÄ";
    }

    if(cvs) {
        cvs.style.pointerEvents = drawingModeActive ? "auto" : "none";
    }
}

function startAI() {
    initCanvasContexts();
    if(!aiVideo || !aiCanvas) return;

    // Ensure canvas matches video display size precisely
    const rect = aiVideo.getBoundingClientRect();
    if (rect.width > 0 && (aiCanvas.width !== Math.floor(rect.width) || aiCanvas.height !== Math.floor(rect.height))) {
        aiCanvas.width = Math.floor(rect.width);
        aiCanvas.height = Math.floor(rect.height);
    }

    if(!poseEngine && window.Pose) {
        poseEngine = new window.Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });

        poseEngine.setOptions({
            modelComplexity: 1, // 1=accurate (better balance for dark outfits on bright snow than 2)
            smoothLandmarks: true,
            minDetectionConfidence: 0.1, // Super low to catch blurry frames
            minTrackingConfidence: 0.1
        });

        poseEngine.onResults(onPoseResults);
    }

    if(poseEngine) {
        aiLoop();
    }
}

function stopAI() {
    if(aiRafId) cancelAnimationFrame(aiRafId);
    if(aiCtx && aiCanvas) {
        aiCtx.clearRect(0,0, aiCanvas.width, aiCanvas.height);
        redrawUserLines(); // keep drawings even if AI stops
    }
}

async function aiLoop() {
    if(!strickmanActive || !poseEngine || !aiVideo) return;
    
    const currentTime = aiVideo.currentTime;
    const shouldProcess = (aiVideo.readyState >= 2) && (
        (!aiVideo.paused && !aiVideo.ended) || 
        (currentTime !== lastProcessedTime) ||
        forceProcess
    );

    if (shouldProcess) {
        try {
            await poseEngine.send({image: aiVideo});
            lastProcessedTime = currentTime;
            forceProcess = false;
        } catch(e) {
            console.warn("Pose processing failed/skipped frame:", e);
            if(e.name === 'SecurityError' || (e.message && e.message.includes('tainted'))) {
                if(aiCtx && aiCanvas) {
                    aiCtx.clearRect(0,0, aiCanvas.width, aiCanvas.height);
                    aiCtx.fillStyle = 'rgba(239, 68, 68, 0.9)'; // Red alert bg
                    aiCtx.fillRect(10, 10, 240, 50);
                    aiCtx.font = "bold 12px Inter, sans-serif";
                    aiCtx.fillStyle = '#fff';
                    aiCtx.fillText("🔒 S3 CORS-ESTO", 20, 30);
                    aiCtx.font = "10px Inter, sans-serif";
                    aiCtx.fillText("Tekoäly ei voi tutkia tätä videota.", 20, 48);
                }
            }
        }
    }
    
    aiRafId = requestAnimationFrame(aiLoop);
}

function onPoseResults(results) {
    if(!aiCtx || !aiCanvas) return;

    // Rescale canvas in case window size changed
    const rect = aiVideo.getBoundingClientRect();
    if (rect.width > 0 && (aiCanvas.width !== Math.floor(rect.width) || aiCanvas.height !== Math.floor(rect.height))) {
        aiCanvas.width = Math.floor(rect.width);
        aiCanvas.height = Math.floor(rect.height);
    }

    aiCtx.clearRect(0, 0, aiCanvas.width, aiCanvas.height);
    
    // Always redraw user lines
    redrawUserLines();

    if (results.poseLandmarks && window.drawConnectors && window.drawLandmarks && window.POSE_CONNECTIONS) {
        lastPoseLandmarks = results.poseLandmarks;
        lastPoseTime = Date.now();
        window.drawConnectors(aiCtx, results.poseLandmarks, window.POSE_CONNECTIONS,
                       {color: '#00FF00', lineWidth: 4});
        window.drawLandmarks(aiCtx, results.poseLandmarks,
                      {color: '#FF0000', lineWidth: 2, radius: 3});
    } else if (lastPoseLandmarks && (Date.now() - lastPoseTime) < 1000 && window.drawConnectors && window.drawLandmarks && window.POSE_CONNECTIONS) {
        // Elastic Memory: Draw last known pose with faded colors to indicate loss of tracking
        window.drawConnectors(aiCtx, lastPoseLandmarks, window.POSE_CONNECTIONS,
                       {color: 'rgba(0, 255, 0, 0.4)', lineWidth: 4});
        window.drawLandmarks(aiCtx, lastPoseLandmarks,
                      {color: 'rgba(255, 0, 0, 0.4)', lineWidth: 2, radius: 3});
    } else {
        // Visual feedback that the AI is trying but cannot detect a pose
        aiCtx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Red background
        aiCtx.fillRect(10, 10, 120, 26);
        aiCtx.font = "12px Inter, sans-serif";
        aiCtx.fillStyle = '#fff';
        aiCtx.fillText("⚠️ HAHMOA EI LÖYDY", 15, 27);
    }
}

// --- DRAWING LOGIC ---

function setupCanvasDrawing() {
    // Only needed to do once
    const cvs = document.getElementById('card-ai-canvas');
    if(!cvs) return;

    // Touch events for mobile
    cvs.addEventListener('touchstart', onDrawStart, {passive: false});
    cvs.addEventListener('touchmove', onDrawMove, {passive: false});
    cvs.addEventListener('touchend', onDrawEnd);
    cvs.addEventListener('touchcancel', onDrawEnd);

    // Mouse events for desktop
    cvs.addEventListener('mousedown', onDrawStart);
    cvs.addEventListener('mousemove', onDrawMove);
    window.addEventListener('mouseup', onDrawEnd);
}

function getPointerPos(e) {
    const cvs = document.getElementById('card-ai-canvas');
    const rect = cvs.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function onDrawStart(e) {
    // Check if video is playing... if playing, pause it to draw comfortably!
    if(aiVideo && !aiVideo.paused) {
        aiVideo.pause();
    }

    isDrawing = true;
    drawPath = [];
    const pos = getPointerPos(e);
    drawPath.push(pos);
    e.preventDefault(); // Prevent scrolling
}

function onDrawMove(e) {
    if(!isDrawing) return;
    const pos = getPointerPos(e);
    drawPath.push(pos);
    
    // Quick render
    if(aiCtx) {
        aiCtx.lineCap = 'round';
        aiCtx.lineJoin = 'round';
        aiCtx.strokeStyle = '#ef4444';
        aiCtx.lineWidth = 4;
        aiCtx.beginPath();
        const p1 = drawPath[drawPath.length - 2];
        const p2 = pos;
        aiCtx.moveTo(p1.x, p1.y);
        aiCtx.lineTo(p2.x, p2.y);
        aiCtx.stroke();
    }
    e.preventDefault();
}

function onDrawEnd(e) {
    if(!isDrawing) return;
    isDrawing = false;
    if(drawPath.length > 1) {
        drawings.push([...drawPath]);
    }
}

function redrawUserLines() {
    if(!aiCtx) return;
    aiCtx.lineCap = 'round';
    aiCtx.lineJoin = 'round';
    aiCtx.strokeStyle = '#ef4444';
    aiCtx.lineWidth = 4;

    for (const path of drawings) {
        if(path.length < 2) continue;
        aiCtx.beginPath();
        aiCtx.moveTo(path[0].x, path[0].y);
        for(let i=1; i<path.length; i++) {
            aiCtx.lineTo(path[i].x, path[i].y);
        }
        aiCtx.stroke();
    }
}

function clearAIDrawings() {
    drawings = [];
    if(aiCtx && aiCanvas) {
        aiCtx.clearRect(0,0, aiCanvas.width, aiCanvas.height);
    }
}

// Hook logic to app init
document.addEventListener('DOMContentLoaded', () => {
    // Need a slight delay to ensure elements exist
    setTimeout(setupCanvasDrawing, 500);
});

// Watch video play/pause to re-init canvas rects
setInterval(() => {
    const v = document.getElementById('card-video');
    const c = document.getElementById('card-ai-canvas');
    if(v && c && !v.paused) {
        const rect = v.getBoundingClientRect();
        if(rect.width > 0 && (c.width !== Math.floor(rect.width) || c.height !== Math.floor(rect.height))) {
            c.width = Math.floor(rect.width);
            c.height = Math.floor(rect.height);
            redrawUserLines(); // Always redraw if resized
        }
    }
}, 500);

window.toggleStickman = toggleStickman;
window.clearAIDrawings = clearAIDrawings;
window.toggleDrawingMode = toggleDrawingMode;
