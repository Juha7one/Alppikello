// --- Alppikello UI Components & Rendering ---

function showPremiumModal(config) {
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const textEl = document.getElementById('modal-text');
    const iconEl = document.getElementById('modal-icon');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    if (!overlay || !titleEl) return;

    titleEl.innerText = config.title || '';
    titleEl.style.display = config.title ? 'block' : 'none';
    textEl.innerText = config.text || '';
    iconEl.innerText = config.icon || '⚠️';
    
    confirmBtn.innerText = config.confirmText || 'VAHVISTA';
    if (config.cancelText === '') {
        cancelBtn.style.display = 'none';
    } else {
        cancelBtn.style.display = 'block';
        cancelBtn.innerText = config.cancelText || 'PERUUTA';
    }

    overlay.classList.add('active');

    const close = () => {
        overlay.classList.remove('active');
    };

    confirmBtn.onclick = () => {
        close();
        if (config.onConfirm) config.onConfirm();
    };

    cancelBtn.onclick = () => {
        close();
        if (config.onCancel) config.onCancel();
    };
}

function updateUI() {
    if (!currentSession) return;
    
    // 1. Update S3 Status Badges
    const s3ActiveNow = !!(s3Active); // Ensure boolean
    const coachS3 = document.getElementById('s3-status-badge');
    if (coachS3) {
        coachS3.innerText = s3ActiveNow ? "S3: PILVITALLENNUS AKTIIVINEN ✅" : "S3: PAIKALLINEN TALLENNUS (VÄLIAIKAINEN) ⚠️";
        coachS3.style.color = s3ActiveNow ? "var(--success)" : "var(--warning)";
        coachS3.style.borderColor = s3ActiveNow ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)";
    }
    const videoS3 = document.getElementById('video-s3-status');
    if (videoS3) {
        videoS3.innerText = s3ActiveNow ? "S3: PILVITALLENNUS ✅" : "S3: EI KÄYTÖSSÄ ⚠️";
        videoS3.style.color = s3ActiveNow ? "var(--success)" : "var(--warning)";
    }

    // 2. Update Role Badge (Coach/Katsomo)
    const coachBadge = document.getElementById('coach-role-badge');
    if (coachBadge) {
        if (currentRole === 'KATSOMO') {
            coachBadge.innerText = 'KATSOMO / LIVE';
            coachBadge.style.background = 'var(--success)';
        } else if (currentRole === 'VALMENTAJA') {
            coachBadge.innerText = 'VALMENTAJA';
            coachBadge.style.background = 'var(--accent)';
        }
    }

    // 3. Update Timers (Dynamic parts only)
    const now = getSyncedTime();
    const onCourse = currentSession.onCourse || [];
    onCourse.forEach(r => {
        const timeEl = document.getElementById(`timer-${r.id}`);
        if (timeEl) {
            timeEl.innerText = formatDuration(now - r.startTime);
        }
    });
    
    // 3. Update Clocks for ALL types of result videos
    document.querySelectorAll('video[data-trigger-time]').forEach(vEl => {
        const triggerTime = parseInt(vEl.getAttribute('data-trigger-time'));
        const startTime = parseInt(vEl.getAttribute('data-start-time'));
        const container = vEl.closest('.video-container');
        if (!container) return;

        const vClock = container.querySelector('.clock-overlay');
        const clockVal = vClock ? vClock.querySelector('.clock-val') : null;

        if (vEl && vClock && clockVal) {
            vEl.ontimeupdate = () => {
                const startTime = parseInt(vEl.getAttribute('data-start-time'));
                const videoAbsStart = parseInt(vEl.getAttribute('data-video-start-time'));
                
                vClock.style.opacity = '1';

                if (startTime && videoAbsStart && videoAbsStart > 0) {
                    const absNow = videoAbsStart + (vEl.currentTime * 1000);
                    const raceTime = (absNow - startTime) / 1000;
                    clockVal.innerText = Math.max(0, raceTime).toFixed(2);
                } else {
                    // Legacy fallback
                    const triggerTime = parseInt(vEl.getAttribute('data-trigger-time'));
                    const clipRelRace = (triggerTime - startTime) - 2000;
                    const curMs = clipRelRace + (vEl.currentTime * 1000);
                    clockVal.innerText = Math.max(0, (curMs / 1000)).toFixed(2);
                }
            };
            vEl.onpause = () => vClock.style.opacity = '0.5';
            vEl.onplay = () => vClock.style.opacity = '1';
        }
    });

    // Special case for card-video (standalone card view)
    const cardVideo = document.getElementById('card-video');
    if (cardVideo && typeof currentRun !== 'undefined') {
        const vOverlay = document.getElementById('card-video-overlay');
        const vClock = document.getElementById('card-video-clock');
        cardVideo.ontimeupdate = () => {
             vOverlay.style.opacity = '1';
             vClock.innerText = (Math.min(cardVideo.currentTime * 1000, currentRun.totalTime) / 1000).toFixed(2);
        };
    }
    // 4. Update Video View if active
    if (currentRole === 'VIDEO') {
        renderVideoView();
        if (typeof renderVideoGallery === 'function') renderVideoGallery();
    }
}

/**
 * Re-renders structural parts of the UI ONLY when data actually changes.
 * This prevents losing focus or cancelling clicks due to innerHTML overwrites.
 */
function refreshStaticViews() {
    if (!currentSession) return;
    console.log("[UI] Refreshing static views...");

    // Update session name headers across all views
    ['start', 'finish', 'lahettaja', 'lahto', 'split', 'coach', 'athlete'].forEach(id => {
        const el = document.getElementById(`${id}-session-name`);
        if (el) el.innerText = currentSession.name;
    });

    if (currentRole === 'VALMENTAJA' || currentRole === 'KATSOMO') renderValmentajaView();
    if (currentRole === 'LÄHETTÄJÄ') renderStarterView();
    if (currentRole === 'URHEILIJA') renderAthleteView();
    if (currentRole === 'VIDEO') renderVideoView();
}

function renderValmentajaView() {
    const activeEl = document.getElementById('active-skier');
    const resultEl = document.getElementById('result-list');
    const coachListEl = document.getElementById('coach-athlete-list');
    const coachCtrlEl = document.getElementById('coach-controls');
    if (!activeEl || !resultEl) return;

    const isCoach = currentRole === 'VALMENTAJA';
    if (coachCtrlEl) coachCtrlEl.style.display = isCoach ? 'block' : 'none';

    const endBtnContainer = document.getElementById('coach-only-end');
    if (endBtnContainer) endBtnContainer.style.display = isCoach ? 'block' : 'none';

    const athletes = currentSession.allAthletes || [];

    // 1. Athlete List
    if (coachListEl) {
        coachListEl.innerHTML = athletes.length ? athletes.map(a => `
            <button class="btn btn-outline" style="padding: 15px; margin-bottom: 8px; font-size: 20px; text-align: center; display: block; width: 100%;" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `).join('') : '<p>Ei nimiä listalla.</p>';
    }

    // 2. Active Runners
    const onCourse = currentSession.onCourse || [];
    const now = getSyncedTime();
    if (onCourse.length > 0) {
        activeEl.innerHTML = onCourse.map(r => {
            const runningTime = now - r.startTime;
            return `
                <div class="card" style="border-left: 8px solid var(--accent); padding: 25px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0; font-size: 34px;">${r.name.toUpperCase()}</h3>
                            <p style="color: var(--accent); font-weight: 900; margin: 8px 0; font-size: 18px;">LASKEE...</p>
                        </div>
                        <div style="text-align: right;">
                            <h2 id="timer-${r.id}" style="margin: 0; font-family: monospace; font-size: 54px; font-weight: 800;">${formatDuration(runningTime)}</h2>
                        </div>
                    </div>
                    ${isCoach ? `<div style="display:flex; gap:10px; margin-top:15px;">
                        <button class="btn btn-danger" onclick="markRunnerDNF('${r.id}')">DNF</button>
                        <button class="btn btn-outline" style="color: var(--warning);" onclick="manualFinish('${r.id}')">MANUAALI</button>
                    </div>` : ''}
                </div>
            `;
        }).join('');
    } else {
        activeEl.innerHTML = `<div style="text-align: center; padding: 40px; opacity:0.3;">RATA VAPAA</div>`;
    }

    // 3. Results
    const results = currentSession.results || [];
    if (results.length > 0) {
        resultEl.innerHTML = results.map((r, i) => {
            const safeRunId = r.runId || `run-${i}`;
            const startTimeStr = r.startTime ? new Date(r.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--';
            
            const splitList = (r.splits || []).map((s, idx) => 
                `<div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
                    <span style="color: var(--accent); font-weight: 800;">⏱️ V${idx + 1}:</span> 
                    <span style="font-weight: 700;">${formatDuration(s.duration)} s</span> 
                    <small style="opacity: 0.5;">(${s.deviceName || 'KENNO'})</small>
                </div>`
            ).join('');

            let videos = r.videos || (r.videoUrl ? [{ url: r.videoUrl, role: 'video', triggerTime: r.finishTime || r.startTime + (r.totalTime || 0) }] : []);
            videos = [...videos].sort((a, b) => (a.triggerTime || 0) - (b.triggerTime || 0));
            
            let videoHtml = '';
            if (videos.length > 0) {
                const first = videos[0];
                const videoDataJson = JSON.stringify(videos).replace(/"/g, '&quot;');
                
                videoHtml = `
                    <div class="video-container playlist-player" 
                         id="player-${safeRunId}" 
                         data-videos="${videoDataJson}" 
                         data-current-index="0"
                         data-start-time="${r.startTime}"
                         style="width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1);">
                        
                        <video id="vid-el-${safeRunId}" 
                               src="${first.url}" 
                               data-trigger-time="${first.triggerTime || r.startTime}"
                               data-video-start-time="${first.videoStartTime || 0}"
                               data-start-time="${r.startTime}"
                               controls playsinline 
                               style="width: 100%; height: 100%; object-fit: contain;" 
                               onended="playNextClip('${safeRunId}')"
                               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                        </video>
                        
                        <div style="display:none; color:rgba(255,0,0,0.5); font-size:10px; font-weight:900;">VIDEOVIRHE</div>
                        
                        <div class="role-badge" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; color: var(--accent); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);">
                            ${(first.role || 'VIDEO').toUpperCase()}
                        </div>

                        <div class="clock-overlay" style="position: absolute; bottom: 50px; left: 15px; pointer-events: none; background: rgba(0,0,0,0.6); padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px); transition: opacity 0.3s; opacity: 0;">
                            <div style="font-size: 8px; font-weight: 900; color: var(--accent); letter-spacing: 1px; line-height: 1;">${(r.name || 'LASKIJA').toUpperCase()}</div>
                            <div class="clock-val" style="font-size: 20px; font-weight: 900; font-family: monospace; line-height: 1.2;">0.00</div>
                        </div>

                        ${videos.length > 1 ? `
                            <div class="playlist-controls" style="position: absolute; top: 10px; left: 10px; display: flex; gap: 5px;">
                                ${videos.map((_, idx) => `
                                    <div onclick="switchClip('${safeRunId}', ${idx})" style="width: 20px; height: 4px; background: ${idx === 0 ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}; border-radius: 2px; cursor: pointer;"></div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                videoHtml = `
                    <div class="video-container" id="video-placeholder-${safeRunId}" style="width: 100%; aspect-ratio: 16/9; background: #000; margin: 12px 0; border-radius: 12px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="text-align: center; opacity: 0.5;">
                            <div style="font-size: 24px; margin-bottom: 8px;">🎬</div>
                            <div style="font-size: 11px; font-weight: 900; letter-spacing: 1px;">ODOTETAAN VIDEOTA...</div>
                            <div style="font-size: 9px; margin-top: 4px; opacity: 0.6;">(AUTOMAATTINEN PARITUS)</div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="card" style="margin-bottom:15px; border-left: 4px solid #fff; padding-bottom: 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                        <div>
                            <span style="opacity:0.3; font-size: 11px;">#${results.length - i} • ${startTimeStr}</span>
                            <div style="font-weight: 900; font-size: 22px; margin: 4px 0;">${(r.name || 'TUNTEMATON').toUpperCase()}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size: 28px; font-weight: 900; color: ${r.status === 'DNF' ? '#ef4444' : 'var(--accent)'};">
                                ${r.status === 'DNF' ? 'DNF' : formatDuration(r.totalTime)}
                            </div>
                        </div>
                    </div>

                    ${videoHtml}

                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px;">
                        <div style="display: flex; flex-direction: column; gap: 4px;">${splitList}</div>
                        <button class="btn-mini" onclick="shareRun('${safeRunId}')" style="background: rgba(255,255,255,0.1); padding: 8px 15px;">JAA TULOSKORTTI 🔗</button>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        resultEl.innerHTML = `<p style="text-align:center; opacity:0.3; padding:20px;">Ei tuloksia vielä.</p>`;
    }
}

function renderStarterView() {
    const queueEl = document.getElementById('starter-queue-view');
    const listEl = document.getElementById('starter-skier-list');
    if (!queueEl || !listEl) return;

    const queue = currentSession.activeQueue || [];
    const athletes = currentSession.allAthletes || [];

    if (queue.length > 0) {
        const next = queue[0];
        queueEl.innerHTML = `
            <div onclick="clearQueue()" style="background: var(--accent); padding: 40px; border-radius: 24px; text-align: center; cursor: pointer; border: 2px solid rgba(255,255,255,0.2);">
                <p style="font-weight:900; opacity:0.8; margin:0 0 10px 0;">SEURAAVA LÄHTIJÄ:</p>
                <h1 style="font-size: 72px; margin:0; line-height: 1;">${next.name.toUpperCase()}</h1>
                <p style="font-size: 11px; margin-top: 15px; opacity: 0.6;">(Paina peruaksesi)</p>
            </div>
        `;
    } else {
        queueEl.innerHTML = `<div style="padding: 40px; text-align:center; opacity:0.3;">JONO TYHJÄ</div>`;
    }

    listEl.innerHTML = athletes.map(a => {
        const isInQueue = queue.some(q => String(q.id) === String(a.id));
        const style = isInQueue ? 'background: var(--accent); border-color: var(--accent); color: #fff;' : '';
        return `
            <button class="btn btn-outline" style="padding:15px; width:100%; margin-bottom:10px; ${style}" onclick="addToQueue('${a.id}')">
                ${a.name.toUpperCase()}
            </button>
        `;
    }).join('');
}

function renderAthleteView() {
    const listEl = document.getElementById('athlete-results-list');
    if (!listEl) return;

    const results = currentSession.results || [];
    const myResults = results.filter(r => r.name === userName);

    listEl.innerHTML = myResults.length ? myResults.map((r, i) => {
        const safeRunId = r.runId || `athlete-run-${i}`;
        let videos = r.videos || (r.videoUrl ? [{ url: r.videoUrl, role: 'video', triggerTime: r.finishTime || r.startTime + (r.totalTime || 0) }] : []);
        videos = [...videos].sort((a, b) => (a.triggerTime || 0) - (b.triggerTime || 0));
        const videoDataJson = JSON.stringify(videos).replace(/"/g, '&quot;');
        
        let videoHtml = '';
        if (videos.length > 0) {
            const first = videos[0];
            videoHtml = `
                <div class="video-container playlist-player" 
                     id="player-${safeRunId}" 
                     data-videos="${videoDataJson}" 
                     data-current-index="0"
                     data-start-time="${r.startTime}"
                     style="width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1); margin-top: 10px;">
                    <video id="vid-el-${safeRunId}" src="${first.url}" data-trigger-time="${first.triggerTime || r.startTime}" data-start-time="${r.startTime}" controls playsinline style="width: 100%; height: 100%; object-fit: contain;" onended="playNextClip('${safeRunId}')"></video>
                    <div class="role-badge" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; color: var(--accent);">${(first.role || 'VIDEO').toUpperCase()}</div>
                    <div class="clock-overlay" style="position: absolute; bottom: 50px; left: 15px; pointer-events: none; background: rgba(0,0,0,0.6); padding: 5px 12px; border-radius: 8px; transition: opacity 0.3s; opacity: 0;">
                        <div class="clock-val" style="font-size: 20px; font-weight: 900; font-family: monospace;">0.00</div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="card" style="margin-bottom:15px; padding-bottom: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                    <span style="font-weight:800; opacity: 0.5;">LASKU #${myResults.length - i}</span>
                    <span style="font-size:24px; font-weight:900; color: var(--accent);">${formatDuration(r.totalTime)}</span>
                </div>
                ${videoHtml}
            </div>
        `;
    }).join('') : '<p style="text-align:center; opacity:0.3; padding: 20px;">Ei omia laskuja vielä.</p>';
}

function renderVideoView() {
    const infoEl = document.getElementById('video-node-info');
    if (!infoEl || !currentSession || !currentSession.devices) return;

    // 1. Find Start Location (Fallback to session location if no active starter device)
    let startLoc = currentSession.location || null;
    for (let id in currentSession.devices) {
        if (currentSession.devices[id].role === 'LÄHTÖ' && currentSession.devices[id].location) {
            startLoc = currentSession.devices[id].location;
            break;
        }
    }

    // 2. Find My Location
    let myLoc = null;
    const myDevice = currentSession.devices[socket.id];
    if (myDevice && myDevice.location) myLoc = myDevice.location;

    // 3. Calculate Distance & Speed
    if (startLoc && myLoc) {
        const dist = getDistanceBetween(startLoc.lat, startLoc.lon, myLoc.lat, myLoc.lon);
        const distText = `SIJAINTI: ${dist.toFixed(0)}m LÄHDÖSTÄ`;

        let statusText = "VALMIINA";
        let countdownText = "";

        if (activeRunnerOnCourse) {
            statusText = `RADALLA: ${activeRunnerOnCourse.name.toUpperCase()}`;
            const elapsed = (getSyncedTime() - activeRunnerOnCourse.startTime) / 1000;
            const remaining = (dist / 18) - elapsed; // 18m/s avg

            if (remaining > 0) countdownText = `ENNUSTE: ${remaining.toFixed(1)}s`;
            else if (remaining > -5) countdownText = "LASKIJA KOHDALLA";
            else countdownText = "OHITETTU";
        }

        if (hasRecordedForCurrentRunner) {
            statusText = "TALLENNETTU ✅";
            countdownText = "Odotetaan seuraavaa...";
        }

        infoEl.innerHTML = `
            <div style="font-size: 22px; color: var(--accent); font-weight: 900;">${statusText}</div>
            <div style="font-size: 16px; color: #fff; font-weight: 700;">${countdownText}</div>
            <div style="font-size: 10px; opacity: 0.6; margin-top:5px;">${distText}</div>
        `;
    } else {
        const missing = !startLoc ? "LÄHTÖPISTE" : "KAMERAN GPS";
        infoEl.innerHTML = `<div style="opacity:0.5; font-size:12px;">ODOTTAA: ${missing}...</div>`;
    }
}

// --- Playlist Player Logic ---

function switchClip(runId, index) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;
    
    const videos = JSON.parse(player.getAttribute('data-videos'));
    const vidEl = document.getElementById(`vid-el-${runId}`);
    const badge = player.querySelector('.role-badge');
    const startTime = parseInt(player.getAttribute('data-start-time'));
    
    const vidStartTime = parseInt(player.getAttribute('data-video-start-time') || 0);
    
    const clip = videos[index];
    if (vidEl && clip) {
        vidEl.src = clip.url;
        vidEl.setAttribute('data-trigger-time', clip.triggerTime || startTime);
        vidEl.setAttribute('data-video-start-time', clip.videoStartTime || 0);
        if (badge) badge.innerText = (clip.role || 'VIDEO').toUpperCase();
        player.setAttribute('data-current-index', index);
        
        // Update indicators
        const indicators = player.querySelectorAll('.playlist-controls div');
        indicators.forEach((ind, i) => {
            ind.style.background = i === index ? 'var(--accent)' : 'rgba(255,255,255,0.2)';
        });
        
        vidEl.play().catch(() => {});
    }
}

function playNextClip(runId) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;
    
    const currentIndex = parseInt(player.getAttribute('data-current-index'));
    const videos = JSON.parse(player.getAttribute('data-videos'));
    
    if (currentIndex < videos.length - 1) {
        switchClip(runId, currentIndex + 1);
    }
}

window.switchClip = switchClip;
window.playNextClip = playNextClip;
