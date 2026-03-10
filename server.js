const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
let storage;
const useS3 = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET;

if (useS3) {
    const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION
    });
    storage = multerS3({
        s3: s3,
        bucket: process.env.AWS_S3_BUCKET,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'videos/' + uniqueSuffix + path.extname(file.originalname));
        }
    });
    console.log("Using S3 for video storage.");
} else {
    storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    });
    console.log("Using local disk for video storage.");
}
const upload = multer({ storage: storage });

const app = express();
const server = http.createServer(app);

// Enable CORS for frontend API access
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Archive directory
const archiveDir = path.join(__dirname, 'archives');
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

function archiveSession(session) {
    if (!session || !session.results || session.results.length === 0) return;
    const filename = `session_${session.id}_${Date.now()}.json`;
    const filePath = path.join(archiveDir, filename);
    try {
        fs.writeFileSync(filePath, JSON.stringify({
            ...session,
            archivedAt: Date.now()
        }, null, 2));
        console.log(`[ARCHIVE] Saved session ${session.id} to ${filename}`);
    } catch (err) {
        console.error(`[ARCHIVE ERROR] Failed to save session ${session.id}:`, err);
    }
}

// Store for sessions and devices
const sessions = {};
// Store for shared Run Cards
const runCards = {};

// --- Human Friendly ID Generator ---
const ADJECTIVES = ['HUIMA', 'REIPAS', 'NOPEA', 'VAHVA', 'HURJA', 'VANKKA', 'RAJU', 'HUIPPU', 'KYLMÄ', 'LIUKAS'];
const NOUNS = ['ILVES', 'KARHU', 'SUSI', 'KOTKA', 'HAUKKA', 'PORO', 'KETTU', 'MÄYRÄ', 'PÖLLÖ', 'HIRVI'];

function generateHumanId() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 90) + 10; // 10-99
    return `${adj}-${noun}-${num}`;
}

// Helper for nearby sessions
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

function saveRunCard(runner, session) {
    if (!runner || !runner.runId) return;
    runCards[runner.runId] = {
        id: runner.runId,
        name: runner.name,
        startTime: runner.startTime || session.timestamp || Date.now(),
        totalTime: runner.totalTime,
        videoUrl: runner.videoUrl || null,
        videos: (runner.videos || []).sort((a, b) => a.triggerTime - b.triggerTime),
        splits: runner.splits || [],
        sessionName: session.name || "Treeni",
        timestamp: Date.now()
    };
    console.log(`[CARD] Saved run card for ${runner.name} (ID: ${runner.runId})`);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { sessionId, runnerId, runId, runnerName } = req.body;
    
    // Ensure absolute URL even for local fallsbacks
    let videoUrl = req.file.location ? req.file.location : null;
    if (!videoUrl) {
        const protocol = req.get('x-forwarded-proto') || req.protocol;
        const host = req.get('host');
        videoUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    console.log(`[UPLOAD] Video for ${runnerName} (Run: ${runId}): ${videoUrl} (S3: ${!!req.file.location})`);

    if (sessionId) {
        let finalRunId = runId;
        const session = sessions[sessionId];
        
        if (session) {
            // Find the run
            const allLists = [session.results, session.pendingResults, session.onCourse];
            let runnerEntry = null;

            // 1. Try finding by runId exactly
            if (runId && runId !== 'N/A') {
                for (const list of allLists) {
                    runnerEntry = list.find(it => it.runId === runId);
                    if (runnerEntry) break;
                }
            }

            // 2. Fallback: Find by runnerId if runId was missing/invalid
            if (!runnerEntry && runnerId && runnerId !== 'N/A') {
                console.log(`[UPLOAD] Falling back to lookup by runnerId: ${runnerId}`);
                for (const list of allLists) {
                    // Find latest entry for this runner in this list
                    const entries = list.filter(it => it.id === runnerId);
                    if (entries.length > 0) {
                        // Take the most recent one (assuming latest is better)
                        runnerEntry = entries[entries.length - 1];
                        finalRunId = runnerEntry.runId;
                        break;
                    }
                }
            }

            if (runnerEntry) {
                console.log(`[UPLOAD SUCCESS] Paired video for ${runnerEntry.name} (Run: ${runnerEntry.runId}) - URL: ${videoUrl}`);
                runnerEntry.videoUrl = videoUrl; 
                
                if (!runnerEntry.videos) runnerEntry.videos = [];
                
                // Deduplicate by URL
                const exists = runnerEntry.videos.some(v => v.url === videoUrl);
                if (!exists) {
                        const videoObj = {
                            url: videoUrl,
                            type: req.body.triggerType || 'clip',
                            triggerTime: parseInt(req.body.triggerTime) || Date.now(),
                            videoStartTime: parseInt(req.body.videoCaptureStartTime) || 0,
                            role: req.body.role || 'unknown',
                            timestamp: Date.now()
                        };
                    runnerEntry.videos.push(videoObj);
                    
                    // Update persistent runCard
                    if (runCards[runnerEntry.runId]) {
                        runCards[runnerEntry.runId].videoUrl = videoUrl;
                        if (!runCards[runnerEntry.runId].videos) runCards[runnerEntry.runId].videos = [];
                        // Deduplicate runCard as well
                        if (!runCards[runnerEntry.runId].videos.some(v => v.url === videoUrl)) {
                            runCards[runnerEntry.runId].videos.push(videoObj);
                        }
                    }
                }
                
                const payload = { 
                    sessionId, 
                    runnerId: runnerEntry.id, 
                    runId: runnerEntry.runId, 
                    runnerName: runnerEntry.name, 
                    videoUrl,
                    videos: runnerEntry.videos
                };
                io.to(sessionId).emit('video_available', payload);
            }
 else {
                console.warn(`[UPLOAD WARNING] Could not find run for runner ${runnerName} (RID: ${runnerId}, RunID: ${runId}). Video URL: ${videoUrl}`);
                // Still notify clients that a video exists, maybe they can match it
                const payload = { sessionId, runnerId, runId, runnerName, videoUrl };
                io.to(sessionId).emit('video_available', payload);
            }
        }
    }

    res.json({ success: true, url: videoUrl });
});

app.get('/api/run/:runId', (req, res) => {
    const run = runCards[req.params.runId];
    if (!run) return res.status(404).json({ error: 'Not found' });
    res.json(run);
});

app.get('/api/archives', (req, res) => {
    try {
        const files = fs.readdirSync(archiveDir);
        const archives = files.filter(f => f.endsWith('.json')).map(f => {
            const data = JSON.parse(fs.readFileSync(path.join(archiveDir, f)));
            return {
                id: data.id,
                name: data.name,
                date: data.archivedAt || Date.now(),
                athleteCount: data.results.length,
                filename: f
            };
        }).sort((a, b) => b.date - a.date);
        res.json(archives);
    } catch (err) {
        res.status(500).json({ error: "Failed to list archives" });
    }
});

app.get('/api/archives/:filename', (req, res) => {
    const filePath = path.join(archiveDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send("Archive not found");
    res.sendFile(filePath);
});

app.get(['/run/:runId', '/public/run/:runId'], (req, res) => {
    // Keep this as fallback for direct hits to backend
    try {
        const runId = req.params.runId;
        const run = runCards[runId];
        
        if (!run) {
            console.warn(`[CARD] 404 access to ${runId}`);
            return res.status(404).send('<!DOCTYPE html><html><body style="font-family:sans-serif; text-align:center; padding:50px; background:#0f172a; color:#fff;"><h1>404 - SUORITUSTA EI LÖYDY</h1><p>Tilaa vievä tai vanhentunut linkki.</p><a href="/" style="color:#3b82f6;">Takaisin pääsivulle</a></body></html>');
        }

        const templatePath = path.join(__dirname, 'public', 'run_template.html');
        if (!fs.existsSync(templatePath)) {
            console.error("[ERROR] run_template.html missing at:", templatePath);
            return res.status(500).send("Palvelinvirhe: Pohjatiedosto puuttuu.");
        }

        fs.readFile(templatePath, 'utf8', (err, data) => {
            if (err) {
                console.error("[ERROR] Failed to read template:", err);
                return res.status(500).send('Palvelinvirhe tiedostoa luettaessa.');
            }
            
            const duration = (run.totalTime / 1000).toFixed(2);
            const displayData = {
                ...run,
                totalTime: duration + 's'
            };

            const result = data.replace('{{RUN_DATA}}', JSON.stringify(displayData));
            res.send(result);
        });
    } catch (err) {
        console.error("[CRITICAL ERROR] /run route crashed:", err);
        res.status(500).send("Sisäinen palvelinvirhe.");
    }
});
// --- Automatic Housekeeping ---
// Remove sessions with no heartbeats for > 12 hours
setInterval(() => {
    const now = Date.now();
    const MAX_IDLE = 12 * 60 * 60 * 1000; // 12 hours
    for (const sid in sessions) {
        const session = sessions[sid];
        const lastActivity = Math.max(
            session.startTime,
            ...Object.values(session.devices).map(d => d.lastHeartbeat || 0)
        );
        if (now - lastActivity > MAX_IDLE) {
            console.log(`[HOUSEKEEPING] Purging idle session: ${sid}`);
            archiveSession(session); // Auto-archive before deleting if there are results
            delete sessions[sid];
        }
    }
}, 60000); // Check every minute

io.on('connection', (socket) => {
    console.log(`Device connected: ${socket.id}`);
    
    // Check S3 status and notify client
    const isS3 = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET);
    socket.emit('s3_status', { active: isS3 });

    // --- Onboarding & Session Management ---

    socket.on('create_session', (data) => {
        let sessionId = data.id || generateHumanId();
        
        // Handle collisions (rare with time-based IDs but good to have)
        if (sessions[sessionId]) {
            let count = 1;
            while (sessions[`${sessionId}-${count}`]) {
                count++;
            }
            sessionId = `${sessionId}-${count}`;
        }

        sessions[sessionId] = {
            id: sessionId,
            name: data.name || sessionId,
            startTime: Date.now(),
            adminId: socket.id,
            devices: {},
            allAthletes: [],
            activeQueue: [],
            onCourse: [],
            results: [],
            pendingResults: [],
            expectedDuration: null,
            forerunnerCount: 0,
            location: data.location || null
        };

        // Automatically add the creator as VALMENTAJA to the devices list
        sessions[sessionId].devices[socket.id] = {
            id: socket.id,
            role: 'VALMENTAJA',
            name: data.creatorName || "Valmentaja",
            lastHeartbeat: Date.now(),
            battery: 100,
            location: data.location || null
        };

        socket.join(sessionId);
        socket.emit('session_created', sessions[sessionId]);
    });



    socket.on('find_nearby_sessions', (data) => {
        const { lat, lon } = data;
        if (!lat || !lon) return;

        const nearby = [];
        const radius = 5.0; // 5 km

        for (const sid in sessions) {
            const s = sessions[sid];
            if (s.location && s.location.lat) {
                const dist = getDistance(lat, lon, s.location.lat, s.location.lon);
                
                // Filter out ended sessions
                if (s.ended) continue;

                // PERFORMANCE: Check if session has ANY active devices in the last 30 minutes
                const now = Date.now();
                const devices = Object.values(s.devices || {});
                const isRecent = devices.some(d => (now - (d.lastHeartbeat || 0)) < 30 * 60 * 1000);
                
                if (dist <= radius && isRecent) {
                    nearby.push({
                        id: s.id,
                        name: s.name,
                        distance: dist.toFixed(2),
                        athleteCount: Object.values(s.devices).filter(d => d.role === 'URHEILIJA').length
                    });
                }
            }
        }
        socket.emit('nearby_sessions_found', nearby);
    });

    socket.on('join_session', (data) => {
        const { sessionId, role, deviceName } = data;
        const validRoles = ['VALMENTAJA', 'LÄHETTÄJÄ', 'LÄHTÖ', 'MAALI', 'VÄLIAIKA', 'URHEILIJA', 'VIDEO', 'KATSOMO'];

        if (sessions[sessionId]) {
            if (!validRoles.includes(role)) {
                return socket.emit('session_joined', { success: false, error: "Virheellinen rooli" });
            }

            if (role === 'LÄHTÖ' || role === 'MAALI') {
                for (let did in sessions[sessionId].devices) {
                    if (sessions[sessionId].devices[did].role === role) {
                        delete sessions[sessionId].devices[did];
                    }
                }
            }

            sessions[sessionId].devices[socket.id] = {
                id: socket.id,
                role: role,
                name: deviceName,
                lastHeartbeat: Date.now(),
                battery: 100,
                location: null
            };

            if (role === 'URHEILIJA') {
                if (!sessions[sessionId].allAthletes) sessions[sessionId].allAthletes = [];
                const existing = sessions[sessionId].allAthletes.find(a => a.id === socket.id);
                if (!existing) {
                    let uniqueName = deviceName;
                    let count = 1;
                    while (sessions[sessionId].allAthletes.some(a => a.name.toUpperCase() === uniqueName.toUpperCase())) {
                        count++;
                        uniqueName = `${deviceName} ${count}`;
                    }
                    sessions[sessionId].allAthletes.push({ id: socket.id, name: uniqueName });
                }
            }

            socket.join(sessionId);
            console.log(`Device joined ${sessionId} as ${role} (${deviceName})`);

            socket.emit('session_joined', {
                success: true,
                session: sessions[sessionId],
                role: role
            });

            io.to(sessionId).emit('device_status_update', {
                session: sessions[sessionId]
            });
        } else {
            socket.emit('session_joined', { success: false, error: "Istuntoa ei löytynyt" });
        }
    });

    socket.on('video_available_internal', (data) => {
        const { sessionId, runnerId, videoUrl } = data;
        const session = sessions[sessionId];
        if (session) {
            // Update the URL in results or pendingResults
            const res = session.results.find(r => r.id === runnerId);
            if (res) {
                res.videoUrl = videoUrl;
                if (runCards[res.runId]) runCards[res.runId].videoUrl = videoUrl;
            }
            const pend = session.pendingResults.find(r => r.id === runnerId);
            if (pend) {
                pend.videoUrl = videoUrl;
                if (runCards[pend.runId]) runCards[pend.runId].videoUrl = videoUrl;
            }

            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('get_session_names', (sessionId) => {
        if (sessions[sessionId]) {
            socket.emit('session_names_list', {
                name: sessions[sessionId].name,
                athletes: sessions[sessionId].allAthletes || [],
                devices: Object.values(sessions[sessionId].devices || {})
            });
        } else {
            socket.emit('session_names_list', { error: "Istuntoa ei löytynyt" });
        }
    });

    socket.on('sync_time', (clientSentTime) => {
        socket.emit('sync_response', {
            clientSentTime: clientSentTime,
            serverReceivedTime: Date.now()
        });
    });

    socket.on('update_location', (data) => {
        const { sessionId, lat, lon, accuracy } = data;
        const session = sessions[sessionId];
        if (session && session.devices[socket.id]) {
            const locObj = { lat, lon, accuracy, timestamp: Date.now() };
            session.devices[socket.id].location = locObj;
            session.devices[socket.id].lastHeartbeat = Date.now();

            if (session.adminId === socket.id || !session.location) {
                session.location = locObj;
            }
            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('trigger_start', (data) => {
        const { sessionId, timestamp } = data;
        const session = sessions[sessionId];
        if (session) {
            const athlete = session.activeQueue.shift();
            if (!athlete) return;

            const runner = {
                id: athlete.id,
                runId: uuidv4(), // Unique ID for this specific run
                name: athlete.name,
                startTime: timestamp,
                splits: [],
                done: false
            };

            session.onCourse.push(runner);
            const masterIdx = session.allAthletes.findIndex(a => a.id === athlete.id);
            if (masterIdx !== -1) {
                const [moved] = session.allAthletes.splice(masterIdx, 1);
                session.allAthletes.push(moved);
            }

            io.to(sessionId).emit('timing_update', { type: 'START', runner, session });
        }
    });

    socket.on('trigger_finish', (data) => {
        const { sessionId, timestamp } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse.length > 0) {
            const runner = session.onCourse.shift();
            runner.finishTime = timestamp;
            const duration = timestamp - runner.startTime;
            runner.totalTime = duration;
            runner.done = true;

            let isSuspicious = false;
            if (session.expectedDuration) {
                const min = session.expectedDuration * 0.7;
                const max = session.expectedDuration * 1.5;
                if (duration < min || duration > max) isSuspicious = true;
            }

            if (isSuspicious) {
                runner.suspicious = true;
                session.pendingResults.push(runner);
            } else {
                session.results.unshift(runner);
                // Save to run cards
                saveRunCard(runner, session);

                if (session.forerunnerCount < 5) {
                    if (!session.expectedDuration) session.expectedDuration = duration;
                    else session.expectedDuration = (session.expectedDuration * session.forerunnerCount + duration) / (session.forerunnerCount + 1);
                    session.forerunnerCount++;
                }
            }
            io.to(sessionId).emit('timing_update', { type: 'FINISH', runner, session });
        }
    });

    socket.on('confirm_result', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session) {
            const idx = session.pendingResults.findIndex(r => r.id === runnerId);
            if (idx !== -1) {
                const runner = session.pendingResults.splice(idx, 1)[0];
                delete runner.suspicious;
                session.results.unshift(runner);
                saveRunCard(runner, session);
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    socket.on('reject_result', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session) {
            session.pendingResults = session.pendingResults.filter(r => r.id !== runnerId);
            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('manual_finish', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session) {
            const idx = session.onCourse.findIndex(r => r.id === runnerId);
            if (idx !== -1) {
                const runner = session.onCourse.splice(idx, 1)[0];
                runner.finishTime = Date.now();
                runner.totalTime = runner.finishTime - runner.startTime;
                runner.done = true;
                runner.manual = true;
                session.results.unshift(runner);
                saveRunCard(runner, session);
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    socket.on('trigger_split', (data) => {
        const { sessionId, timestamp, deviceName } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse.length > 0) {
            const runner = session.onCourse.find(r => !r.splits.some(s => s.deviceName === deviceName));
            if (runner) {
                const splitTime = timestamp - runner.startTime;
                runner.splits.push({ timestamp, duration: splitTime, deviceName });
                io.to(sessionId).emit('timing_update', { type: 'SPLIT', runner, session });
            }
        }
    });

    socket.on('add_athlete', (data) => {
        const { sessionId, name, autoQueue } = data;
        const session = sessions[sessionId];
        if (session && name) {
            let uniqueName = name;
            let count = 1;
            while (session.allAthletes.some(a => a.name.toUpperCase() === uniqueName.toUpperCase())) {
                count++;
                uniqueName = `${name} ${count}`;
            }
            const newAthlete = { id: 'MANUAL-' + Date.now(), name: uniqueName };
            session.allAthletes.push(newAthlete);
            
            if (autoQueue) {
                session.activeQueue = [newAthlete];
            }

            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('mark_dnf', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session) {
            const index = session.onCourse.findIndex(r => r.id === runnerId);
            if (index !== -1) {
                const runner = session.onCourse.splice(index, 1)[0];
                runner.status = 'DNF';
                runner.totalTime = 0;
                runner.done = true;
                session.results.unshift(runner);
                saveRunCard(runner, session);
                io.to(sessionId).emit('timing_update', { type: 'DNF', runner, session });
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    socket.on('move_to_queue', (data) => {
        const { sessionId, athleteId } = data;
        const session = sessions[sessionId];
        if (!session) {
            console.log(`[QUEUE ERROR] Session not found: ${sessionId}`);
            return;
        }

        const aid = String(athleteId);
        const athlete = session.allAthletes.find(a => String(a.id) === aid);
        
        if (!athlete) {
            console.log(`[QUEUE ERROR] Athlete ${aid} not in session ${sessionId}!`);
            return;
        }

        const currentInQueue = (session.activeQueue && session.activeQueue.length > 0) ? session.activeQueue[0] : null;

        if (currentInQueue && String(currentInQueue.id) === aid) {
            // Already there -> REMOVE
            session.activeQueue = [];
            console.log(`[QUEUE] Toggled OFF: ${athlete.name} removed.`);
        } else {
            // Not there OR different -> SET AS NEXT
            session.activeQueue = [athlete];
            console.log(`[QUEUE] Set NEXT: ${athlete.name} is now the single next starter.`);
        }

        // Broadast the updated session state to everyone
        io.to(sessionId).emit('device_status_update', { session });
    });

    socket.on('clear_queue', (data) => {
        const { sessionId } = data;
        if (sessions[sessionId]) {
            sessions[sessionId].activeQueue = [];
            io.to(sessionId).emit('device_status_update', { session: sessions[sessionId] });
            console.log(`[QUEUE] Manually CLEARED queue for ${sessionId}`);
        }
    });

    socket.on('athlete_ready', (data) => {
        const { sessionId, name } = data;
        if (sessions[sessionId]) {
            const athleteEntry = { id: socket.id, name: name || "Tuntematon" };
            if (!sessions[sessionId].activeQueue.find(a => a.id === socket.id)) {
                sessions[sessionId].activeQueue.push(athleteEntry);
            }
            io.to(sessionId).emit('device_status_update', { session: sessions[sessionId] });
        }
    });

    socket.on('heartbeat', (data) => {
        const { sessionId, battery, temp, location } = data;
        const session = sessions[sessionId];
        if (session && session.devices[socket.id]) {
            const dev = session.devices[socket.id];
            dev.lastHeartbeat = Date.now();
            dev.battery = battery;
            dev.temp = temp;
            if (location) dev.location = location;

            if (session.adminId === socket.id || !session.location) {
                if (location) session.location = location;
            }
            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('end_session', (data) => {
        const sid = (data && typeof data === 'object') ? data.sessionId : data;
        const session = sessions[sid];
        
        const device = session ? session.devices[socket.id] : null;

        if (session && device && device.role === 'VALMENTAJA') {
            console.log(`[SESSION] Coach closed session ${sid}`);
            session.ended = true; // Mark as ended
            archiveSession(session);
            io.to(sid).emit('session_ended');
            
            // Delete after a short delay to allow final emits to reach clients
            setTimeout(() => {
                delete sessions[sid];
            }, 2000);
        } else if (session) {
            console.warn(`[SECURITY] Unauthorized end_session attempt for ${sid} by ${socket.id} (Role: ${device ? device.role : 'none'})`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
    });
});

// Global Error Handler for JSON responses
app.use((err, req, res, next) => {
    console.error("[SERVER ERROR]", err);
    res.status(500).json({ 
        error: 'Palvelinvirhe tiedostoa käsiteltäessä', 
        details: err.message,
        timestamp: Date.now()
    });
});

server.listen(PORT, () => {
    console.log(`Alppikello Server running on port ${PORT}`);
});
