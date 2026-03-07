// --- Alppikello Rangefinder (Etäisyysmittari) ---

let rfStream = null;
let rfActive = false;
let rfColor = 'red'; // 'red' or 'blue'
let rfCalibration = 1.0;
let rfInterval = null;

const POLE_HEIGHT_M = 1.8;
// Base focal factor for average phone (1080p height)
// This is empirical and will be adjusted by calibration
let BASE_FOCAL_FACTOR = 1100; 

function toggleRangefinder() {
    rfActive = !rfActive;
    const view = document.getElementById('view-rangefinder');
    if (!view) return;

    if (rfActive) {
        view.style.display = 'block';
        startRangefinder();
    } else {
        view.style.display = 'none';
        stopRangefinder();
    }
}

async function startRangefinder() {
    const video = document.getElementById('rf-video');
    if (!video) return;

    try {
        rfStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = rfStream;
        video.play();
        
        // Initial Calibration display
        document.getElementById('rf-calib-val').innerText = rfCalibration.toFixed(2);
        
        requestAnimationFrame(processRangefinderFrame);
    } catch (e) {
        console.error("Rangefinder camera failed:", e);
        alert("Mittari vaatii kameran käyttöoikeuden.");
        toggleRangefinder();
    }
}

function stopRangefinder() {
    if (rfStream) {
        rfStream.getTracks().forEach(t => t.stop());
        rfStream = null;
    }
}

function setRFColor(color) {
    rfColor = color;
    document.getElementById('btn-rf-red').style.opacity = color === 'red' ? '1' : '0.5';
    document.getElementById('btn-rf-red').style.border = color === 'red' ? '2px solid #fff' : 'none';
    document.getElementById('btn-rf-blue').style.opacity = color === 'blue' ? '1' : '0.5';
    document.getElementById('btn-rf-blue').style.border = color === 'blue' ? '2px solid #fff' : 'none';
}

function adjustRFCalibration(delta) {
    rfCalibration += delta;
    if (rfCalibration < 0.1) rfCalibration = 0.1;
    if (rfCalibration > 5.0) rfCalibration = 5.0;
    document.getElementById('rf-calib-val').innerText = rfCalibration.toFixed(2);
}

function processRangefinderFrame() {
    if (!rfActive || !rfStream) return;

    const video = document.getElementById('rf-video');
    const canvas = document.getElementById('rf-overlay');
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(processRangefinderFrame);
        return;
    }

    if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Use a secondary small canvas for fast processing
    const procW = 160;
    const procH = Math.round(h * (procW / w));
    const tempCanvas = document.createElement('canvas'); // Reuse this in production
    tempCanvas.width = procW;
    tempCanvas.height = procH;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(video, 0, 0, procW, procH);

    const imageData = tCtx.getImageData(0, 0, procW, procH);
    const data = imageData.data;

    let columns = new Array(procW).fill(0);
    let colStarts = new Array(procW).fill(-1);
    let colEnds = new Array(procW).fill(-1);

    // Color detection loop
    for (let x = 0; x < procW; x++) {
        let firstY = -1;
        let lastY = -1;
        let count = 0;

        for (let y = 0; y < procH; y++) {
            const i = (y * procW + x) * 4;
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];

            let match = false;
            if (rfColor === 'red') {
                // Strong Red: R dominant and higher than threshold
                if (r > 120 && r > g * 1.5 && r > b * 1.5) match = true;
            } else {
                // Strong Blue: B dominant
                if (b > 100 && b > r * 1.3 && b > g * 1.1) match = true;
            }

            if (match) {
                if (firstY === -1) firstY = y;
                lastY = y;
                count++;
            }
        }

        // Only count if it looks like part of a vertical pole (enough density)
        if (count > procH * 0.05) {
            columns[x] = count;
            colStarts[x] = firstY;
            colEnds[x] = lastY;
        }
    }

    // Find the best cluster (the pole)
    let bestX = -1;
    let bestHeight = 0;
    let bestYStart = 0;
    let bestYEnd = 0;

    for (let x = 1; x < procW - 1; x++) {
        // Simple peak finding for the tallest vertical segment
        if (columns[x] > bestHeight) {
            bestHeight = columns[x];
            bestX = x;
            bestYStart = colStarts[x];
            bestYEnd = colEnds[x];
        }
    }

    ctx.clearRect(0, 0, w, h);

    if (bestHeight > 5) {
        const drawX = (bestX / procW) * w;
        const drawYStart = (bestYStart / procH) * h;
        const drawYEnd = (bestYEnd / procH) * h;
        const pixelHeight = drawYEnd - drawYStart;

        // Visual feedback (The box)
        ctx.strokeStyle = rfColor === 'red' ? "#ef4444" : "#3b82f6";
        ctx.lineWidth = 4;
        ctx.strokeRect(drawX - 20, drawYStart, 40, pixelHeight);
        
        // Target line
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, drawYStart); ctx.lineTo(w, drawYStart);
        ctx.moveTo(0, drawYEnd); ctx.lineTo(w, drawYEnd);
        ctx.stroke();
        ctx.setLineDash([]);

        // CALCULATION
        // f = (pixels * distance) / objectHeight
        // we'll use a reference focal factor adjusted by calibration
        const adjustedFocal = BASE_FOCAL_FACTOR * rfCalibration;
        const distance = (POLE_HEIGHT_M * adjustedFocal) / pixelHeight;

        const distEl = document.getElementById('rf-distance');
        if (distEl) {
            distEl.innerText = distance.toFixed(1) + " m";
            distEl.style.color = "#fbbf24";
        }
    } else {
        const distEl = document.getElementById('rf-distance');
        if (distEl) {
            distEl.innerText = "-- m";
            distEl.style.color = "rgba(255,255,255,0.3)";
        }
    }

    requestAnimationFrame(processRangefinderFrame);
}

// Global exposure
window.toggleRangefinder = toggleRangefinder;
window.setRFColor = setRFColor;
window.adjustRFCalibration = adjustRFCalibration;
