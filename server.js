const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Store for sessions and devices
const sessions = {};

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

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`Device connected: ${socket.id}`);

    // --- Onboarding & Session Management ---

    socket.on('create_session', (data) => {
        const sessionId = uuidv4().substring(0, 6).toUpperCase();
        sessions[sessionId] = {
            id: sessionId,
            name: data.name || "Treeni",
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
            location: null
        };
        socket.join(sessionId);
        socket.emit('session_created', sessions[sessionId]);
    });

    socket.on('end_session', (sessionId) => {
        if (sessions[sessionId]) {
            console.log(`Session ${sessionId} ended by admin.`);
            io.to(sessionId).emit('session_ended');
            delete sessions[sessionId];
        }
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
                if (dist <= radius) {
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
        const { sessionId, name } = data;
        const session = sessions[sessionId];
        if (session && name) {
            let uniqueName = name;
            let count = 1;
            while (session.allAthletes.some(a => a.name.toUpperCase() === uniqueName.toUpperCase())) {
                count++;
                uniqueName = `${name} ${count}`;
            }
            session.allAthletes.push({ id: 'MANUAL-' + Date.now(), name: uniqueName });
            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    socket.on('mark_dnf', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session) {
            const index = session.onCourse.findIndex(r => r.id === runnerId);
            if (index !== -1) {
                session.onCourse.splice(index, 1);
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    socket.on('move_to_queue', (data) => {
        const { sessionId, athleteId } = data;
        const session = sessions[sessionId];
        if (session) {
            const currentAttendee = session.activeQueue[0];
            if (currentAttendee && currentAttendee.id === athleteId) {
                session.activeQueue = [];
            } else {
                const athlete = session.allAthletes.find(a => a.id === athleteId);
                if (athlete) session.activeQueue = [athlete];
            }
            io.to(sessionId).emit('device_status_update', { session });
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

    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Alppikello Server running on port ${PORT}`);
});
