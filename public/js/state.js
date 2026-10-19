// --- Alppikello State (Stateless ToD & Monotonic Clock Edition) ---

const SERVER_URL = '';
const API_URL = 'api.php';

// Persistent Device ID across page reloads and network drops
let deviceId = localStorage.getItem('alppikello_device_id');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('alppikello_device_id', deviceId);
}

// Monotonic Clock Calibration State (calibrated ONCE per session via performance.now())
let clockCalibrated = false;
let clockBaseServerTime = Date.now();
let clockBasePerfTime = (typeof performance !== 'undefined') ? performance.now() : 0;
let serverTimeOffset = 0;
let rtt = 0;

// --- Globals & State ---
let currentSession = null;
let currentRole = null;
let userLocation = null;
let selectedRole = null;
let userName = localStorage.getItem('alppikello_user_name') || "";
let activeRunnerOnCourse = null;
let hasRecordedForCurrentRunner = false;
let s3Active = true; // Server-local video storage is always active via api.php

// Rendering optimization locks
let lastAthletesCount = -1;
let lastResultsCount = -1;
let lastQueueCount = -1;
let lastOnCourseCount = -1;
let lastNextId = null;

// Timers & Active Objects
let uiUpdateTimer = null;
let cvInterval = null;
let lastTriggerTime = 0;
let cvStream = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordedClips = [];
let bufferResetTimer = null;
let discoveryWatchId = null;
let watchId = null;
let endSessionStep = 0;

// Compatibility shim for legacy socket references (actual logic in socket.js)
const socket = {
    id: deviceId,
    connected: true,
    emit: function(event, payload) {
        if (typeof window.handleApiEmit === 'function') {
            window.handleApiEmit(event, payload);
        }
    },
    on: function() {}
};
