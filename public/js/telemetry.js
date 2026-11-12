// --- Alppikello Micro-Sector Telemetry, Fastest/Slowest Detection & Live Delta HUD ---

let activeTelemetryModel = null;

/**
 * Builds a unified sector model combining official splits and camera trigger timestamps
 * across all runs in the session.
 */
function buildRunTelemetry(runData, normalizedVideos) {
    if (!runData) return null;

    const totalMs = Number(runData.totalTime) || 0;
    const startTime = Number(runData.startTime) || 0;
    let allRuns = Array.isArray(runData.sessionResults) ? [...runData.sessionResults] : [];

    // Enrich from live currentSession if available in memory
    if (typeof currentSession !== 'undefined' && currentSession && Array.isArray(currentSession.results)) {
        const liveMap = new Map(currentSession.results.map(r => [r.runId, r]));
        allRuns = allRuns.map(r => liveMap.get(r.runId) ? { ...r, ...liveMap.get(r.runId) } : r);
        currentSession.results.forEach(lr => {
            if (!allRuns.some(ar => ar.runId === lr.runId)) {
                allRuns.push(lr);
            }
        });
    }

    // Ensure current run is included with full data
    const selfId = runData.runId || runData.id;
    const existingIdx = allRuns.findIndex(r => (r.runId || r.id) === selfId);
    if (existingIdx >= 0) {
        allRuns[existingIdx] = { ...allRuns[existingIdx], ...runData, runId: selfId };
    } else {
        allRuns.push({ ...runData, runId: selfId });
    }

    const validRuns = allRuns.filter(r => Number(r.totalTime) > 0 && r.status !== 'DNF');
    validRuns.sort((a, b) => Number(a.totalTime) - Number(b.totalTime));

    //Assign run numbers per athlete
    const chronological = [...allRuns].sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
    const counts = {};
    const runNumberMap = {};
    chronological.forEach(r => {
        const rid = r.runId || r.id;
        counts[r.name] = (counts[r.name] || 0) + 1;
        runNumberMap[rid] = counts[r.name];
    });

    // Helper: extract ordered checkpoints (ms from run start) for any run
    const extractCheckpoints = (r) => {
        const rStart = Number(r.startTime) || 0;
        const rTotal = Number(r.totalTime) || 0;
        const pts = [];

        // 1. Official splits
        (r.splits || []).forEach((s, idx) => {
            const dur = Number(s.duration) || 0;
            if (dur > 300 && (rTotal === 0 || dur < rTotal - 300)) {
                pts.push({
                    key: `SPLIT_${idx + 1}`,
                    label: s.deviceName || `Väliaika ${idx + 1}`,
                    type: 'split',
                    ms: dur
                });
            }
        });

        // 2. Virtual checkpoints from intermediate cameras (triggerTime relative to startTime)
        const vids = Array.isArray(r.videos) ? r.videos : [];
        vids.forEach((v, idx) => {
            const trig = Number(v.triggerTime) || 0;
            const roleUpper = String(v.role || '').toUpperCase();
            if (roleUpper === 'MAALI' || roleUpper === 'LÄHTÖ' || roleUpper === 'LÄHETTÄJÄ') return;
            if (rStart > 0 && trig > rStart + 1200) {
                const relMs = trig - rStart;
                if (rTotal === 0 || relMs < rTotal - 1200) {
                    const camKey = String(v.cameraName || v.role || `Kamera ${idx + 1}`).toUpperCase();
                    // Only add virtual checkpoint if not duplicating an official split within 1.5s
                    const tooClose = pts.some(p => Math.abs(p.ms - relMs) < 1500);
                    if (!tooClose) {
                        pts.push({
                            key: `CAM_${camKey}`,
                            label: `${v.cameraName || `Kamera ${idx + 1}`}`,
                            type: 'camera',
                            ms: relMs
                        });
                    }
                }
            }
        });

        pts.sort((a, b) => a.ms - b.ms);

        // 3. Finish checkpoint
        if (rTotal > 0) {
            pts.push({
                key: 'FINISH',
                label: 'Maali',
                type: 'finish',
                ms: rTotal
            });
        }
        return pts;
    };

    const myCheckpoints = extractCheckpoints(runData);
    const otherCheckpointsByRun = new Map();
    validRuns.forEach(vr => {
        otherCheckpointsByRun.set(vr.runId || vr.id, extractCheckpoints(vr));
    });

    // Build sectors for current run
    const sectors = [];
    let prevMs = 0;
    let prevKey = 'START';
    let prevLabel = 'Lähtö';

    myCheckpoints.forEach((cp, idx) => {
        const segMs = cp.ms - prevMs;
        if (segMs <= 100) return;

        const startSec = prevMs / 1000;
        const endSec = cp.ms / 1000;

        // Gather matching sector durations from all valid runs in session
        const peerDurations = [];
        validRuns.forEach(vr => {
            const rid = vr.runId || vr.id;
            const cps = otherCheckpointsByRun.get(rid) || [];
            const endMatch = cps.find(c => c.key === cp.key) || (cp.type === 'split' ? cps[idx] : null);
            const startMatch = prevKey === 'START'
                ? { ms: 0 }
                : (cps.find(c => c.key === prevKey) || (idx > 0 ? cps[idx - 1] : null));

            if (endMatch && startMatch && endMatch.ms > startMatch.ms + 100) {
                peerDurations.push({
                    runId: rid,
                    name: vr.name,
                    runNumber: runNumberMap[rid] || 1,
                    durationMs: endMatch.ms - startMatch.ms,
                    cumMs: endMatch.ms
                });
            }
        });

        peerDurations.sort((a, b) => a.durationMs - b.durationMs);
        const bestPeer = peerDurations[0] || { durationMs: segMs, name: runData.name, runNumber: runData.runNumber || 1, cumMs: cp.ms };
        const myPeers = peerDurations.filter(p => p.name === runData.name);
        const personalBestMs = myPeers.length > 0 ? Math.min(...myPeers.map(p => p.durationMs)) : segMs;
        const rankIdx = peerDurations.findIndex(p => p.runId === selfId);
        const rank = rankIdx >= 0 ? rankIdx + 1 : 1;

        // Find best matching camera clip for this sector
        let bestCamIdx = 0;
        if (Array.isArray(normalizedVideos) && normalizedVideos.length > 0) {
            const midSec = (startSec + endSec) / 2;
            const foundIdx = normalizedVideos.findIndex(v => midSec >= v.relStartSec - 0.5 && midSec <= v.relEndSec + 0.5);
            if (foundIdx >= 0) bestCamIdx = foundIdx;
            else {
                // Closest camera by center time
                let minDist = Infinity;
                normalizedVideos.forEach((v, vIdx) => {
                    const vMid = (v.relStartSec + v.relEndSec) / 2;
                    const d = Math.abs(vMid - midSec);
                    if (d < minDist) {
                        minDist = d;
                        bestCamIdx = vIdx;
                    }
                });
            }
        }

        sectors.push({
            index: sectors.length + 1,
            fromLabel: prevLabel,
            toLabel: cp.label,
            shortLabel: `S${sectors.length + 1}: ${prevLabel} → ${cp.label}`,
            checkpointType: cp.type,
            startMs: prevMs,
            endMs: cp.ms,
            startSec,
            endSec,
            durationMs: segMs,
            bestMs: bestPeer.durationMs,
            bestRunner: `${bestPeer.name} #${bestPeer.runNumber}`,
            bestRunnerRunId: bestPeer.runId,
            personalBestMs,
            deltaBestMs: segMs - bestPeer.durationMs,
            deltaPersonalMs: segMs - personalBestMs,
            cumDeltaBestMs: cp.ms - (bestPeer.cumMs || cp.ms),
            rank,
            totalPeers: peerDurations.length || 1,
            camIndex: bestCamIdx
        });

        prevMs = cp.ms;
        prevKey = cp.key;
        prevLabel = cp.label;
    });

    // Identify strongest and weakest sectors
    let bestSector = null;
    let worstSector = null;
    if (sectors.length > 0) {
        const sortedByPerf = [...sectors].sort((a, b) => {
            const ratioA = a.deltaBestMs / Math.max(1000, a.bestMs);
            const ratioB = b.deltaBestMs / Math.max(1000, b.bestMs);
            return ratioA - ratioB;
        });
        bestSector = sortedByPerf[0];
        worstSector = sortedByPerf[sortedByPerf.length - 1];
    }

    activeTelemetryModel = {
        runId: selfId,
        runData,
        validRuns,
        runNumberMap,
        sectors,
        bestSector,
        worstSector,
        totalMs
    };

    return activeTelemetryModel;
}

/**
 * Interpolates cumulative time delta (ms) vs session fastest run at any race second.
 */
function getLiveDeltaAtSec(raceSec) {
    if (!activeTelemetryModel || !activeTelemetryModel.sectors.length) return null;
    const sectors = activeTelemetryModel.sectors;
    const raceMs = raceSec * 1000;

    let prevEndMs = 0;
    let prevCumDelta = 0;

    for (const s of sectors) {
        if (raceMs <= s.endMs) {
            const span = Math.max(1, s.endMs - prevEndMs);
            const t = Math.max(0, Math.min(1, (raceMs - prevEndMs) / span));
            const interpDelta = prevCumDelta + t * s.deltaBestMs;
            return {
                deltaMs: interpDelta,
                sector: s
            };
        }
        prevCumDelta += s.deltaBestMs;
        prevEndMs = s.endMs;
    }

    const last = sectors[sectors.length - 1];
    return {
        deltaMs: prevCumDelta,
        sector: last
    };
}

/**
 * Updates the live TV-style Delta HUD badge on the video player.
 */
function updateLiveTelemetryHUD(raceSec) {
    const deltaEl = document.getElementById('card-video-delta');
    const secBadgeEl = document.getElementById('card-video-sector-badge');
    const playheadEl = document.getElementById('card-heatmap-playhead');

    if (playheadEl && activeTelemetryModel && activeTelemetryModel.totalMs > 0) {
        const pct = Math.max(0, Math.min(100, (raceSec * 1000 / activeTelemetryModel.totalMs) * 100));
        playheadEl.style.left = `${pct.toFixed(1)}%`;
    }

    const info = getLiveDeltaAtSec(raceSec);
    if (!info || !activeTelemetryModel || activeTelemetryModel.validRuns.length <= 1) {
        if (deltaEl) deltaEl.style.display = 'none';
        if (secBadgeEl) secBadgeEl.style.display = 'none';
        return;
    }

    if (deltaEl) {
        deltaEl.style.display = 'inline-flex';
        const dSec = (info.deltaMs / 1000);
        const sign = dSec > 0.005 ? '+' : (dSec < -0.005 ? '–' : '±');
        const absStr = Math.abs(dSec).toFixed(2).replace('.', ',');
        const isAhead = dSec <= 0.02;
        const isClose = dSec > 0.02 && dSec <= 0.18;

        deltaEl.style.background = isAhead
            ? 'rgba(34, 197, 94, 0.92)'
            : (isClose ? 'rgba(245, 158, 11, 0.92)' : 'rgba(239, 68, 68, 0.92)');
        deltaEl.style.color = isAhead || isClose ? '#052e16' : '#ffffff';
        deltaEl.innerText = `${sign}${absStr} s`;
    }

    if (secBadgeEl && info.sector) {
        secBadgeEl.style.display = 'block';
        const s = info.sector;
        const sDelta = (s.deltaBestMs / 1000).toFixed(2).replace('.', ',');
        const sSign = s.deltaBestMs > 5 ? `+${sDelta}s` : 'PARAS';
        secBadgeEl.innerText = `S${s.index} (${s.toLabel}): #${s.rank}/${s.totalPeers} • ${sSign}`;
    }
}

/**
 * Jumps the Run Card video player directly to a specific sector's camera and timestamp.
 */
function jumpToSectorVideo(sectorIndex) {
    if (!activeTelemetryModel) return;
    const sector = activeTelemetryModel.sectors.find(s => s.index === sectorIndex);
    if (!sector) return;

    const vEl = document.getElementById('card-video');
    const targetSec = Math.max(0, sector.startSec);

    if (typeof window.cardPlayerLoad === 'function') {
        window.cardPlayerLoad(sector.camIndex, false, targetSec);
    } else if (vEl) {
        vEl.currentTime = targetSec;
        vEl.play().catch(() => {});
    }
}

/**
 * Renders the Delta Heatmap Bar, Smart Fastest/Slowest Insights, and Sector Table.
 */
function renderRunTelemetryUI(containerEl, model) {
    if (!containerEl || !model) return;

    const { sectors, bestSector, worstSector, totalMs, validRuns } = model;
    if (!sectors || sectors.length === 0) {
        containerEl.style.display = 'none';
        return;
    }

    containerEl.style.display = 'block';
    const hasPeers = validRuns.length > 1;

    // 1. Delta Heatmap Bar segments
    const segmentsHtml = sectors.map(s => {
        const widthPct = Math.max(8, ((s.durationMs / Math.max(1, totalMs)) * 100)).toFixed(1);
        const isFastest = s.deltaBestMs <= 20;
        const isMedium = s.deltaBestMs > 20 && s.deltaBestMs <= 180;
        const bg = !hasPeers
            ? 'linear-gradient(90deg, #2563eb, #3b82f6)'
            : (isFastest
                ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                : (isMedium ? 'linear-gradient(90deg, #d97706, #f59e0b)' : 'linear-gradient(90deg, #dc2626, #ef4444)'));
        const badgeIcon = isFastest ? 'bolt' : (isMedium ? 'trending_flat' : 'warning');
        const deltaStr = !hasPeers
            ? `${formatDuration(s.durationMs)}s`
            : (s.deltaBestMs <= 5 ? 'PARAS' : `+${formatDuration(s.deltaBestMs)}`);

        return `
            <button type="button" onclick="jumpToSectorVideo(${s.index})"
                aria-label="Hyppää videolla sektoriin ${s.index}: ${s.toLabel}, ${deltaStr}"
                style="width: ${widthPct}%; min-height: 44px; background: ${bg}; border: none; border-right: 2px solid #090d16; color: #fff; font-weight: 900; font-size: 11px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4px 2px; line-height: 1.15; overflow: hidden;">
                <span style="display: inline-flex; align-items: center; gap: 2px; font-size: 10px;">
                    ${iconHtml(badgeIcon, 'icon-sm')} S${s.index}
                </span>
                <span style="font-size: 10px; opacity: 0.95;">${deltaStr}</span>
            </button>
        `;
    }).join('');

    // 2. Smart Insights (Fastest / Slowest clickable coaching cards)
    let insightsHtml = '';
    if (hasPeers && bestSector && worstSector) {
        const bestText = bestSector.deltaBestMs <= 5
            ? `Harjoituksen nopein tällä osuudella (${formatDuration(bestSector.durationMs)} s)`
            : `+${formatDuration(bestSector.deltaBestMs)} s kärkeen (${bestSector.bestRunner})`;

        const showWorst = worstSector.deltaBestMs > 30 && (sectors.length === 1 || worstSector.index !== bestSector.index);

        insightsHtml = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 12px;">
                <div style="background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 12px; padding: 12px; text-align: left;">
                    <div style="font-size: 11px; font-weight: 900; color: #4ade80; display: flex; align-items: center; gap: 6px; text-transform: uppercase;">
                        ${iconHtml('bolt', 'icon-sm')}
                        <span>VAHVIN OSUUS • S${bestSector.index} (${bestSector.toLabel})</span>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; color: #fff; margin: 6px 0 10px 0;">${bestText}</div>
                    <button type="button" onclick="jumpToSectorVideo(${bestSector.index})"
                        style="background: rgba(34, 197, 94, 0.22); color: #86efac; border: 1px solid #4ade80; min-height: 38px; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                        ${iconHtml('play_circle', 'icon-sm')}
                        <span>NÄYTÄ VIDEOLLA (${bestSector.startSec.toFixed(1)}s)</span>
                    </button>
                </div>
                ${showWorst ? `
                <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 12px; padding: 12px; text-align: left;">
                    <div style="font-size: 11px; font-weight: 900; color: #f87171; display: flex; align-items: center; gap: 6px; text-transform: uppercase;">
                        ${iconHtml('troubleshoot', 'icon-sm')}
                        <span>SUURIN AIKATAPPIO • S${worstSector.index} (${worstSector.toLabel})</span>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; color: #fff; margin: 6px 0 10px 0;">
                        Hävisit +${formatDuration(worstSector.deltaBestMs)} s (Nopein: ${worstSector.bestRunner})
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <button type="button" onclick="jumpToSectorVideo(${worstSector.index})"
                            style="background: rgba(239, 68, 68, 0.22); color: #fca5a5; border: 1px solid #f87171; min-height: 38px; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            ${iconHtml('play_circle', 'icon-sm')}
                            <span>KATSO KOHTA (${worstSector.startSec.toFixed(1)}s)</span>
                        </button>
                        ${worstSector.bestRunnerRunId && worstSector.bestRunnerRunId !== model.runId ? `
                        <button type="button" onclick="openGhostComparisonWith('${worstSector.bestRunnerRunId}', ${worstSector.index})"
                            style="background: rgba(59, 130, 246, 0.22); color: #93c5fd; border: 1px solid #60a5fa; min-height: 38px; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 900; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            ${iconHtml('compare', 'icon-sm')}
                            <span>VERTAA HAAMUNA</span>
                        </button>` : ''}
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }

    // 3. Detailed Sector Breakdown rows
    const rowsHtml = sectors.map(s => {
        const isBest = s.deltaBestMs <= 5;
        const deltaBadge = !hasPeers
            ? `<span style="color: var(--text-secondary); font-size: 12px;">#${s.rank}</span>`
            : (isBest
                ? `<span style="color: #4ade80; font-weight: 900; font-size: 12px;">PARAS (#1/${s.totalPeers})</span>`
                : `<span style="color: #f87171; font-weight: 800; font-size: 12px;">+${formatDuration(s.deltaBestMs)} (#${s.rank}/${s.totalPeers})</span>`);

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 13px;">
                <div style="text-align: left;">
                    <div style="font-weight: 900; color: #fff; display: flex; align-items: center; gap: 6px;">
                        <span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px;">S${s.index}</span>
                        <span>${s.fromLabel} → ${s.toLabel}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); font-weight: 700; margin-top: 2px;">
                        Väliaika: ${formatDuration(s.endMs)} s • Nopein: ${s.bestRunner} (${formatDuration(s.bestMs)} s)
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="text-align: right;">
                        <div style="font-family: monospace; font-weight: 900; font-size: 15px; color: #fff;">${formatDuration(s.durationMs)} s</div>
                        <div>${deltaBadge}</div>
                    </div>
                    <button type="button" onclick="jumpToSectorVideo(${s.index})" aria-label="Toista sektori ${s.index}"
                        style="background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.2); min-height: 38px; min-width: 38px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                        ${iconHtml('play_arrow', 'icon-sm')}
                    </button>
                </div>
            </div>
        `;
    }).join('');

    containerEl.innerHTML = `
        <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: 900; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
                    ${iconHtml('speed', 'icon-sm')} SEKTORI-LÄMPÖKARTTA (NAPAUTA HYPPÄÄKSESI VIDEOLLA)
                </span>
                <span style="font-size: 10px; font-weight: 800; color: var(--text-secondary);">🟢 NOPEIN • 🔴 AIKATAPPIO</span>
            </div>
            <div style="position: relative; width: 100%; border-radius: 10px; overflow: hidden; display: flex; border: 1px solid rgba(255,255,255,0.2);">
                ${segmentsHtml}
                <div id="card-heatmap-playhead" style="position: absolute; top: 0; bottom: 0; left: 0%; width: 3px; background: #ffffff; box-shadow: 0 0 8px #ffffff; pointer-events: none; transition: left 0.08s linear;"></div>
            </div>
            ${insightsHtml}
        </div>
        <div style="margin-top: 12px;">
            <div style="font-size: 11px; font-weight: 900; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                OSUUSAJAT & VÄLIAIKAVERTAILU
            </div>
            ${rowsHtml}
        </div>
    `;
}

window.buildRunTelemetry = buildRunTelemetry;
window.updateLiveTelemetryHUD = updateLiveTelemetryHUD;
window.jumpToSectorVideo = jumpToSectorVideo;
window.renderRunTelemetryUI = renderRunTelemetryUI;
