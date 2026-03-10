// --- Alppikello Utilities ---

function formatDuration(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) return "--,--";
    const absoluteMs = Math.abs(ms);
    const centis = Math.floor((absoluteMs % 1000) / 10);
    const totalSecs = Math.floor(absoluteMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const cStr = String(centis).padStart(2, '0');
    const sStr = String(secs).padStart(2, '0');
    const mStr = String(mins).padStart(2, '0');

    let out = "";
    if (hours > 0) {
        out = `${hours}.${mStr}.${sStr},${cStr}`;
    } else if (mins > 0) {
        out = `${mins}.${sStr},${cStr}`;
    } else {
        out = `${secs},${cStr}`;
    }
    return (ms < 0 ? "-" : "") + out;
}

// Fixed truncation for video clock (seconds as float)
function formatSeconds(s) {
    if (s === undefined || s === null || isNaN(s)) return "0,00";
    const ms = Math.floor(Math.abs(s) * 1000);
    const centis = Math.floor((ms % 1000) / 10);
    const totalSecs = Math.floor(ms / 1000);
    const secs = totalSecs % 60;
    const cStr = String(centis).padStart(2, '0');
    const sStr = String(secs).padStart(1, '0'); // Short for simple video clock
    return `${sStr},${cStr}`;
}

function getDistanceBetween(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // Returns meters
}

function copyToClipboard(text) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    alert('Linkki kopioitu leikepöydälle!');
}

function showVideoNotification(msg) {
    const overlay = document.getElementById('video-notification');
    if (overlay) {
        overlay.innerText = msg;
        overlay.style.display = 'block';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 3000);
    }
}

function getSyncedTime() {
    return Date.now() - serverTimeOffset;
}
