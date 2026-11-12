// --- Alppikello UI Components, Rendering & Multi-Camera Synchronized Player ---

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

    const iconName = config.icon || 'warning';
    iconEl.innerHTML = `<span class="material-symbols-rounded icon-xl" aria-hidden="true">${iconName}</span>`;
    
    confirmBtn.innerText = config.confirmText || 'VAHVISTA';
    if (config.cancelText === '') {
        cancelBtn.style.display = 'none';
    } else {
        cancelBtn.style.display = 'inline-flex';
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
    
    // Update Timers (Dynamic parts ONLY: Skiers on course) using local calibrated monotonic clock
    const now = getSyncedTime();
    const onCourse = currentSession.onCourse || [];
    onCourse.forEach(r => {
        const timeEl = document.getElementById(`timer-${r.id}`);
        if (timeEl) {
            timeEl.innerText = formatDuration(Math.max(0, now - r.startTime));
        }
    });

    // Update Video View if active
    if (currentRole === 'VIDEO') {
        renderVideoView();
        if (typeof renderVideoGallery === 'function') renderVideoGallery();
    }
}

/**
 * Re-renders structural parts of the UI ONLY when data actually changes
 * or when rolename/roles specific features need updating.
 */
function updateUILayout() {
    if (!currentSession) return;

    // 1. Session name and code in the card
    const sNameEl = document.getElementById('coach-session-name');
    if (sNameEl) sNameEl.innerText = currentSession.name.toUpperCase();

    ['start', 'finish', 'lahettaja', 'lahto', 'split', 'athlete', 'maali'].forEach(id => {
        const el = document.getElementById(`${id}-session-name`);
        if (el) el.innerText = currentSession.name;
    });

    // 2. Role-based visibility (The Local End Session button)
    const endBtnContainer = document.getElementById('coach-only-end-local');
    if (endBtnContainer) {
        if (currentRole === 'VALMENTAJA') {
            endBtnContainer.style.setProperty('display', 'block', 'important');
        } else {
            endBtnContainer.style.setProperty('display', 'none', 'important');
        }
    }

    // 3. Storage status badges
    const storageActiveNow = !!(s3Active);
    const coachS3Resource = document.getElementById('s3-status-badge');
    if (coachS3Resource) {
        coachS3Resource.innerHTML = `${iconHtml(storageActiveNow ? 'cloud_done' : 'error', 'icon-sm')} <span>${storageActiveNow ? "TALLENNUS: OK" : "TALLENNUS: VIRHE"}</span>`;
        coachS3Resource.style.color = storageActiveNow ? "var(--success)" : "var(--danger)";
        coachS3Resource.style.borderColor = storageActiveNow ? "var(--success)" : "var(--danger)";
    }
    const videoS3Resource = document.getElementById('video-s3-status');
    if (videoS3Resource) {
        videoS3Resource.innerText = storageActiveNow ? 'TALLENNUS: OK' : 'TALLENNUS: VIRHE';
        videoS3Resource.style.color = storageActiveNow ? 'var(--success)' : 'var(--danger)';
    }

    // 4. Role Badges
    const coachBadge = document.getElementById('coach-role-badge');
    if (coachBadge) {
        if (currentRole === 'KATSOMO') {
            coachBadge.innerHTML = `${iconHtml('visibility', 'icon-sm')} <span>KATSOMO / LIVE</span>`;
            coachBadge.style.background = 'var(--success)';
            coachBadge.style.color = '#052e16';
        } else if (currentRole === 'VALMENTAJA') {
            coachBadge.innerHTML = `${iconHtml('analytics', 'icon-sm')} <span>VALMENTAJA</span>`;
            coachBadge.style.background = 'var(--accent)';
            coachBadge.style.color = '#ffffff';
        }
    }

    if (currentRole === 'VALMENTAJA' || currentRole === 'KATSOMO') {
        renderValmentajaView();
    }
    if (currentRole === 'LÄHETTÄJÄ') renderStarterView();
    if (currentRole === 'URHEILIJA') renderAthleteView();
    if (currentRole === 'VIDEO') renderVideoView();
}

// ============================================================================
// MULTI-CAMERA TIMESTAMP NORMALIZATION & SYNCHRONIZED PLAYBACK ENGINE
// ============================================================================

function normalizeRunVideos(r) {
    const startTime = Number(r.startTime) || 0;
    const totalTime = Number(r.totalTime) || 0;
    let rawVideos = Array.isArray(r.videos) && r.videos.length > 0
        ? r.videos
        : (r.videoUrl ? [{ url: r.videoUrl, role: 'VIDEO', triggerTime: r.finishTime || (startTime + totalTime) }] : []);

    const normalized = rawVideos.map((v, idx) => {
        const trig = Number(v.triggerTime) || (startTime + totalTime);
        let vStart = Number(v.videoStartTime) || 0;
        let vEnd = Number(v.videoEndTime) || 0;
        const durMs = Number(v.durationMs) || 0;

        if (vStart <= 0) {
            vStart = trig - 4000;
        }
        if (vEnd <= 0 || vEnd <= vStart) {
            vEnd = durMs > 0 ? (vStart + durMs) : Math.max(trig + 4000, vStart + 10000);
        }

        const camLabel = (v.cameraName || v.role || `Kamera ${idx + 1}`).toUpperCase();
        const relStartSec = startTime > 0 ? Math.max(0, (vStart - startTime) / 1000) : 0;
        const relEndSec = startTime > 0 ? Math.max(relStartSec, (vEnd - startTime) / 1000) : 0;

        return {
            ...v,
            cameraLabel: camLabel,
            role: (v.role || 'VIDEO').toUpperCase(),
            videoStartTime: vStart,
            videoEndTime: vEnd,
            triggerTime: trig,
            relStartSec: relStartSec,
            relEndSec: relEndSec
        };
    });

    normalized.sort((a, b) => a.videoStartTime - b.videoStartTime);
    return normalized;
}

function getVideoRaceTimeSec(vEl) {
    const startTime = Number(vEl.getAttribute('data-start-time')) || 0;
    const videoAbsStart = Number(vEl.getAttribute('data-video-start-time')) || 0;
    const triggerTime = Number(vEl.getAttribute('data-trigger-time')) || 0;
    const totalTimeMs = Number(vEl.getAttribute('data-total-time')) || 0;

    let raceSec = 0;
    if (startTime > 0 && videoAbsStart > 0) {
        const absNow = videoAbsStart + (vEl.currentTime * 1000);
        raceSec = (absNow - startTime) / 1000;
    } else if (startTime > 0 && triggerTime > 0) {
        const clipRelRace = (triggerTime - startTime) - 2000;
        raceSec = (clipRelRace + (vEl.currentTime * 1000)) / 1000;
    } else {
        raceSec = vEl.currentTime || 0;
    }

    raceSec = Math.max(0, raceSec);
    if (totalTimeMs > 0) {
        raceSec = Math.min(raceSec, totalTimeMs / 1000);
    }
    return raceSec;
}

function getClipTimeForRaceSec(clip, runStartTime, targetRaceSec) {
    if (!runStartTime || !clip.videoStartTime) return 0;
    const targetAbsMs = runStartTime + (targetRaceSec * 1000);
    return (targetAbsMs - clip.videoStartTime) / 1000;
}

function buildMultiCamPlayerHtml(safeRunId, r, videos) {
    if (!videos || videos.length === 0) {
        return `<div style="width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-secondary); font-weight: 700; font-size: 13px; border: 1px solid rgba(255,255,255,0.12); margin-top: 10px;">${iconHtml('movie', 'icon-md')} <span>ODOTETAAN VIDEOTA...</span></div>`;
    }

    const first = videos[0];
    const second = videos[1] || first;
    const videoDataJson = JSON.stringify(videos).replace(/"/g, '&quot;');
    const runnerNameUpper = (r.name || 'LASKIJA').toUpperCase();
    const totalSec = ((r.totalTime || 25000) / 1000).toFixed(2);

    const camButtonsHtml = videos.length > 1 ? `
        <div class="multicam-bar" id="cam-bar-${safeRunId}" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; justify-content: space-between;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px; flex: 1;">
                ${videos.map((v, idx) => {
                    const rangeStr = `${v.relStartSec.toFixed(0)}–${v.relEndSec.toFixed(0)}s`;
                    const isFirst = idx === 0;
                    return `<button type="button" id="cam-btn-${safeRunId}-${idx}" class="cam-angle-btn"
                        onclick="switchClip('${safeRunId}', ${idx}, true)"
                        style="background: ${isFirst ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; color: #fff; border: 2px solid ${isFirst ? '#fff' : 'rgba(255,255,255,0.25)'}; min-height: 44px; padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                        <span class="overlap-dot" id="cam-dot-${safeRunId}-${idx}" style="width: 8px; height: 8px; border-radius: 50%; background: ${isFirst ? '#fff' : 'rgba(255,255,255,0.35)'}; display: inline-block;"></span>
                        ${iconHtml('videocam', 'icon-sm')}
                        <span>${v.cameraLabel}</span>
                        <span style="opacity: 0.8; font-size: 10px;">(${rangeStr})</span>
                    </button>`;
                }).join('')}
            </div>
            <button type="button" id="dual-btn-${safeRunId}" onclick="toggleDualCameraMode('${safeRunId}')"
                style="background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 2px solid #34d399; min-height: 44px; padding: 8px 12px; border-radius: 10px; font-size: 12px; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">
                ${iconHtml('splitscreen', 'icon-sm')}
                <span>2 KAMERAA RINNAKKAIN</span>
            </button>
        </div>
    ` : '';

    const dualViewHtml = videos.length > 1 ? `
        <div id="dual-container-${safeRunId}" style="display: none; margin-top: 10px; background: #050505; border-radius: 12px; padding: 12px; border: 2px solid rgba(16, 185, 129, 0.35);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px;">
                <div style="position: relative; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15);">
                    <video id="dual-vid-a-${safeRunId}" src="${first.url}" playsinline muted style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="dual-badge-a-${safeRunId}" style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; color: #60a5fa; display: inline-flex; align-items: center; gap: 4px;">${iconHtml('videocam', 'icon-sm')} <span>${first.cameraLabel}</span></div>
                    <div id="dual-wait-a-${safeRunId}" style="position: absolute; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: var(--text-secondary); text-align: center; padding: 10px;"></div>
                </div>
                <div style="position: relative; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15);">
                    <video id="dual-vid-b-${safeRunId}" src="${second.url}" playsinline muted style="width: 100%; height: 100%; object-fit: contain;"></video>
                    <div id="dual-badge-b-${safeRunId}" style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; color: #34d399; display: inline-flex; align-items: center; gap: 4px;">${iconHtml('videocam', 'icon-sm')} <span>${second.cameraLabel}</span></div>
                    <div id="dual-wait-b-${safeRunId}" style="position: absolute; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: var(--text-secondary); text-align: center; padding: 10px;"></div>
                </div>
            </div>
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <button type="button" id="dual-play-btn-${safeRunId}" onclick="toggleDualPlay('${safeRunId}')"
                        style="background: var(--accent); color: #fff; border: 2px solid rgba(255,255,255,0.25); min-height: 44px; padding: 8px 14px; border-radius: 10px; font-weight: 900; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                        ${iconHtml('play_arrow', 'icon-sm')}
                        <span>TOISTA SYNKRONOITUNA</span>
                    </button>
                    <div style="display: flex; gap: 6px;" role="group" aria-label="Toistonopeus">
                        <button type="button" onclick="setDualSpeed('${safeRunId}', 1.0)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.25); min-height: 44px; min-width: 44px; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 800; cursor: pointer;">1x</button>
                        <button type="button" onclick="setDualSpeed('${safeRunId}', 0.5)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.25); min-height: 44px; min-width: 44px; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 800; cursor: pointer;">0.5x</button>
                        <button type="button" onclick="setDualSpeed('${safeRunId}', 0.25)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.25); min-height: 44px; min-width: 44px; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 800; cursor: pointer;">0.25x</button>
                    </div>
                    <div id="dual-clock-${safeRunId}" style="margin-left: auto; font-family: monospace; font-size: 18px; font-weight: 900; color: #fff;">0,00 s</div>
                </div>
                <label for="dual-scrub-${safeRunId}" class="visually-hidden">Selaa laskuaikaa</label>
                <input type="range" id="dual-scrub-${safeRunId}" min="0" max="${totalSec}" step="0.02" value="0"
                    oninput="scrubDualCameras('${safeRunId}', this.value)"
                    style="width: 100%; accent-color: var(--accent); cursor: pointer; margin-bottom: 0; padding: 8px 0;">
            </div>
        </div>
    ` : '';

    return `
        <div class="multicam-wrapper" id="wrap-${safeRunId}">
            <div class="video-container playlist-player" id="player-${safeRunId}" data-videos="${videoDataJson}" data-current-index="0" data-start-time="${r.startTime || 0}" data-total-time="${r.totalTime || 0}"
                 style="width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.15); margin-top: 10px;">
                <video id="vid-el-${safeRunId}" src="${first.url}" data-trigger-time="${first.triggerTime || r.startTime}" data-video-start-time="${first.videoStartTime || 0}"
                       data-start-time="${r.startTime || 0}" data-total-time="${r.totalTime || 0}" controls playsinline style="width: 100%; height: 100%; object-fit: contain;"
                       onended="playNextClip('${safeRunId}')" onplay="attachVideoClockLogic(this)" onloadedmetadata="attachVideoClockLogic(this)"></video>
                <div class="role-badge" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 800; color: #60a5fa; z-index: 10;">${iconHtml('videocam', 'icon-sm')} <span>${first.cameraLabel}</span></div>
                <div class="clock-overlay" style="position: absolute; bottom: 15px; right: 15px; pointer-events: none; background: rgba(0,0,0,0.85); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.25); backdrop-filter: blur(10px); transition: opacity 0.3s; opacity: 0; text-align: right; z-index: 10;">
                    <div style="font-size: 8px; font-weight: 900; color: #60a5fa; letter-spacing: 0.5px; line-height: 1; text-transform: uppercase; margin-bottom: 2px;">${runnerNameUpper}</div>
                    <div class="clock-val" style="font-size: 16px; font-weight: 900; font-family: monospace; line-height: 1; color: #fff;">0,00</div>
                </div>
            </div>
            ${camButtonsHtml}
            ${dualViewHtml}
        </div>
    `;
}

function attachVideoClockLogic(vEl) {
    if (!vEl) return;
    const container = vEl.closest('.video-container');
    if (!container) return;

    const vClock = container.querySelector('.clock-overlay');
    const clockVal = vClock ? vClock.querySelector('.clock-val') : null;
    const runId = container.id ? container.id.replace(/^player-/, '') : '';

    if (vClock && clockVal) {
        vEl.ontimeupdate = () => {
            vClock.style.opacity = '1';
            const displayTimeSec = getVideoRaceTimeSec(vEl);
            clockVal.innerText = formatSeconds(displayTimeSec);

            if (runId) {
                updateOverlappingCameraBadges(runId, displayTimeSec);
            }
        };
        vEl.onpause = () => vClock.style.opacity = '0.75';
        vEl.onplay = () => vClock.style.opacity = '1';
    }
}

function updateOverlappingCameraBadges(runId, currentRaceSec) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;
    const activeIdx = parseInt(player.getAttribute('data-current-index') || '0', 10);
    let videos = [];
    try {
        videos = JSON.parse(player.getAttribute('data-videos') || '[]');
    } catch (e) {
        return;
    }

    videos.forEach((v, idx) => {
        const dot = document.getElementById(`cam-dot-${runId}-${idx}`);
        const btn = document.getElementById(`cam-btn-${runId}-${idx}`);
        if (!dot || !btn) return;

        const coversMoment = (currentRaceSec >= v.relStartSec - 0.2) && (currentRaceSec <= v.relEndSec + 0.2);
        if (idx === activeIdx) {
            btn.style.background = 'var(--accent)';
            btn.style.borderColor = '#fff';
            dot.style.background = '#fff';
        } else if (coversMoment) {
            btn.style.background = 'rgba(16, 185, 129, 0.2)';
            btn.style.borderColor = '#34d399';
            dot.style.background = '#34d399';
        } else {
            btn.style.background = 'rgba(255,255,255,0.08)';
            btn.style.borderColor = 'rgba(255,255,255,0.25)';
            dot.style.background = 'rgba(255,255,255,0.35)';
        }
    });
}

function switchClip(runId, index, preserveRaceTime = true) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;

    const videos = JSON.parse(player.getAttribute('data-videos') || '[]');
    const vidEl = document.getElementById(`vid-el-${runId}`);
    const badge = player.querySelector('.role-badge');
    const startTime = parseInt(player.getAttribute('data-start-time') || '0', 10);

    const clip = videos[index];
    if (!vidEl || !clip) return;

    const currentRaceSec = preserveRaceTime ? getVideoRaceTimeSec(vidEl) : 0;
    const wasPaused = vidEl.paused;
    const currentRate = vidEl.playbackRate || 1.0;

    vidEl.src = clip.url;
    vidEl.setAttribute('data-trigger-time', clip.triggerTime || startTime);
    vidEl.setAttribute('data-video-start-time', clip.videoStartTime || 0);
    if (badge) badge.innerHTML = `${iconHtml('videocam', 'icon-sm')} <span>${(clip.cameraLabel || clip.role || 'VIDEO').toUpperCase()}</span>`;
    player.setAttribute('data-current-index', index);

    updateOverlappingCameraBadges(runId, currentRaceSec);

    const onLoaded = () => {
        vidEl.removeEventListener('loadedmetadata', onLoaded);
        vidEl.playbackRate = currentRate;

        if (preserveRaceTime && startTime > 0 && clip.videoStartTime > 0) {
            const targetClipSec = getClipTimeForRaceSec(clip, startTime, currentRaceSec);
            if (targetClipSec > 0.1 && targetClipSec < (vidEl.duration - 0.2)) {
                vidEl.currentTime = targetClipSec;
            }
        }

        if (!wasPaused) {
            vidEl.play().catch(() => {});
        }
    };

    vidEl.addEventListener('loadedmetadata', onLoaded);
}

function playNextClip(runId) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;

    const currentIndex = parseInt(player.getAttribute('data-current-index') || '0', 10);
    const videos = JSON.parse(player.getAttribute('data-videos') || '[]');

    if (currentIndex < videos.length - 1) {
        switchClip(runId, currentIndex + 1, true);
    }
}

// ============================================================================
// DUAL SPLIT-SCREEN SYNCHRONIZED CAMERA ENGINE
// ============================================================================

const dualPlayStates = {};

function toggleDualCameraMode(runId) {
    const singlePlayer = document.getElementById(`player-${runId}`);
    const dualCont = document.getElementById(`dual-container-${runId}`);
    const dualBtn = document.getElementById(`dual-btn-${runId}`);
    const singleVid = document.getElementById(`vid-el-${runId}`);
    if (!singlePlayer || !dualCont) return;

    const isOpeningDual = dualCont.style.display === 'none';
    if (isOpeningDual) {
        const currentRaceSec = singleVid ? getVideoRaceTimeSec(singleVid) : 0;
        if (singleVid) singleVid.pause();
        singlePlayer.style.display = 'none';
        dualCont.style.display = 'block';
        if (dualBtn) {
            dualBtn.innerHTML = `${iconHtml('close', 'icon-sm')} <span>SULJE RINNAKKAISNÄKYMÄ</span>`;
            dualBtn.style.background = 'var(--accent)';
            dualBtn.style.color = '#fff';
            dualBtn.style.borderColor = '#fff';
        }
        scrubDualCameras(runId, currentRaceSec);
    } else {
        stopDualPlay(runId);
        dualCont.style.display = 'none';
        singlePlayer.style.display = 'flex';
        if (dualBtn) {
            dualBtn.innerHTML = `${iconHtml('splitscreen', 'icon-sm')} <span>2 KAMERAA RINNAKKAIN</span>`;
            dualBtn.style.background = 'rgba(16, 185, 129, 0.15)';
            dualBtn.style.color = '#6ee7b7';
            dualBtn.style.borderColor = '#34d399';
        }
    }
}

function syncDualVideoElement(vidEl, waitEl, clip, runStartTime, raceSec, shouldPlay, rate) {
    if (!vidEl || !clip) return;
    const targetSec = getClipTimeForRaceSec(clip, runStartTime, raceSec);
    const dur = vidEl.duration || ((clip.videoEndTime - clip.videoStartTime) / 1000) || 20;

    if (targetSec < 0) {
        if (!vidEl.paused) vidEl.pause();
        if (waitEl) {
            waitEl.style.display = 'flex';
            waitEl.innerText = `ODOTTAA LASKIJAA\n(Kuva alkaa +${Math.abs(targetSec).toFixed(1)}s)`;
        }
    } else if (targetSec > dur) {
        if (!vidEl.paused) vidEl.pause();
        if (waitEl) {
            waitEl.style.display = 'flex';
            waitEl.innerText = `KAMERAN OSUUS PÄÄTTYNYT`;
        }
    } else {
        if (waitEl) waitEl.style.display = 'none';
        vidEl.playbackRate = rate;
        if (Math.abs((vidEl.currentTime || 0) - targetSec) > 0.12 || !shouldPlay) {
            try { vidEl.currentTime = Math.max(0, targetSec); } catch (e) {}
        }
        if (shouldPlay && vidEl.paused) {
            vidEl.play().catch(() => {});
        } else if (!shouldPlay && !vidEl.paused) {
            vidEl.pause();
        }
    }
}

function scrubDualCameras(runId, raceSecVal) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;

    const videos = JSON.parse(player.getAttribute('data-videos') || '[]');
    const startTime = parseInt(player.getAttribute('data-start-time') || '0', 10);
    const raceSec = parseFloat(raceSecVal) || 0;

    if (!dualPlayStates[runId]) {
        dualPlayStates[runId] = { playing: false, raceSec: 0, rate: 1.0, timer: null };
    }
    dualPlayStates[runId].raceSec = raceSec;

    const vidA = document.getElementById(`dual-vid-a-${runId}`);
    const vidB = document.getElementById(`dual-vid-b-${runId}`);
    const waitA = document.getElementById(`dual-wait-a-${runId}`);
    const waitB = document.getElementById(`dual-wait-b-${runId}`);
    const clockEl = document.getElementById(`dual-clock-${runId}`);
    const scrubEl = document.getElementById(`dual-scrub-${runId}`);

    if (clockEl) clockEl.innerText = `${formatSeconds(raceSec)} s`;
    if (scrubEl && document.activeElement !== scrubEl) scrubEl.value = raceSec.toFixed(2);

    const isPlaying = dualPlayStates[runId].playing;
    const rate = dualPlayStates[runId].rate || 1.0;

    syncDualVideoElement(vidA, waitA, videos[0], startTime, raceSec, isPlaying, rate);
    syncDualVideoElement(vidB, waitB, videos[1] || videos[0], startTime, raceSec, isPlaying, rate);
}

function toggleDualPlay(runId) {
    if (!dualPlayStates[runId]) {
        dualPlayStates[runId] = { playing: false, raceSec: 0, rate: 1.0, timer: null };
    }
    if (dualPlayStates[runId].playing) {
        stopDualPlay(runId);
    } else {
        startDualPlay(runId);
    }
}

function startDualPlay(runId) {
    const player = document.getElementById(`player-${runId}`);
    if (!player) return;
    const totalTimeMs = parseInt(player.getAttribute('data-total-time') || '25000', 10) || 25000;
    const maxSec = totalTimeMs / 1000;

    const state = dualPlayStates[runId] || { playing: false, raceSec: 0, rate: 1.0, timer: null };
    if (state.raceSec >= maxSec - 0.1) state.raceSec = 0;
    state.playing = true;
    dualPlayStates[runId] = state;

    const btn = document.getElementById(`dual-play-btn-${runId}`);
    if (btn) btn.innerHTML = `${iconHtml('pause', 'icon-sm')} <span>TAUKO</span>`;

    let lastTick = performance.now();
    if (state.timer) clearInterval(state.timer);

    state.timer = setInterval(() => {
        if (!state.playing) return;
        const now = performance.now();
        const dtSec = ((now - lastTick) / 1000) * (state.rate || 1.0);
        lastTick = now;

        state.raceSec += dtSec;
        if (state.raceSec >= maxSec) {
            state.raceSec = maxSec;
            scrubDualCameras(runId, state.raceSec);
            stopDualPlay(runId);
            return;
        }
        scrubDualCameras(runId, state.raceSec);
    }, 50);
}

function stopDualPlay(runId) {
    const state = dualPlayStates[runId];
    if (state) {
        state.playing = false;
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }
    }
    const vidA = document.getElementById(`dual-vid-a-${runId}`);
    const vidB = document.getElementById(`dual-vid-b-${runId}`);
    if (vidA) vidA.pause();
    if (vidB) vidB.pause();

    const btn = document.getElementById(`dual-play-btn-${runId}`);
    if (btn) btn.innerHTML = `${iconHtml('play_arrow', 'icon-sm')} <span>TOISTA SYNKRONOITUNA</span>`;
}

function setDualSpeed(runId, rate) {
    if (!dualPlayStates[runId]) {
        dualPlayStates[runId] = { playing: false, raceSec: 0, rate: rate, timer: null };
    } else {
        dualPlayStates[runId].rate = rate;
    }
    scrubDualCameras(runId, dualPlayStates[runId].raceSec);
}

window.switchClip = switchClip;
window.playNextClip = playNextClip;
window.toggleDualCameraMode = toggleDualCameraMode;
window.toggleDualPlay = toggleDualPlay;
window.scrubDualCameras = scrubDualCameras;
window.setDualSpeed = setDualSpeed;
window.normalizeRunVideos = normalizeRunVideos;
window.getVideoRaceTimeSec = getVideoRaceTimeSec;
window.buildMultiCamPlayerHtml = buildMultiCamPlayerHtml;

// ============================================================================
// VIEW RENDERERS (Coach, Starter, Athlete, Video)
// ============================================================================

let lastValmentajaRenderHash = '';
function renderValmentajaView() {
    const activeEl = document.getElementById('active-skier');
    const resultEl = document.getElementById('result-list');
    const coachListEl = document.getElementById('coach-athlete-list');
    const coachCtrlEl = document.getElementById('coach-controls');
    const sessionNameEl = document.getElementById('coach-session-name');
    const devStatusEl = document.getElementById('device-status-list');
    if (!activeEl || !resultEl) return;

    if (sessionNameEl && currentSession.name) {
        sessionNameEl.innerText = currentSession.name.toUpperCase();
    }

    const results = currentSession.results || [];
    const athletes = currentSession.allAthletes || [];
    const onCourse = currentSession.onCourse || [];
    const queue = currentSession.activeQueue || [];
    const devicesObj = currentSession.devices || {};

    const currentHash = JSON.stringify({
        role: currentRole,
        rCount: results.length,
        ocCount: onCourse.length,
        qCount: queue.length,
        aCount: athletes.length,
        dKeys: Object.keys(devicesObj).map(k => `${k}:${devicesObj[k].role}:${devicesObj[k].actsAsStartClock}`),
        vSum: results.reduce((acc, r) => acc + (r.videos ? r.videos.length : (r.videoUrl ? 1 : 0)), 0),
        sSum: results.reduce((acc, r) => acc + (r.status === 'DNF' ? 1 : 0) + (r.splits ? r.splits.length : 0), 0)
    });

    if (currentHash === lastValmentajaRenderHash) return;
    lastValmentajaRenderHash = currentHash;

    const isCoach = currentRole === 'VALMENTAJA';
    if (coachCtrlEl) coachCtrlEl.style.display = isCoach ? 'block' : 'none';

    // 1. Athlete List (Highlight those in queue)
    if (coachListEl) {
        coachListEl.innerHTML = athletes.length ? athletes.map(a => {
            const isInQueue = queue.some(q => String(q.id) === String(a.id));
            const style = isInQueue ? 'background: var(--accent); border-color: #ffffff; color: #fff;' : '';
            return `
                <button type="button" class="btn btn-outline" aria-pressed="${isInQueue}" style="padding: 16px; margin-bottom: 8px; font-size: 19px; width: 100%; ${style}" onclick="addToQueue('${a.id}')">
                    <span>${a.name.toUpperCase()}</span>
                    ${isInQueue ? iconHtml('schedule', 'icon-md') : ''}
                </button>
            `;
        }).join('') : '<p style="color: var(--text-secondary); padding: 12px;">Ei urheilijoita listalla.</p>';
    }

    // 2. Active Runners
    const now = getSyncedTime();
    if (onCourse.length > 0) {
        activeEl.innerHTML = onCourse.map(r => {
            const runningTime = Math.max(0, now - r.startTime);
            return `
                <div class="card" style="border-left: 8px solid var(--accent); padding: 24px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                        <div style="text-align: left;">
                            <h3 style="margin: 0; font-size: 30px;">${r.name.toUpperCase()}</h3>
                            <p style="color: #60a5fa; font-weight: 900; margin: 6px 0 0 0; font-size: 15px; display: flex; align-items: center; gap: 6px;">
                                ${iconHtml('downhill_skiing', 'icon-sm')}
                                <span>RADALLA...</span>
                            </p>
                        </div>
                        <div style="text-align: right;">
                            <div id="timer-${r.id}" style="margin: 0; font-family: monospace; font-size: 46px; font-weight: 900;">${formatDuration(runningTime)}</div>
                        </div>
                    </div>
                    ${isCoach ? `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:18px;">
                        <button type="button" class="btn btn-danger" style="margin: 0;" onclick="markRunnerDNF('${r.id}')">
                            ${iconHtml('cancel', 'icon-sm')}
                            <span>KESKEYTYS (DNF)</span>
                        </button>
                        <button type="button" class="btn btn-outline" style="margin: 0; border-color: var(--warning); color: #fcd34d;" onclick="manualFinish('${r.id}')">
                            ${iconHtml('timer_off', 'icon-sm')}
                            <span>KÄSIAIKA</span>
                        </button>
                    </div>` : ''}
                </div>
            `;
        }).join('');
    } else {
        activeEl.innerHTML = `<div class="card" style="text-align: center; padding: 28px; color: var(--text-secondary); font-weight: 700;">RATA VAPAA</div>`;
    }

    // 3. Results List
    if (results.length > 0) {
        const validResults = [...results]
            .filter(r => r.totalTime > 0 && r.status !== 'DNF')
            .sort((a, b) => a.totalTime - b.totalTime);
        const bestTime = validResults.length > 0 ? validResults[0].totalTime : 0;

        const bestSplits = {};
        validResults.forEach(vr => {
            (vr.splits || []).forEach((s, idx) => {
                if (!bestSplits[idx] || s.duration < bestSplits[idx]) bestSplits[idx] = s.duration;
            });
        });

        const counts = {};
        const runNumbers = {};
        [...results].reverse().forEach(r => {
            counts[r.name] = (counts[r.name] || 0) + 1;
            runNumbers[r.runId] = counts[r.name];
        });

        const personalBests = {};
        validResults.forEach(r => {
            if (!personalBests[r.name] || r.totalTime < personalBests[r.name]) {
                personalBests[r.name] = r.totalTime;
            }
        });

        resultEl.innerHTML = results.map((r, i) => {
            const safeRunId = r.runId || `run-${i}`;
            const isDNF = r.status === 'DNF';
            const rank = isDNF ? null : (validResults.findIndex(vr => vr.runId === r.runId) + 1 || null);
            
            let label = "Laskuaika:";
            let gapHtml = "";
            let timeVal = isDNF ? 'DNF' : formatDuration(r.totalTime);

            if (!isDNF) {
                if (rank === 1) {
                    label = "Paras aika:";
                    if (validResults.length > 1) {
                        const lead = validResults[1].totalTime - validResults[0].totalTime;
                        gapHtml = `<span style="color: var(--success); font-size: 16px; font-weight: 700; margin-left: 8px;">–${formatDuration(lead)}</span>`;
                    }
                } else if (rank === 2) {
                    label = "2. paras aika:";
                    const gap = r.totalTime - bestTime;
                    gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
                } else if (rank === 3) {
                    label = "3. paras aika:";
                    const gap = r.totalTime - bestTime;
                    gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
                } else if (r.totalTime === personalBests[r.name]) {
                    label = "Paras oma aika:";
                    const gap = r.totalTime - bestTime;
                    gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
                } else {
                    const gap = r.totalTime - bestTime;
                    gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
                }
            }

            const splitList = (r.splits || []).map((s, idx) => {
                const splitBest = bestSplits[idx];
                const sGapVal = s.duration - splitBest;
                const splitGap = (s.duration > splitBest) ? ` +${formatDuration(sGapVal)}` : '';
                return `
                    <div style="font-size: 13px; color: var(--text-primary); margin-top: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                        ${iconHtml('timer', 'icon-sm')}
                        <span style="color: #60a5fa;">VÄLIAIKA ${idx + 1}:</span> 
                        <span>${formatDuration(s.duration)}</span> 
                        <span class="result-gap">${splitGap}</span>
                    </div>`;
            }).join('');

            const videos = normalizeRunVideos(r);
            const videoHtml = buildMultiCamPlayerHtml(safeRunId, r, videos);

            return `
                <div class="card" style="margin-bottom:18px; border-left: 4px solid var(--accent); padding-bottom: 20px; position: relative;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 12px;">
                        <div style="text-align: left;">
                            <div style="font-weight: 900; font-size: 23px; letter-spacing: -0.5px;">
                                ${r.name.toUpperCase()}, #${runNumbers[r.runId] || '?'}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); letter-spacing: 0.5px; text-transform: uppercase;">${label}</div>
                            <div style="font-weight: 900; font-size: 24px; color: #fff;">
                                ${timeVal}${gapHtml}
                            </div>
                        </div>
                    </div>

                    ${videoHtml}

                    <div style="margin-top: 14px; text-align: left; padding-left: 4px;">
                        ${splitList}
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <button type="button" class="btn-share-run" style="background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.28);" onclick="loadRunCard('${safeRunId}')">
                            ${iconHtml('analytics', 'icon-sm')}
                            <span>ANALYSOI</span>
                        </button>
                        <button type="button" class="btn-share-run" onclick="shareRun('${safeRunId}')">
                            ${iconHtml('share', 'icon-sm')}
                            <span>JAA TULOS</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        resultEl.innerHTML = `<p style="text-align:center; color: var(--text-secondary); padding:20px;">Ei tuloksia vielä.</p>`;
    }

    // 4. Connected Devices List
    if (devStatusEl) {
        const devList = Object.values(devicesObj);
        const roleIconMap = {
            'VALMENTAJA': 'analytics',
            'LÄHETTÄJÄ': 'record_voice_over',
            'LÄHTÖ': 'sensors',
            'MAALI': 'sports_score',
            'VÄLIAIKA': 'timer',
            'VIDEO': 'videocam',
            'URHEILIJA': 'downhill_skiing',
            'KATSOMO': 'visibility'
        };
        devStatusEl.innerHTML = devList.map(d => {
            const rLabel = (d.role === 'LÄHETTÄJÄ' && d.actsAsStartClock)
                ? 'LÄHETTÄJÄ + STARTTIKELLO'
                : (d.role || 'LAITE');
            const ic = roleIconMap[d.role] || 'smartphone';
            return `
                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 12px; text-align: left; display: flex; align-items: center; gap: 10px;">
                    <span class="material-symbols-rounded" aria-hidden="true" style="color: #60a5fa;">${ic}</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 800; color: #fff;">${(d.name || 'Laite').toUpperCase()}</div>
                        <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary);">${rLabel}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function renderStarterView() {
    const queueEl = document.getElementById('starter-queue-view');
    const listEl = document.getElementById('starter-skier-list');
    if (!queueEl || !listEl) return;

    if (typeof updateStarterTrafficLight === 'function') {
        updateStarterTrafficLight(currentSession);
    }
    if (typeof updateStarterClockBannerUI === 'function') {
        updateStarterClockBannerUI();
    }

    const queue = currentSession.activeQueue || [];
    const athletes = currentSession.allAthletes || [];

    if (queue.length > 0) {
        const next = queue[0];
        queueEl.innerHTML = `
            <button type="button" class="starter-next-btn" onclick="clearQueue()">
                <span style="font-size: 13px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9;">SEURAAVA LÄHTIJÄ:</span>
                <span style="font-size: 56px; font-weight: 900; line-height: 1.05; word-break: break-word;">${next.name.toUpperCase()}</span>
                <span style="font-size: 12px; font-weight: 800; margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 6px 14px; border-radius: 20px;">
                    ${iconHtml('cancel', 'icon-sm')}
                    <span>Paina tai sano "Peruuta" poistaaksesi jonosta</span>
                </span>
            </button>
        `;
    } else {
        queueEl.innerHTML = `<div class="card" style="padding: 28px; text-align:center; color: var(--text-secondary); font-weight: 700; margin-bottom: 0;">LÄHTÖJONO TYHJÄ</div>`;
    }

    listEl.innerHTML = athletes.map(a => {
        const isInQueue = queue.some(q => String(q.id) === String(a.id));
        const style = isInQueue ? 'background: var(--accent); border-color: #ffffff; color: #fff;' : '';
        return `
            <button type="button" class="btn btn-outline" aria-pressed="${isInQueue}" style="padding:16px 12px; width:100%; margin-bottom:0; font-size: 17px; ${style}" onclick="addToQueue('${a.id}')">
                <span>${a.name.toUpperCase()}</span>
                ${isInQueue ? iconHtml('check_circle', 'icon-sm') : ''}
            </button>
        `;
    }).join('');
}

function renderAthleteView() {
    const listEl = document.getElementById('athlete-results-list');
    if (!listEl) return;

    const results = currentSession.results || [];
    const myResults = results.filter(r => r.name === userName);

    const validResults = [...results]
        .filter(r => r.totalTime > 0 && r.status !== 'DNF')
        .sort((a, b) => a.totalTime - b.totalTime);
    const bestTime = validResults.length > 0 ? validResults[0].totalTime : 0;
    const bestSplits = {};
    validResults.forEach(vr => {
        (vr.splits || []).forEach((s, idx) => {
            if (!bestSplits[idx] || s.duration < bestSplits[idx]) bestSplits[idx] = s.duration;
        });
    });

    const counts = {};
    const runNumbers = {};
    [...results].reverse().forEach(r => {
        counts[r.name] = (counts[r.name] || 0) + 1;
        runNumbers[r.runId] = counts[r.name];
    });

    const personalBests = {};
    validResults.forEach(r => {
        if (!personalBests[r.name] || r.totalTime < personalBests[r.name]) {
            personalBests[r.name] = r.totalTime;
        }
    });

    listEl.innerHTML = myResults.length ? myResults.map((r, i) => {
        const safeRunId = r.runId || `athlete-run-${i}`;
        const isDNF = r.status === 'DNF';
        const rank = isDNF ? null : (validResults.findIndex(vr => vr.runId === r.runId) + 1 || null);
        
        let label = "Laskuaika:";
        let gapHtml = "";
        let timeVal = isDNF ? 'DNF' : formatDuration(r.totalTime);

        if (!isDNF) {
            if (rank === 1) {
                label = "Paras aika:";
                if (validResults.length > 1) {
                    const lead = validResults[1].totalTime - validResults[0].totalTime;
                    gapHtml = `<span style="color: var(--success); font-size: 16px; font-weight: 700; margin-left: 8px;">–${formatDuration(lead)}</span>`;
                }
            } else if (rank === 2) {
                label = "2. paras aika:";
                const gap = r.totalTime - bestTime;
                gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else if (rank === 3) {
                label = "3. paras aika:";
                const gap = r.totalTime - bestTime;
                gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else if (r.totalTime === personalBests[r.name]) {
                label = "Paras oma aika:";
                const gap = r.totalTime - bestTime;
                gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            } else {
                const gap = r.totalTime - bestTime;
                gapHtml = `<span style="color: var(--danger); font-size: 16px; font-weight: 700; margin-left: 8px;">+${formatDuration(gap)}</span>`;
            }
        }

        const splitList = (r.splits || []).map((s, idx) => {
            const splitBest = bestSplits[idx];
            const sGapVal = s.duration - splitBest;
            const splitGap = (s.duration > splitBest) ? ` +${formatDuration(sGapVal)}` : '';
            return `
                <div style="font-size: 13px; color: var(--text-primary); margin-top: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                    ${iconHtml('timer', 'icon-sm')}
                    <span style="color: #60a5fa;">VÄLIAIKA ${idx + 1}:</span> 
                    <span>${formatDuration(s.duration)}</span> 
                    <span class="result-gap">${splitGap}</span>
                </div>`;
        }).join('');

        const videos = normalizeRunVideos(r);
        const videoHtml = buildMultiCamPlayerHtml(safeRunId, r, videos);

        return `
            <div class="card" style="margin-bottom:18px; padding-bottom: 20px; position: relative; border-left: 4px solid var(--accent);">
                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 12px;">
                    <div style="text-align: left;">
                        <div style="font-weight: 900; font-size: 23px; letter-spacing: -0.5px;">
                            ${r.name.toUpperCase()}, #${runNumbers[r.runId] || '?'}
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); letter-spacing: 0.5px; text-transform: uppercase;">${label}</div>
                        <div style="font-weight: 900; font-size: 24px; color: #fff;">
                            ${timeVal}${gapHtml}
                        </div>
                    </div>
                </div>
                ${videoHtml}
                <div style="margin-top: 14px; text-align: left; padding-left: 4px;">
                    ${splitList}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <button type="button" class="btn-share-run" style="background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.28);" onclick="loadRunCard('${r.runId || safeRunId}')">
                        ${iconHtml('analytics', 'icon-sm')}
                        <span>ANALYSOI</span>
                    </button>
                    <button type="button" class="btn-share-run" onclick="shareRun('${r.runId || safeRunId}')">
                        ${iconHtml('share', 'icon-sm')}
                        <span>JAA TULOS</span>
                    </button>
                </div>
            </div>
        `;
    }).join('') : '<p style="text-align:center; color: var(--text-secondary); padding: 20px;">Ei omia laskuja vielä.</p>';
}

function renderVideoView() {
    const infoEl = document.getElementById('video-node-info');
    if (!infoEl || !currentSession || !currentSession.devices) return;

    let startLoc = currentSession.location || null;
    for (let id in currentSession.devices) {
        const d = currentSession.devices[id];
        if ((d.role === 'LÄHTÖ' || d.role === 'LÄHETTÄJÄ') && d.location) {
            startLoc = d.location;
            if (d.role === 'LÄHTÖ' || d.actsAsStartClock) break;
        }
    }

    let myLoc = userLocation;
    const myDevice = currentSession.devices[deviceId];
    if (!myLoc && myDevice && myDevice.location) myLoc = myDevice.location;

    if (startLoc && myLoc) {
        const dist = getDistanceBetween(startLoc.lat, startLoc.lon, myLoc.lat, myLoc.lon);
        const distText = `SIJAINTI: ${dist.toFixed(0)}m LÄHDÖSTÄ`;

        let statusText = "VALMIINA";
        let countdownText = "";

        if (activeRunnerOnCourse) {
            statusText = `RADALLA: ${activeRunnerOnCourse.name.toUpperCase()}`;
            const elapsed = (getSyncedTime() - activeRunnerOnCourse.startTime) / 1000;
            const remaining = (dist / 18) - elapsed;

            if (remaining > 0) countdownText = `ENNUSTE: ${remaining.toFixed(1)}s`;
            else if (remaining > -5) countdownText = "LASKIJA KOHDALLA";
            else countdownText = "OHITETTU";
        }

        if (hasRecordedForCurrentRunner) {
            statusText = "TALLENNETTU";
            countdownText = "Odotetaan seuraavaa...";
        }

        infoEl.innerHTML = `
            <div style="font-size: 22px; color: #60a5fa; font-weight: 900; display: flex; align-items: center; justify-content: center; gap: 6px;">
                ${hasRecordedForCurrentRunner ? iconHtml('check_circle', 'icon-md') : ''}
                <span>${statusText}</span>
            </div>
            <div style="font-size: 16px; color: #fff; font-weight: 700;">${countdownText}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top:5px;">${distText}</div>
        `;
    } else {
        const missing = !startLoc ? "LÄHTÖPISTETTÄ" : "SIJAINTITIETOA";
        infoEl.innerHTML = `<div style="color: var(--text-secondary); font-size:13px;">ODOTTAA ${missing}...</div>`;
    }
}

function editSessionName() {
    const currentName = currentSession.name || "";
    const newName = prompt("ANNA HARJOITUKSELLE NIMI (esim. Levi SL, Ryhmä-A):", currentName);
    if (newName !== null && newName !== currentName) {
        socket.emit('update_session_name', { sessionId: currentSession.id, name: newName });
    }
}
