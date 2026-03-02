const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Store for sessions and devices
const sessions = {};

app.use(express.static(path.join(__dirname, 'public')));

// Simple logging middleware
io.on('connection', (socket) => {
    console.log(`Device connected: ${socket.id}`);

    // --- Onboarding & Session Management ---

    // Create new session (usually from Admin/Coaches)
    socket.on('create_session', (data) => {
        const sessionId = uuidv4().substring(0, 6).toUpperCase();
        sessions[sessionId] = {
            id: sessionId,
            name: data.name || "Treeni",
            startTime: Date.now(),
            adminId: socket.id,
            devices: {},
            allAthletes: [], // Master list
            activeQueue: [], // Ready to start
            onCourse: [],    // Currently skiing
            results: []      // History
        };
        socket.join(sessionId);
        socket.emit('session_created', sessions[sessionId]);
    });

    // Join existing session with a role
    socket.on('join_session', (data) => {
        const { sessionId, role, deviceName } = data;
        const validRoles = ['VALMENTAJA', 'LÄHETTÄJÄ', 'LÄHTÖ', 'MAALI', 'VÄLIAIKA', 'URHEILIJA', 'VIDEO', 'KATSOMO'];

        if (sessions[sessionId]) {
            if (!validRoles.includes(role)) {
                return socket.emit('session_joined', { success: false, error: "Virheellinen rooli" });
            }

            // Register device
            sessions[sessionId].devices[socket.id] = {
                id: socket.id,
                role: role,
                name: deviceName,
                lastHeartbeat: Date.now(),
                battery: 100
            };

            // If an athlete joins, add to the master list of athletes for this session
            if (role === 'URHEILIJA') {
                if (!sessions[sessionId].allAthletes) sessions[sessionId].allAthletes = [];
                // Update or add athlete
                const existing = sessions[sessionId].allAthletes.find(a => a.id === socket.id);
                if (!existing) {
                    sessions[sessionId].allAthletes.push({ id: socket.id, name: deviceName });
                }
            }

            socket.join(sessionId);
            console.log(`Device joined session ${sessionId} as ${role} (${deviceName})`);

            console.log(`Device joined session ${sessionId} as ${role}`);
            socket.emit('session_joined', {
                success: true,
                session: sessions[sessionId],
                role: role
            });

            // Notify admin/others
            io.to(sessionId).emit('device_status_update', {
                session: sessions[sessionId]
            });
        } else {
            socket.emit('session_joined', { success: false, error: "Session not found" });
        }
    });

    // Fetch names before joining (for athlete name selection)
    socket.on('get_session_names', (sessionId) => {
        if (sessions[sessionId]) {
            socket.emit('session_names_list', {
                name: sessions[sessionId].name,
                athletes: sessions[sessionId].allAthletes || []
            });
        } else {
            socket.emit('session_names_list', { error: "Session not found" });
        }
    });

    // --- Time Synchronization (NTP-style) ---
    // Formula: Offset = ((T_received_server - T_sent_client) + (T_received_server - T_returned_client)) / 2
    socket.on('sync_time', (clientSentTime) => {
        const serverReceivedTime = Date.now();
        socket.emit('sync_response', {
            clientSentTime: clientSentTime,
            serverReceivedTime: serverReceivedTime
        });
    });

    // --- Real-time Events (Trigger / Matching) ---

    // From Start Node (Trigger)
    socket.on('trigger_start', (data) => {
        const { sessionId, timestamp } = data;
        const session = sessions[sessionId];
        if (session) {
            // Get next athlete from queue
            const athlete = session.activeQueue.shift();
            const runner = {
                id: athlete ? athlete.id : 'GHOST-' + Date.now(),
                name: athlete ? athlete.name : 'Tuntematon',
                startTime: timestamp,
                splits: [],
                done: false
            };

            session.onCourse.push(runner);
            console.log(`START: ${runner.name} started at ${timestamp}`);

            io.to(sessionId).emit('timing_update', {
                type: 'START',
                runner: runner,
                session: session
            });
        }
    });

    // From Finish Node (Trigger)
    socket.on('trigger_finish', (data) => {
        const { sessionId, timestamp } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse.length > 0) {
            // Skier who has been on course longest is likely the one finishing (FIFO)
            const runner = session.onCourse.shift(); // Remove from course
            runner.finishTime = timestamp;
            runner.totalTime = timestamp - runner.startTime;
            runner.done = true;

            session.results.unshift(runner); // Add to top of results

            console.log(`FINISH: ${runner.name} finished in ${runner.totalTime}ms`);
            io.to(sessionId).emit('timing_update', {
                type: 'FINISH',
                runner: runner,
                session: session
            });
        }
    });

    // From Split Node (Trigger)
    socket.on('trigger_split', (data) => {
        const { sessionId, timestamp } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse.length > 0) {
            // Associate split with the skier who doesn't have a split yet
            const runner = session.onCourse.find(r => r.splits.length === 0);
            if (runner) {
                const splitTime = timestamp - runner.startTime;
                runner.splits.push({ timestamp, duration: splitTime });

                console.log(`SPLIT: ${runner.name} passed split at +${splitTime}ms`);
                io.to(sessionId).emit('timing_update', {
                    type: 'SPLIT',
                    runner: runner,
                    session: session
                });
            }
        }
    });

    // Manual addition of an athlete name (without they having a phone)
    socket.on('add_athlete', (data) => {
        const { sessionId, name } = data;
        const session = sessions[sessionId];
        if (session && name) {
            const athleteEntry = { id: 'MANUAL-' + Date.now(), name: name };
            if (!session.allAthletes) session.allAthletes = [];
            session.allAthletes.push(athleteEntry);

            console.log(`Manual athlete ${name} added in session ${sessionId}`);
            io.to(sessionId).emit('device_status_update', { session });
        }
    });

    // Mark a runner as DNF (Did Not Finish)
    socket.on('mark_dnf', (data) => {
        const { sessionId, runnerId } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse) {
            const index = session.onCourse.findIndex(r => r.id === runnerId);
            if (index !== -1) {
                const runner = session.onCourse.splice(index, 1)[0];
                console.log(`DNF: ${runner.name} marked as DNF in ${sessionId}`);
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    // Starter (Lähettäjä) moves an athlete to the starting queue
    socket.on('move_to_queue', (data) => {
        const { sessionId, athleteId } = data;
        const session = sessions[sessionId];
        if (session && session.allAthletes) {
            const athlete = session.allAthletes.find(a => a.id === athleteId);
            if (athlete) {
                // Add to active queue if not already there
                if (!session.activeQueue.find(a => a.id === athleteId)) {
                    session.activeQueue.push(athlete);
                    console.log(`Starter moved ${athlete.name} to active queue in ${sessionId}`);
                    io.to(sessionId).emit('device_status_update', { session });
                }
            }
        }
    });

    // Athlete marks themselves as ready (Alternative way)
    socket.on('athlete_ready', (data) => {
        const { sessionId, name } = data;
        if (sessions[sessionId]) {
            // Add to active queue if not already there
            const athleteEntry = { id: socket.id, name: name || "Tuntematon" };
            if (!sessions[sessionId].activeQueue.find(a => a.id === socket.id)) {
                sessions[sessionId].activeQueue.push(athleteEntry);
            }

            console.log(`Athlete ${name} is ready in session ${sessionId}`);
            io.to(sessionId).emit('device_status_update', {
                session: sessions[sessionId]
            });
        }
    });

    // --- Health & Maintenance ---
    socket.on('heartbeat', (data) => {
        const { sessionId, battery, temp } = data;
        if (sessions[sessionId] && sessions[sessionId].devices[socket.id]) {
            sessions[sessionId].devices[socket.id].lastHeartbeat = Date.now();
            sessions[sessionId].devices[socket.id].battery = battery;
            sessions[sessionId].devices[socket.id].temp = temp;

            // Periodically broadcast status to admins
            io.to(sessionId).emit('device_status_update', {
                session: sessions[sessionId]
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Device disconnected: ${socket.id}`);
        // Cleanup if needed
    });
});

server.listen(PORT, () => {
    console.log(`Alppikello Server running on port ${PORT}`);
});
