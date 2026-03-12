// --- Alppikello State ---

const SERVER_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? undefined
    : window.location.origin; // Use current host by default

const socket = io(SERVER_URL);

// --- Globals & State ---
let currentSession = null;
let currentRole = null;
let userLocation = null;
let serverTimeOffset = 0;
let rtt = 0;
let selectedRole = null;
let userName = localStorage.getItem('alppikello_user_name') || "";
let activeRunnerOnCourse = null;
let hasRecordedForCurrentRunner = false;
let s3Active = false;

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
