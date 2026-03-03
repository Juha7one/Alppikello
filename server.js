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
            results: [],      // History
            pendingResults: [], // Unconfirmed suspicious times
            expectedDuration: null, // Average of first successful runs
            forerunnerCount: 0
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

            // If single-instance device, remove any existing devices with the same role
            if (role === 'LÄHTÖ' || role === 'MAALI') {
                for (let did in sessions[sessionId].devices) {
                    if (sessions[sessionId].devices[did].role === role) {
                        delete sessions[sessionId].devices[did];
                    }
                }
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
                athletes: sessions[sessionId].allAthletes || [],
                devices: Object.values(sessions[sessionId].devices || {})
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

            // BLOCK GHOST STARTS: If no one is assigned to start, ignore the trigger
            if (!athlete) {
                console.log(`BLOCKED: No athlete assigned for trigger at ${timestamp}`);
                return;
            }

            const runner = {
                id: athlete.id,
                name: athlete.name,
                startTime: timestamp,
                splits: [],
                done: false
            };

            session.onCourse.push(runner);
            console.log(`START: ${runner.name} started at ${timestamp}`);

            // Reorder the master athlete list: 
            // Move the started athlete to the end of allAthletes so the order "auto-rotates" for next run
            const masterIdx = session.allAthletes.findIndex(a => a.id === athlete.id);
            if (masterIdx !== -1) {
                const [moved] = session.allAthletes.splice(masterIdx, 1);
                session.allAthletes.push(moved);
            }

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
            const runner = session.onCourse.shift();
            runner.finishTime = timestamp;
            const duration = timestamp - runner.startTime;
            runner.totalTime = duration;
            runner.done = true;

            // Logic for "Clean" Results:
            let isSuspicious = false;
            if (session.expectedDuration) {
                const min = session.expectedDuration * 0.7; // 30% margin
                const max = session.expectedDuration * 1.5;
                if (duration < min || duration > max) {
                    isSuspicious = true;
                }
            }

            if (isSuspicious) {
                runner.suspicious = true;
                session.pendingResults.push(runner);
                console.log(`SUSPICIOUS FINISH: ${runner.name} time ${duration}ms (Expected ~${session.expectedDuration}ms)`);
            } else {
                session.results.unshift(runner);

                // Update expected duration with a rolling average (first 5 runs)
                if (session.forerunnerCount < 5) {
                    if (!session.expectedDuration) {
                        session.expectedDuration = duration;
                    } else {
                        session.expectedDuration = (session.expectedDuration * session.forerunnerCount + duration) / (session.forerunnerCount + 1);
                    }
                    session.forerunnerCount++;
                }
                console.log(`FINISH: ${runner.name} finished in ${duration}ms`);
            }

            io.to(sessionId).emit('timing_update', {
                type: 'FINISH',
                runner: runner,
                session: session
            });
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
                runner.finishTime = Date.now(); // fallback to current server time
                runner.totalTime = runner.finishTime - runner.startTime;
                runner.done = true;
                runner.manual = true;
                session.results.unshift(runner);
                io.to(sessionId).emit('device_status_update', { session });
            }
        }
    });

    // From Split Node (Trigger)
    socket.on('trigger_split', (data) => {
        const { sessionId, timestamp, deviceName } = data;
        const session = sessions[sessionId];
        if (session && session.onCourse.length > 0) {
            // Find the oldest runner on course who hasn't received a split from THIS specific device yet
            const runner = session.onCourse.find(r => !r.splits.some(s => s.deviceName === deviceName));
            if (runner) {
                const splitTime = timestamp - runner.startTime;
                runner.splits.push({ timestamp, duration: splitTime, deviceName });

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
            if (!session.allAthletes) session.allAthletes = [];

            let uniqueName = name;
            let count = 1;
            while (session.allAthletes.some(a => a.name.toUpperCase() === uniqueName.toUpperCase())) {
                count++;
                uniqueName = `${name} ${count}`;
            }

            const athleteEntry = { id: 'MANUAL-' + Date.now(), name: uniqueName };
            session.allAthletes.push(athleteEntry);

            console.log(`Manual athlete ${uniqueName} added in session ${sessionId}`);
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

    // Starter (Lähtöpaikka) manages the "Next Starter" slot
    socket.on('move_to_queue', (data) => {
        const { sessionId, athleteId } = data;
        const session = sessions[sessionId];
        if (session && session.allAthletes) {
            // Current athlete in "Next Starter" slot
            const currentAttendee = session.activeQueue[0];

            // IF we click the person who is ALREADY marked as next -> Unselect them
            if (currentAttendee && currentAttendee.id === athleteId) {
                session.activeQueue = [];
                console.log(`Starter removed ${currentAttendee.name} from slot`);
            } else {
                // Find the new person from the master list
                const athlete = session.allAthletes.find(a => a.id === athleteId);
                if (athlete) {
                    // Replace/Set as the single next starter
                    session.activeQueue = [athlete];
                    console.log(`Starter set ${athlete.name} as MUST-START`);
                }
            }
            io.to(sessionId).emit('device_status_update', { session });
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
