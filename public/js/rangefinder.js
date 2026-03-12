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

    // Limit scanning area to the center 40% (x from 0.3 to 0.7)
    const scanStartX = Math.floor(procW * 0.3);
    const scanEndX = Math.floor(procW * 0.7);

    // Color detection loop
    for (let x = scanStartX; x < scanEndX; x++) {
        let currentSegmentStart = -1;
        let currentSegmentLength = 0;
        let bestSegmentStart = -1;
        let bestSegmentLength = 0;

        for (let y = 0; y < procH; y++) {
            const i = (y * procW + x) * 4;
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];

            let match = false;
            
            // Handle bright/dark lighting by looking at color dominance
            const maxVal = Math.max(r, g, b);
            
            if (maxVal > 30) { // Ignore pure noise/black
                if (rfColor === 'red') {
                    // Red must be dominant. Use relative ratios.
                    if (r === maxVal && r > g * 1.3 && r > b * 1.3) match = true;
                } else {
                    // Blue must be dominant.
                    if (b === maxVal && b > r * 1.2 && b > g * 1.1) match = true;
                }
            }

            if (match) {
                if (currentSegmentStart === -1) currentSegmentStart = y;
                currentSegmentLength++;
            } else {
                if (currentSegmentLength > bestSegmentLength) {
                    bestSegmentLength = currentSegmentLength;
                    bestSegmentStart = currentSegmentStart;
                }
                currentSegmentStart = -1;
                currentSegmentLength = 0;
            }
        }

        if (currentSegmentLength > bestSegmentLength) {
            bestSegmentLength = currentSegmentLength;
            bestSegmentStart = currentSegmentStart;
        }

        // Only keep if it's a reasonably continuous tall segment
        if (bestSegmentLength > procH * 0.05) {
            columns[x] = bestSegmentLength;
            colStarts[x] = bestSegmentStart;
            colEnds[x] = bestSegmentStart + bestSegmentLength;
        }
    }

    // Find the best cluster (the tallest pole in the center area)
    let bestX = -1;
    let bestHeight = 0;
    let bestYStart = 0;
    let bestYEnd = 0;

    for (let x = scanStartX; x < scanEndX; x++) {
        if (columns[x] > bestHeight) {
            bestHeight = columns[x];
            bestX = x;
            bestYStart = colStarts[x];
            bestYEnd = colEnds[x];
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
        ctx.strokeStyle = rfColor === 'red' ? "#ef4444" : "#3b82f6";
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
window.setRFColor = setRFColor;
window.adjustRFCalibration = adjustRFCalibration;
