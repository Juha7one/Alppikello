// --- Alppikello Rangefinder (Etäisyysmittari) ---

let rfStream = null;
let rfActive = false;
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
        document.getElementById('rf-calib-val').innerText = rfCalibration.toFixed(2) + 'x';
        
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

function adjustRFCalibration(delta) {
    rfCalibration += delta;
    if (rfCalibration < 0.1) rfCalibration = 0.1;
    if (rfCalibration > 5.0) rfCalibration = 5.0;
    document.getElementById('rf-calib-val').innerText = rfCalibration.toFixed(2) + 'x';
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

    let columns = new Array(procW).fill(0).map(() => ({ height: 0, start: -1, end: -1, color: 'red' }));

    // Limit scanning area to the center 40% (x from 0.3 to 0.7)
    const scanStartX = Math.floor(procW * 0.3);
    const scanEndX = Math.floor(procW * 0.7);

    // Color detection loop
    for (let x = scanStartX; x < scanEndX; x++) {
        let currentRedStart = -1, currentRedLen = 0, bestRedStart = -1, bestRedLen = 0;
        let currentBlueStart = -1, currentBlueLen = 0, bestBlueStart = -1, bestBlueLen = 0;

        for (let y = 0; y < procH; y++) {
            const i = (y * procW + x) * 4;
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];

            let isRed = false, isBlue = false;
            
            const maxVal = Math.max(r, g, b);
            
            if (maxVal > 30) { 
                if (r === maxVal && r > g * 1.3 && r > b * 1.3) isRed = true;
                if (b === maxVal && b > r * 1.2 && b > g * 1.1) isBlue = true;
            }

            if (isRed) {
                if (currentRedStart === -1) currentRedStart = y;
                currentRedLen++;
            } else {
                if (currentRedLen > bestRedLen) { bestRedLen = currentRedLen; bestRedStart = currentRedStart; }
                currentRedStart = -1; currentRedLen = 0;
            }

            if (isBlue) {
                if (currentBlueStart === -1) currentBlueStart = y;
                currentBlueLen++;
            } else {
                if (currentBlueLen > bestBlueLen) { bestBlueLen = currentBlueLen; bestBlueStart = currentBlueStart; }
                currentBlueStart = -1; currentBlueLen = 0;
            }
        }

        if (currentRedLen > bestRedLen) { bestRedLen = currentRedLen; bestRedStart = currentRedStart; }
        if (currentBlueLen > bestBlueLen) { bestBlueLen = currentBlueLen; bestBlueStart = currentBlueStart; }

        let bestStart = -1, bestLen = 0, bestColor = 'red';
        if (bestRedLen > bestBlueLen) { bestStart = bestRedStart; bestLen = bestRedLen; bestColor = 'red'; }
        else { bestStart = bestBlueStart; bestLen = bestBlueLen; bestColor = 'blue'; }

        if (bestLen > procH * 0.05) {
            columns[x] = { height: bestLen, start: bestStart, end: bestStart + bestLen, color: bestColor };
        }
    }

    // Find the best cluster (the tallest pole in the center area)
    let bestX = -1, bestHeight = 0, bestYStart = 0, bestYEnd = 0, bestColor = 'red';

    for (let x = scanStartX; x < scanEndX; x++) {
        if (columns[x].height > bestHeight) {
            bestHeight = columns[x].height;
            bestX = x;
            bestYStart = columns[x].start;
            bestYEnd = columns[x].end;
            bestColor = columns[x].color;
        }
    }

    ctx.clearRect(0, 0, w, h);

    // Draw scanning guide (center area)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    const guideW = w * 0.4;
    const guideX = w * 0.3;
    ctx.strokeRect(guideX, 0, guideW, h);
    
    // Draw crosshair
    ctx.beginPath();
    ctx.moveTo(w/2 - 20, h/2);
    ctx.lineTo(w/2 + 20, h/2);
    ctx.moveTo(w/2, h/2 - 20);
    ctx.lineTo(w/2, h/2 + 20);
    ctx.stroke();

    if (bestHeight > 5) {
        const drawX = (bestX / procW) * w;
        const drawYStart = (bestYStart / procH) * h;
        const drawYEnd = (bestYEnd / procH) * h;
        const pixelHeight = drawYEnd - drawYStart;

        // Visual feedback (The box around the detected pole)
        ctx.strokeStyle = bestColor === 'red' ? "#ef4444" : "#3b82f6";
        ctx.lineWidth = 4;
        ctx.strokeRect(drawX - 20, drawYStart, 40, pixelHeight);
        
        // Target lines
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(guideX, drawYStart); ctx.lineTo(guideX + guideW, drawYStart);
        ctx.moveTo(guideX, drawYEnd); ctx.lineTo(guideX + guideW, drawYEnd);
        ctx.stroke();
        ctx.setLineDash([]);

        // CALCULATION
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
window.adjustRFCalibration = adjustRFCalibration;
