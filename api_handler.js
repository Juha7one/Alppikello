/**
 * Node.js Express mirror of public/api.php for local development when PHP is not installed.
 * Uses the exact same file-backed JSON storage in data/sessions/, data/runcards/, and archives/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function registerApiPhpRoutes(app, upload) {
    const baseDir = __dirname;
    const dataDir = path.join(baseDir, 'data');
    const sessionsDir = path.join(dataDir, 'sessions');
    const runcardsDir = path.join(dataDir, 'runcards');
    const archivesDir = path.join(baseDir, 'archives');
    const videosDir = path.join(baseDir, 'public', 'uploads', 'videos');

    [dataDir, sessionsDir, runcardsDir, archivesDir, videosDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    const sanitizeId = (id) => String(id || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    const getSessionPath = (sid) => path.join(sessionsDir, `${sanitizeId(sid)}.json`);

    function readSession(sid) {
        const p = getSessionPath(sid);
        if (!fs.existsSync(p)) return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {
            return null;
        }
    }

    function writeSession(sid, session) {
        session.updatedAt = Date.now();
        session.version = (session.version || 0) + 1;
        fs.writeFileSync(getSessionPath(sid), JSON.stringify(session, null, 2), 'utf8');
    }

    function saveRunCardFile(runner, session) {
        if (!runner || !runner.runId) return;
        const userRuns = (session.results || []).filter(r => r.name === runner.name);
        const card = {
            id: runner.runId,
            runId: runner.runId,
            name: runner.name || 'Laskija',
            runNumber: userRuns.length || 1,
            startTime: runner.startTime || Date.now(),
            finishTime: runner.finishTime || null,
            totalTime: runner.totalTime || 0,
            splits: runner.splits || [],
            videoUrl: runner.videoUrl || null,
            videos: runner.videos || [],
            sessionName: session.name || session.id,
            sessionId: session.id,
            timestamp: Date.now(),
            status: runner.status || 'OK',
            sessionResults: (session.results || []).map(r => ({
                name: r.name || '',
                totalTime: r.totalTime || 0,
                status: r.status || 'OK',
                runId: r.runId || ''
            }))
        };
        fs.writeFileSync(path.join(runcardsDir, `${sanitizeId(runner.runId)}.json`), JSON.stringify(card, null, 2), 'utf8');
    }

    function pairVideoWithSessionRuns(session, videoClip, explicitRunId) {
        let paired = false;
        let vStart = Number(videoClip.videoStartTime) || 0;
        let vEnd = Number(videoClip.videoEndTime) || 0;
        const vTrig = Number(videoClip.triggerTime) || vEnd;
        if (vStart <= 0 && vTrig > 0) vStart = vTrig - 8000;
        if (vEnd <= 0 && vTrig > 0) vEnd = vTrig + 4000;

        const attach = (runner) => {
            if (!Array.isArray(runner.videos)) runner.videos = [];
            const idx = runner.videos.findIndex(v => v.url === videoClip.url);
            if (idx !== -1) {
                runner.videos[idx] = { ...runner.videos[idx], ...videoClip };
            } else {
                runner.videos.push(videoClip);
            }
            runner.videos.sort((a, b) => ((a.videoStartTime || a.triggerTime || 0) - (b.videoStartTime || b.triggerTime || 0)));
            runner.videoUrl = runner.videos[0].url;
        };

        const matchesWindow = (runner) => {
            const rStart = Number(runner.startTime) || 0;
            if (rStart <= 0) return false;
            const rFinish = Number(runner.finishTime) || (rStart + 90000);
            const winStart = rStart - 5000;
            const winEnd = rFinish + 6000;
            if (vStart > 0 && vEnd > 0) return (vStart <= winEnd) && (vEnd >= winStart);
            return (vTrig >= winStart && vTrig <= winEnd);
        };

        if (explicitRunId && explicitRunId !== 'N/A' && explicitRunId !== 'undefined') {
            ['results', 'onCourse', 'pendingResults'].forEach(key => {
                (session[key] || []).forEach(r => {
                    if (r.runId === explicitRunId) {
                        attach(r);
                        saveRunCardFile(r, session);
                        paired = true;
                    }
                });
            });
        }

        if (!paired) {
            for (const key of ['results', 'onCourse', 'pendingResults']) {
                const list = session[key] || [];
                const found = list.find(matchesWindow);
                if (found) {
                    attach(found);
                    saveRunCardFile(found, session);
                    paired = true;
                    break;
                }
            }
        }
        return paired;
    }

    function flushUnpairedVideos(session) {
        if (!Array.isArray(session.unpairedVideos) || session.unpairedVideos.length === 0) return;
        session.unpairedVideos = session.unpairedVideos.filter(clip => {
            const ok = pairVideoWithSessionRuns(session, clip, clip.runId);
            return !ok && (Date.now() - (clip.uploadedAt || Date.now()) < 15 * 60 * 1000);
        });
    }

    app.all(['/api.php', '/public/api.php'], upload.single('video'), (req, res) => {
        res.setHeader('X-Server-Time', String(Date.now()));
        const action = req.query.action || (req.body && req.body.action) || '';

        if (action === 'time') {
            return res.json({ serverTime: Date.now(), storageActive: true });
        }

        if (action === 'create_session') {
            const body = req.body || {};
            const baseId = sanitizeId(body.id || 'TREENI');
            let sessionId = baseId;
            let c = 1;
            while (fs.existsSync(getSessionPath(sessionId))) {
                sessionId = `${baseId}-${c++}`;
            }
            const deviceId = body.deviceId || ('dev_' + crypto.randomBytes(4).toString('hex'));
            const session = {
                id: sessionId,
                name: body.name || sessionId,
                startTime: Date.now(),
                updatedAt: Date.now(),
                version: 1,
                adminId: deviceId,
                devices: {
                    [deviceId]: {
                        id: deviceId,
                        role: 'VALMENTAJA',
                        name: body.creatorName || 'Valmentaja',
                        lastHeartbeat: Date.now(),
                        battery: 100,
                        location: body.location || null
                    }
                },
                allAthletes: [],
                activeQueue: [],
                onCourse: [],
                results: [],
                pendingResults: [],
                pendingFinishes: [],
                unpairedVideos: [],
                processedEvents: [],
                expectedDuration: null,
                forerunnerCount: 0,
                location: body.location || null,
                ended: false
            };
            writeSession(sessionId, session);
            return res.json({ success: true, session });
        }

        if (action === 'join_session') {
            const body = req.body || {};
            const session = readSession(body.sessionId);
            if (!session || session.ended) {
                return res.json({ success: false, error: 'Istuntoa ei löytynyt' });
            }
            const role = body.role || 'KATSOMO';
            const deviceName = body.deviceName || 'Laite';
            const deviceId = body.deviceId || ('dev_' + crypto.randomBytes(4).toString('hex'));

            if (role === 'LÄHTÖ' || role === 'MAALI') {
                Object.keys(session.devices || {}).forEach(did => {
                    if (session.devices[did].role === role && did !== deviceId) delete session.devices[did];
                });
            }
            session.devices[deviceId] = {
                id: deviceId,
                role,
                name: deviceName,
                lastHeartbeat: Date.now(),
                battery: 100,
                location: body.location || null
            };
            if (role === 'URHEILIJA') {
                const exists = (session.allAthletes || []).some(a => a.id === deviceId || a.name.toUpperCase() === deviceName.toUpperCase());
                if (!exists) session.allAthletes.push({ id: deviceId, name: deviceName });
            }
            writeSession(session.id, session);
            return res.json({ success: true, session, role });
        }

        if (action === 'session_state') {
            const sid = req.query.sessionId || '';
            const sinceV = parseInt(req.query.v || '-1', 10);
            const session = readSession(sid);
            if (!session) return res.status(404).json({ error: 'Istuntoa ei löytynyt', ended: true });
            if (session.ended) return res.json({ ended: true, session });
            if (sinceV > 0 && sinceV === session.version) {
                return res.json({ notModified: true, version: session.version, serverTime: Date.now() });
            }
            return res.json({ notModified: false, version: session.version, session, serverTime: Date.now() });
        }

        if (action === 'nearby_sessions') {
            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
            const nearby = [];
            files.forEach(f => {
                try {
                    const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
                    if (s && !s.ended) {
                        nearby.push({
                            id: s.id,
                            name: s.name || s.id,
                            distance: '0.10',
                            athleteCount: (s.allAthletes || []).length
                        });
                    }
                } catch (e) {}
            });
            return res.json({ sessions: nearby });
        }

        if (action === 'event') {
            const body = req.body || {};
            const events = Array.isArray(body.events) ? body.events : [body];
            const sid = (events[0] && events[0].sessionId) || body.sessionId;
            const session = readSession(sid);
            if (!session) return res.status(404).json({ success: false, error: 'Istuntoa ei löytynyt' });

            events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            let lastTimingEvent = null;

            events.forEach(ev => {
                if (ev.eventId && session.processedEvents.includes(ev.eventId)) return;
                if (ev.eventId) session.processedEvents.push(ev.eventId);
                const ts = Number(ev.timestamp) || Date.now();

                switch (ev.type) {
                    case 'trigger_start':
                    case 'START': {
                        const athlete = (session.activeQueue || []).shift();
                        if (!athlete) break;
                        const runner = {
                            id: athlete.id,
                            runId: ev.runId || ('run_' + ts + '_' + crypto.randomBytes(2).toString('hex')),
                            name: athlete.name,
                            startTime: ts,
                            splits: [],
                            videos: [],
                            videoUrl: null,
                            done: false
                        };
                        session.onCourse.push(runner);
                        flushUnpairedVideos(session);
                        lastTimingEvent = { type: 'START', runner };
                        break;
                    }
                    case 'trigger_split':
                    case 'SPLIT': {
                        const devName = ev.deviceName || 'Väliaika';
                        const runner = (session.onCourse || []).find(r => ts > r.startTime && !(r.splits || []).some(s => s.deviceName === devName));
                        if (runner) {
                            runner.splits.push({ timestamp: ts, duration: ts - runner.startTime, deviceName: devName });
                            runner.splits.sort((a, b) => a.duration - b.duration);
                            lastTimingEvent = { type: 'SPLIT', runner };
                        }
                        break;
                    }
                    case 'trigger_finish':
                    case 'FINISH': {
                        if (session.onCourse.length > 0) {
                            const runner = session.onCourse.shift();
                            runner.finishTime = ts;
                            runner.totalTime = Math.max(0, ts - runner.startTime);
                            runner.done = true;
                            session.results.unshift(runner);
                            flushUnpairedVideos(session);
                            saveRunCardFile(runner, session);
                            lastTimingEvent = { type: 'FINISH', runner };
                        }
                        break;
                    }
                    case 'move_to_queue': {
                        const aid = String(ev.athleteId || '');
                        const found = (session.allAthletes || []).find(a => String(a.id) === aid);
                        if (found) {
                            const cur = session.activeQueue[0];
                            session.activeQueue = (cur && String(cur.id) === aid) ? [] : [found];
                        }
                        break;
                    }
                    case 'clear_queue':
                        session.activeQueue = [];
                        break;
                    case 'add_athlete': {
                        const name = String(ev.name || '').trim();
                        if (name) {
                            const newAth = { id: 'MANUAL-' + Date.now(), name };
                            session.allAthletes.push(newAth);
                            if (ev.autoQueue) session.activeQueue = [newAth];
                        }
                        break;
                    }
                    case 'mark_dnf': {
                        const idx = session.onCourse.findIndex(r => String(r.id) === String(ev.runnerId));
                        if (idx !== -1) {
                            const [runner] = session.onCourse.splice(idx, 1);
                            runner.status = 'DNF';
                            runner.totalTime = 0;
                            runner.done = true;
                            session.results.unshift(runner);
                            saveRunCardFile(runner, session);
                        }
                        break;
                    }
                    case 'manual_finish': {
                        const idx = session.onCourse.findIndex(r => String(r.id) === String(ev.runnerId));
                        if (idx !== -1) {
                            const [runner] = session.onCourse.splice(idx, 1);
                            runner.finishTime = ts;
                            runner.totalTime = Math.max(0, ts - runner.startTime);
                            runner.done = true;
                            runner.manual = true;
                            session.results.unshift(runner);
                            flushUnpairedVideos(session);
                            saveRunCardFile(runner, session);
                        }
                        break;
                    }
                    case 'update_session_name':
                        if (ev.name) session.name = ev.name;
                        break;
                    case 'end_session': {
                        session.ended = true;
                        session.archivedAt = Date.now();
                        const archName = `session_${sanitizeId(session.name)}_${Date.now()}.json`;
                        fs.writeFileSync(path.join(archivesDir, archName), JSON.stringify(session, null, 2), 'utf8');
                        break;
                    }
                }
            });

            writeSession(sid, session);
            return res.json({ success: true, session, timingEvent: lastTimingEvent, serverTime: Date.now() });
        }

        if (action === 'upload_video') {
            if (!req.file) return res.status(400).json({ success: false, error: 'Ei videotiedostoa' });
            const sid = req.body.sessionId || '';
            const runId = req.body.runId || '';
            const role = req.body.role || 'VIDEO';
            const cameraName = req.body.cameraName || role;
            const triggerTime = Number(req.body.triggerTime) || Date.now();
            const videoStartTime = Number(req.body.videoCaptureStartTime) || 0;
            const videoEndTime = Number(req.body.videoCaptureEndTime) || Date.now();

            const videoUrl = req.file.location || `/uploads/${req.file.filename}`;
            const clip = {
                id: 'vid_' + crypto.randomBytes(4).toString('hex'),
                url: videoUrl,
                role,
                cameraName,
                triggerTime,
                videoStartTime,
                videoEndTime,
                durationMs: (videoStartTime > 0 && videoEndTime > videoStartTime) ? (videoEndTime - videoStartTime) : 0,
                uploadedAt: Date.now(),
                runId: (runId && runId !== 'N/A') ? runId : null
            };

            const session = readSession(sid);
            let paired = false;
            if (session) {
                paired = pairVideoWithSessionRuns(session, clip, runId);
                if (!paired) {
                    session.unpairedVideos = session.unpairedVideos || [];
                    session.unpairedVideos.push(clip);
                }
                writeSession(sid, session);
            }
            return res.json({ success: true, url: videoUrl, video: clip, paired, session });
        }

        if (action === 'get_run') {
            const runId = sanitizeId(req.query.runId || '');
            const p = path.join(runcardsDir, `${runId}.json`);
            if (fs.existsSync(p)) {
                return res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
            }
            return res.status(404).json({ error: 'Suoritusta ei löytynyt' });
        }

        if (action === 'archives') {
            const files = fs.readdirSync(archivesDir).filter(f => f.endsWith('.json'));
            const list = files.map(f => {
                const d = JSON.parse(fs.readFileSync(path.join(archivesDir, f), 'utf8'));
                return {
                    filename: f,
                    name: d.name || f,
                    date: d.archivedAt || d.startTime || Date.now(),
                    athleteCount: (d.results || []).length,
                    athletes: [...new Set((d.results || []).map(r => r.name))],
                    autoArchived: !!d.autoArchived
                };
            }).sort((a, b) => b.date - a.date);
            return res.json(list);
        }

        if (action === 'get_archive') {
            let fn = path.basename(req.query.filename || '');
            if (!fn.endsWith('.json')) fn += '.json';
            const p = path.join(archivesDir, fn);
            if (!fs.existsSync(p)) return res.status(404).json({ error: 'Arkistoa ei löytynyt' });
            return res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
        }

        if (action === 'delete_archive') {
            let fn = path.basename(req.query.filename || '');
            if (!fn.endsWith('.json')) fn += '.json';
            const p = path.join(archivesDir, fn);
            if (fs.existsSync(p)) fs.unlinkSync(p);
            return res.json({ success: true });
        }

        if (action === 'delete_archive_run') {
            let fn = path.basename(req.query.filename || '');
            const runId = req.query.runId || '';
            if (!fn.endsWith('.json')) fn += '.json';
            const p = path.join(archivesDir, fn);
            if (!fs.existsSync(p)) return res.status(404).json({ error: 'Arkistoa ei löytynyt' });
            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
            d.results = (d.results || []).filter(r => r.runId !== runId);
            fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
            return res.json({ success: true, remaining: d.results.length });
        }

        return res.status(400).json({ error: 'Tuntematon toiminto: ' + action });
    });
};
