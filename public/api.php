<?php
/**
 * ALPPIKELLO - Stateless Time-of-Day (ToD) & Multi-Camera Backend (PHP)
 * Works on any standard PHP 7.4 / 8.x web server (cPanel, Apache, LiteSpeed, Nginx).
 *
 * All timing calculations rely on device-calibrated timestamps (ms since Unix epoch).
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function nowMs(): int {
    return (int) round(microtime(true) * 1000);
}

if (!function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool {
        $len = strlen($needle);
        return $len === 0 || substr($haystack, -$len) === $needle;
    }
}

// Always attach server timestamp header so clients can passively verify offset on any request
header('X-Server-Time: ' . nowMs());

// Resolve storage directories (supports both root and public/ working directories)
$baseDir = dirname(__DIR__);
if (!is_dir($baseDir . '/public') && basename(__DIR__) !== 'public') {
    $baseDir = __DIR__;
}

$dataDir     = $baseDir . '/data';
$sessionsDir = $dataDir . '/sessions';
$runcardsDir = $dataDir . '/runcards';
$archivesDir = $baseDir . '/archives';
$uploadsDir  = __DIR__ . '/uploads/videos';

foreach ([$dataDir, $sessionsDir, $runcardsDir, $archivesDir, $uploadsDir] as $dir) {
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
}

function sendJson($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Server-Time: ' . nowMs());
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function sanitizeId(string $id): string {
    return preg_replace('/[^a-zA-Z0-9._-]/', '_', trim($id));
}

function getSessionPath(string $sessionId): string {
    global $sessionsDir;
    return $sessionsDir . '/' . sanitizeId($sessionId) . '.json';
}

function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return $_POST ?: [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : ($_POST ?: []);
}

/**
 * Atomic read-modify-write for a session using exclusive file locking (flock).
 */
function withSessionLock(string $sessionId, callable $callback, bool $createIfMissing = false) {
    $path = getSessionPath($sessionId);
    if (!$createIfMissing && !file_exists($path)) {
        return null;
    }

    $fp = fopen($path, 'c+');
    if (!$fp) {
        return null;
    }

    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return null;
    }

    $contents = stream_get_contents($fp);
    $session = $contents ? json_decode($contents, true) : null;

    $result = $callback($session);

    if ($session !== null) {
        if (isset($session['_delete']) && $session['_delete'] === true) {
            flock($fp, LOCK_UN);
            fclose($fp);
            @unlink($path);
            return $result;
        }
        $session['updatedAt'] = nowMs();
        $session['version'] = ($session['version'] ?? 0) + 1;

        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($session, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);
    return $result;
}

function saveRunCardFile(array $runner, array $session): void {
    global $runcardsDir;
    if (empty($runner['runId'])) return;

    $userRuns = array_values(array_filter($session['results'] ?? [], function ($r) use ($runner) {
        return ($r['name'] ?? '') === ($runner['name'] ?? '');
    }));
    $runNumber = count($userRuns);

    $card = [
        'id'             => $runner['runId'],
        'runId'          => $runner['runId'],
        'name'           => $runner['name'] ?? 'Laskija',
        'runNumber'      => $runNumber > 0 ? $runNumber : 1,
        'startTime'      => $runner['startTime'] ?? nowMs(),
        'finishTime'     => $runner['finishTime'] ?? null,
        'totalTime'      => $runner['totalTime'] ?? 0,
        'splits'         => $runner['splits'] ?? [],
        'videoUrl'       => $runner['videoUrl'] ?? null,
        'videos'         => $runner['videos'] ?? [],
        'sessionName'    => $session['name'] ?? $session['id'],
        'sessionId'      => $session['id'],
        'timestamp'      => nowMs(),
        'status'         => $runner['status'] ?? 'OK',
        'sessionResults' => array_map(function ($r) {
            return [
                'name'      => $r['name'] ?? '',
                'totalTime' => $r['totalTime'] ?? 0,
                'status'    => $r['status'] ?? 'OK',
                'runId'     => $r['runId'] ?? ''
            ];
        }, $session['results'] ?? [])
    ];

    $cardPath = $runcardsDir . '/' . sanitizeId($runner['runId']) . '.json';
    file_put_contents($cardPath, json_encode($card, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function archiveSessionData(array $session): string {
    global $archivesDir;
    $dateStr = date('Y-m-d_H-i', (int) (($session['startTime'] ?? nowMs()) / 1000));
    $safeName = preg_replace('/[^a-zA-Z0-9_-]/', '_', $session['name'] ?? $session['id']);
    $filename = "session_{$safeName}_{$dateStr}.json";

    $session['archivedAt'] = nowMs();
    $archivePath = $archivesDir . '/' . $filename;
    file_put_contents($archivePath, json_encode($session, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);

    // Also update all runcards of this session with final sessionResults
    foreach ($session['results'] ?? [] as $runner) {
        saveRunCardFile($runner, $session);
    }

    return $filename;
}

/**
 * Pair a video clip with any matching run(s) based on runId OR timestamp overlap.
 * Supports multiple cameras filming the same run simultaneously or sequentially.
 */
function pairVideoWithSessionRuns(array &$session, array $videoClip, ?string $explicitRunId = null): bool {
    $paired = false;
    $vStart = (int) ($videoClip['videoStartTime'] ?? 0);
    $vEnd   = (int) ($videoClip['videoEndTime'] ?? 0);
    $vTrig  = (int) ($videoClip['triggerTime'] ?? $vEnd);

    if ($vStart <= 0 && $vTrig > 0) {
        $vStart = $vTrig - 8000;
    }
    if ($vEnd <= 0 && $vTrig > 0) {
        $vEnd = $vTrig + 4000;
    }

    $attachToRunner = function (&$runner) use ($videoClip) {
        if (!isset($runner['videos']) || !is_array($runner['videos'])) {
            $runner['videos'] = [];
        }
        // Avoid duplicate url
        foreach ($runner['videos'] as &$existing) {
            if (($existing['url'] ?? '') === $videoClip['url']) {
                $existing = array_merge($existing, $videoClip);
                return;
            }
        }
        unset($existing);

        $runner['videos'][] = $videoClip;
        // Sort videos chronologically by videoStartTime, fallback to triggerTime
        usort($runner['videos'], function ($a, $b) {
            $tA = ($a['videoStartTime'] ?? 0) ?: ($a['triggerTime'] ?? 0);
            $tB = ($b['videoStartTime'] ?? 0) ?: ($b['triggerTime'] ?? 0);
            return $tA <=> $tB;
        });
        $runner['videoUrl'] = $runner['videos'][0]['url'];
    };

    $matchesTimeWindow = function (array $runner) use ($vStart, $vEnd, $vTrig): bool {
        $rStart = (int) ($runner['startTime'] ?? 0);
        if ($rStart <= 0) return false;
        $rFinish = (int) ($runner['finishTime'] ?? 0);
        if ($rFinish <= 0) {
            // Runner is still onCourse; estimate window up to 90s from start
            $rFinish = $rStart + 90000;
        }
        // Grace buffer: 5s before start, 6s after finish
        $winStart = $rStart - 5000;
        $winEnd   = $rFinish + 6000;

        if ($vStart > 0 && $vEnd > 0) {
            return ($vStart <= $winEnd) && ($vEnd >= $winStart);
        }
        return ($vTrig >= $winStart && $vTrig <= $winEnd);
    };

    // 1. Try explicit runId match first across results, onCourse, pendingResults
    if ($explicitRunId && $explicitRunId !== 'N/A' && $explicitRunId !== 'undefined') {
        foreach (['results', 'onCourse', 'pendingResults'] as $listKey) {
            if (!isset($session[$listKey]) || !is_array($session[$listKey])) continue;
            foreach ($session[$listKey] as &$runner) {
                if (($runner['runId'] ?? '') === $explicitRunId) {
                    $attachToRunner($runner);
                    saveRunCardFile($runner, $session);
                    $paired = true;
                }
            }
            unset($runner);
        }
    }

    // 2. If no explicit runId match, match by synchronized timestamp window!
    if (!$paired) {
        foreach (['results', 'onCourse', 'pendingResults'] as $listKey) {
            if (!isset($session[$listKey]) || !is_array($session[$listKey])) continue;
            foreach ($session[$listKey] as &$runner) {
                if ($matchesTimeWindow($runner)) {
                    $attachToRunner($runner);
                    saveRunCardFile($runner, $session);
                    $paired = true;
                    break 2; // Pair to the closest/most recent matching run
                }
            }
            unset($runner);
        }
    }

    return $paired;
}

/**
 * Re-check any unpaired videos when a run starts or finishes.
 */
function flushUnpairedVideos(array &$session): void {
    if (empty($session['unpairedVideos']) || !is_array($session['unpairedVideos'])) {
        return;
    }
    $remaining = [];
    foreach ($session['unpairedVideos'] as $clip) {
        $ok = pairVideoWithSessionRuns($session, $clip, $clip['runId'] ?? null);
        if (!$ok) {
            // Keep unpaired clips for up to 15 minutes
            if (nowMs() - ($clip['uploadedAt'] ?? nowMs()) < 15 * 60 * 1000) {
                $remaining[] = $clip;
            }
        }
    }
    $session['unpairedVideos'] = $remaining;
}

function haversineKm(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $R = 6371.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    $a = sin($dLat / 2) * sin($dLat / 2) +
         cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
         sin($dLon / 2) * sin($dLon / 2);
    return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

// ============================================================================
// ROUTING
// ============================================================================

$action = $_GET['action'] ?? $_POST['action'] ?? '';

// 1. ULTRA-FAST CLOCK CALIBRATION ENDPOINT
if ($action === 'time') {
    sendJson([
        'serverTime' => nowMs(),
        'storageActive' => true
    ]);
}

// 2. CREATE SESSION
if ($action === 'create_session') {
    $body = readJsonBody();
    $baseId = sanitizeId($body['id'] ?? ('TREENI-' . date('d.m-H.i')));
    $sessionId = $baseId;
    $count = 1;
    while (file_exists(getSessionPath($sessionId))) {
        $sessionId = "{$baseId}-{$count}";
        $count++;
    }

    $deviceId = $body['deviceId'] ?? ('dev_' . bin2hex(random_bytes(4)));
    $creatorName = trim($body['creatorName'] ?? 'Valmentaja') ?: 'Valmentaja';
    $location = $body['location'] ?? null;

    $newSession = null;
    withSessionLock($sessionId, function (&$session) use ($sessionId, $body, $deviceId, $creatorName, $location, &$newSession) {
        $session = [
            'id'               => $sessionId,
            'name'             => $body['name'] ?? $sessionId,
            'startTime'        => nowMs(),
            'updatedAt'        => nowMs(),
            'version'          => 1,
            'adminId'          => $deviceId,
            'devices'          => [
                $deviceId => [
                    'id'            => $deviceId,
                    'role'          => 'VALMENTAJA',
                    'name'          => $creatorName,
                    'lastHeartbeat' => nowMs(),
                    'battery'       => 100,
                    'location'      => $location
                ]
            ],
            'allAthletes'      => [],
            'activeQueue'      => [],
            'onCourse'         => [],
            'results'          => [],
            'pendingResults'   => [],
            'pendingFinishes'  => [],
            'unpairedVideos'   => [],
            'processedEvents'  => [],
            'expectedDuration' => null,
            'forerunnerCount'  => 0,
            'location'         => $location,
            'ended'            => false
        ];
        $newSession = $session;
    }, true);

    sendJson(['success' => true, 'session' => $newSession]);
}

// 3. JOIN SESSION
if ($action === 'join_session') {
    $body = readJsonBody();
    $sessionId  = trim($body['sessionId'] ?? '');
    $role       = trim($body['role'] ?? 'KATSOMO');
    $deviceName = trim($body['deviceName'] ?? 'Laite') ?: 'Laite';
    $deviceId   = trim($body['deviceId'] ?? ('dev_' . bin2hex(random_bytes(4))));
    $location   = $body['location'] ?? null;

    $validRoles = ['VALMENTAJA', 'LÄHETTÄJÄ', 'LÄHTÖ', 'MAALI', 'VÄLIAIKA', 'URHEILIJA', 'VIDEO', 'KATSOMO'];
    if (!in_array($role, $validRoles, true)) {
        sendJson(['success' => false, 'error' => 'Virheellinen rooli'], 400);
    }

    $joinedSession = null;
    $err = null;

    withSessionLock($sessionId, function (&$session) use ($role, $deviceName, $deviceId, $location, &$joinedSession, &$err) {
        if (!$session || !empty($session['ended'])) {
            $err = 'Istuntoa ei löytynyt tai se on päättynyt';
            return;
        }

        // Single LÄHTÖ or MAALI gate role replacement
        if ($role === 'LÄHTÖ' || $role === 'MAALI') {
            foreach ($session['devices'] ?? [] as $did => &$dev) {
                if (($dev['role'] ?? '') === $role && $did !== $deviceId) {
                    unset($session['devices'][$did]);
                } elseif ($role === 'LÄHTÖ' && ($dev['role'] ?? '') === 'LÄHETTÄJÄ' && $did !== $deviceId) {
                    // Automatically disable start clock function on LÄHETTÄJÄ when dedicated LÄHTÖ joins
                    $dev['actsAsStartClock'] = false;
                }
            }
            unset($dev);
        }

        $session['devices'][$deviceId] = [
            'id'               => $deviceId,
            'role'             => $role,
            'name'             => $deviceName,
            'lastHeartbeat'    => nowMs(),
            'battery'          => 100,
            'actsAsStartClock' => ($role === 'LÄHTÖ'),
            'location'         => $location ?? ($session['devices'][$deviceId]['location'] ?? null)
        ];

        if ($location && empty($session['location'])) {
            $session['location'] = $location;
        }

        if ($role === 'URHEILIJA') {
            if (!isset($session['allAthletes']) || !is_array($session['allAthletes'])) {
                $session['allAthletes'] = [];
            }
            $exists = false;
            foreach ($session['allAthletes'] as $a) {
                if (($a['id'] ?? '') === $deviceId || mb_strtoupper($a['name'] ?? '') === mb_strtoupper($deviceName)) {
                    $exists = true;
                    break;
                }
            }
            if (!$exists) {
                $session['allAthletes'][] = ['id' => $deviceId, 'name' => $deviceName];
            }
        }

        $joinedSession = $session;
    }, false);

    if ($err || !$joinedSession) {
        sendJson(['success' => false, 'error' => $err ?? 'Istuntoa ei löytynyt']);
    }

    sendJson([
        'success' => true,
        'session' => $joinedSession,
        'role'    => $role
    ]);
}

// 4. GET SESSION STATE (Lightweight polling with version check)
if ($action === 'session_state') {
    $sessionId    = trim($_GET['sessionId'] ?? '');
    $sinceVersion = isset($_GET['v']) ? (int) $_GET['v'] : -1;
    $deviceId     = trim($_GET['deviceId'] ?? '');

    $path = getSessionPath($sessionId);
    if (!$sessionId || !file_exists($path)) {
        sendJson(['error' => 'Istuntoa ei löytynyt', 'ended' => true], 404);
    }

    // Fast read unless heartbeat/location update is included
    $lat = isset($_GET['lat']) && $_GET['lat'] !== '' ? (float) $_GET['lat'] : null;
    $lon = isset($_GET['lon']) && $_GET['lon'] !== '' ? (float) $_GET['lon'] : null;

    if ($deviceId && ($lat !== null && $lon !== null)) {
        // Update device location only if changed meaningfully
        $sessionData = null;
        withSessionLock($sessionId, function (&$session) use ($deviceId, $lat, $lon, &$sessionData) {
            if (!$session) return;
            if (isset($session['devices'][$deviceId])) {
                $locObj = ['lat' => $lat, 'lon' => $lon, 'timestamp' => nowMs()];
                $session['devices'][$deviceId]['location'] = $locObj;
                $session['devices'][$deviceId]['lastHeartbeat'] = nowMs();
                if (($session['adminId'] ?? '') === $deviceId || empty($session['location'])) {
                    $session['location'] = $locObj;
                }
            }
            $sessionData = $session;
        });
    } else {
        $raw = @file_get_contents($path);
        $sessionData = $raw ? json_decode($raw, true) : null;
    }

    if (!$sessionData) {
        sendJson(['error' => 'Istuntoa ei voitu lukea'], 500);
    }

    if (!empty($sessionData['ended'])) {
        sendJson(['ended' => true, 'session' => $sessionData]);
    }

    $currentVersion = (int) ($sessionData['version'] ?? 1);
    if ($sinceVersion > 0 && $sinceVersion === $currentVersion) {
        sendJson([
            'notModified' => true,
            'version'     => $currentVersion,
            'serverTime'  => nowMs()
        ]);
    }

    sendJson([
        'notModified' => false,
        'version'     => $currentVersion,
        'session'     => $sessionData,
        'serverTime'  => nowMs()
    ]);
}

// 5. GET SESSION NAMES (For onboarding name picker)
if ($action === 'get_session_names') {
    $sessionId = trim($_GET['sessionId'] ?? '');
    $path = getSessionPath($sessionId);
    if (!$sessionId || !file_exists($path)) {
        sendJson(['error' => 'Istuntoa ei löytynyt'], 404);
    }
    $session = json_decode(file_get_contents($path), true);
    sendJson([
        'name'     => $session['name'] ?? $sessionId,
        'athletes' => $session['allAthletes'] ?? [],
        'devices'  => array_values($session['devices'] ?? [])
    ]);
}

// 6. FIND NEARBY SESSIONS
if ($action === 'nearby_sessions') {
    $lat = isset($_GET['lat']) ? (float) $_GET['lat'] : null;
    $lon = isset($_GET['lon']) ? (float) $_GET['lon'] : null;
    $nearby = [];
    $now = nowMs();

    foreach (glob($sessionsDir . '/*.json') as $file) {
        $s = json_decode(@file_get_contents($file), true);
        if (!$s || !empty($s['ended'])) continue;

        $updatedAt = $s['updatedAt'] ?? $s['startTime'] ?? 0;
        if ($now - $updatedAt > 2 * 60 * 60 * 1000) continue; // Ignore sessions idle > 2h

        $dist = 0.0;
        if ($lat && $lon && !empty($s['location']['lat']) && !empty($s['location']['lon'])) {
            $dist = haversineKm($lat, $lon, (float) $s['location']['lat'], (float) $s['location']['lon']);
            if ($dist > 5.0) continue;
        }

        $athleteCount = count($s['allAthletes'] ?? []);
        $nearby[] = [
            'id'           => $s['id'],
            'name'         => $s['name'] ?? $s['id'],
            'distance'     => number_format($dist, 2),
            'athleteCount' => $athleteCount
        ];
    }

    sendJson(['sessions' => $nearby]);
}

// 7. PROCESS TIMING & CONTROL EVENTS (Supports Outbox Queue & Out-of-Order Timestamps)
if ($action === 'event') {
    $body = readJsonBody();
    // Support either a single event or an array of events from the offline Outbox
    $events = isset($body['events']) && is_array($body['events']) ? $body['events'] : [$body];

    if (empty($events)) {
        sendJson(['success' => false, 'error' => 'Ei tapahtumia'], 400);
    }

    $sessionId = trim($events[0]['sessionId'] ?? $body['sessionId'] ?? '');
    if (!$sessionId) {
        sendJson(['success' => false, 'error' => 'sessionId puuttuu'], 400);
    }

    $updatedSession = null;
    $lastTimingEvent = null;

    withSessionLock($sessionId, function (&$session) use ($events, &$updatedSession, &$lastTimingEvent) {
        if (!$session) return;

        if (!isset($session['processedEvents']) || !is_array($session['processedEvents'])) {
            $session['processedEvents'] = [];
        }

        // Sort incoming batch by timestamp so START is always processed before SPLIT/FINISH
        usort($events, function ($a, $b) {
            return ($a['timestamp'] ?? 0) <=> ($b['timestamp'] ?? 0);
        });

        foreach ($events as $ev) {
            $eventId   = $ev['eventId'] ?? null;
            $type      = $ev['type'] ?? '';
            $timestamp = (int) ($ev['timestamp'] ?? nowMs());

            if ($eventId && in_array($eventId, $session['processedEvents'], true)) {
                continue; // Already processed (idempotent retry protection)
            }
            if ($eventId) {
                $session['processedEvents'][] = $eventId;
                if (count($session['processedEvents']) > 300) {
                    array_shift($session['processedEvents']);
                }
            }

            switch ($type) {
                case 'trigger_start':
                case 'START': {
                    $athlete = null;
                    if (!empty($session['activeQueue'])) {
                        $athlete = array_shift($session['activeQueue']);
                    } elseif (!empty($ev['athleteName'])) {
                        $athlete = ['id' => 'AUTO-' . $timestamp, 'name' => $ev['athleteName']];
                    }
                    if (!$athlete) break;

                    $runId = $ev['runId'] ?? ('run_' . $timestamp . '_' . bin2hex(random_bytes(3)));
                    $runner = [
                        'id'        => $athlete['id'],
                        'runId'     => $runId,
                        'name'      => $athlete['name'],
                        'startTime' => $timestamp,
                        'splits'    => [],
                        'videos'    => [],
                        'videoUrl'  => null,
                        'done'      => false
                    ];

                    // Rotate athlete to bottom of master list
                    foreach ($session['allAthletes'] as $idx => $a) {
                        if ((string)($a['id'] ?? '') === (string)$athlete['id']) {
                            $moved = $session['allAthletes'][$idx];
                            array_splice($session['allAthletes'], $idx, 1);
                            $session['allAthletes'][] = $moved;
                            break;
                        }
                    }

                    // Check if a FINISH timestamp already arrived out-of-order for this start!
                    $matchedPendingFinish = null;
                    if (!empty($session['pendingFinishes'])) {
                        foreach ($session['pendingFinishes'] as $pfIdx => $pfTime) {
                            if ($pfTime > $timestamp && ($pfTime - $timestamp) < 180000) {
                                $matchedPendingFinish = $pfTime;
                                array_splice($session['pendingFinishes'], $pfIdx, 1);
                                break;
                            }
                        }
                    }

                    if ($matchedPendingFinish !== null) {
                        $runner['finishTime'] = $matchedPendingFinish;
                        $runner['totalTime']  = $matchedPendingFinish - $timestamp;
                        $runner['done']       = true;
                        array_unshift($session['results'], $runner);
                        saveRunCardFile($runner, $session);
                        $lastTimingEvent = ['type' => 'FINISH', 'runner' => $runner];
                    } else {
                        $session['onCourse'][] = $runner;
                        // Sort onCourse by startTime
                        usort($session['onCourse'], fn($a, $b) => ($a['startTime'] ?? 0) <=> ($b['startTime'] ?? 0));
                        $lastTimingEvent = ['type' => 'START', 'runner' => $runner];
                    }

                    flushUnpairedVideos($session);
                    break;
                }

                case 'trigger_split':
                case 'SPLIT': {
                    $deviceName = trim($ev['deviceName'] ?? 'Väliaika');
                    $matched = false;

                    // 1. Check active runners onCourse
                    if (!empty($session['onCourse'])) {
                        foreach ($session['onCourse'] as &$runner) {
                            if ($timestamp > ($runner['startTime'] ?? 0)) {
                                $alreadyHas = false;
                                foreach ($runner['splits'] ?? [] as $s) {
                                    if (($s['deviceName'] ?? '') === $deviceName) {
                                        $alreadyHas = true;
                                        break;
                                    }
                                }
                                if (!$alreadyHas) {
                                    $runner['splits'][] = [
                                        'timestamp'  => $timestamp,
                                        'duration'   => $timestamp - $runner['startTime'],
                                        'deviceName' => $deviceName
                                    ];
                                    usort($runner['splits'], fn($a, $b) => ($a['duration'] ?? 0) <=> ($b['duration'] ?? 0));
                                    $lastTimingEvent = ['type' => 'SPLIT', 'runner' => $runner];
                                    $matched = true;
                                    break;
                                }
                            }
                        }
                        unset($runner);
                    }

                    // 2. If split arrived slightly after FINISH due to network delay, attach to finished run!
                    if (!$matched && !empty($session['results'])) {
                        foreach ($session['results'] as &$runner) {
                            $rStart  = $runner['startTime'] ?? 0;
                            $rFinish = $runner['finishTime'] ?? 0;
                            if ($timestamp > $rStart && $timestamp < $rFinish) {
                                $runner['splits'][] = [
                                    'timestamp'  => $timestamp,
                                    'duration'   => $timestamp - $rStart,
                                    'deviceName' => $deviceName
                                ];
                                usort($runner['splits'], fn($a, $b) => ($a['duration'] ?? 0) <=> ($b['duration'] ?? 0));
                                saveRunCardFile($runner, $session);
                                $lastTimingEvent = ['type' => 'SPLIT', 'runner' => $runner];
                                break;
                            }
                        }
                        unset($runner);
                    }
                    break;
                }

                case 'trigger_finish':
                case 'FINISH': {
                    if (!empty($session['onCourse'])) {
                        $runner = array_shift($session['onCourse']);
                        $runner['finishTime'] = $timestamp;
                        $duration = $timestamp - ($runner['startTime'] ?? $timestamp);
                        $runner['totalTime'] = max(0, $duration);
                        $runner['done'] = true;

                        $isSuspicious = false;
                        if (!empty($session['expectedDuration'])) {
                            $min = $session['expectedDuration'] * 0.7;
                            $max = $session['expectedDuration'] * 1.5;
                            if ($duration < $min || $duration > $max) {
                                $isSuspicious = true;
                            }
                        }

                        if ($isSuspicious) {
                            $runner['suspicious'] = true;
                            $session['pendingResults'][] = $runner;
                        } else {
                            array_unshift($session['results'], $runner);
                            if (($session['forerunnerCount'] ?? 0) < 5 && $duration > 0) {
                                $fc = $session['forerunnerCount'] ?? 0;
                                $exp = $session['expectedDuration'] ?? $duration;
                                $session['expectedDuration'] = ($exp * $fc + $duration) / ($fc + 1);
                                $session['forerunnerCount'] = $fc + 1;
                            }
                        }

                        flushUnpairedVideos($session);
                        saveRunCardFile($runner, $session);
                        $lastTimingEvent = ['type' => 'FINISH', 'runner' => $runner];
                    } else {
                        // Store pending finish in case Start phone is offline and delivers START later
                        $session['pendingFinishes'][] = $timestamp;
                    }
                    break;
                }

                case 'move_to_queue': {
                    $aid = (string) ($ev['athleteId'] ?? '');
                    $found = null;
                    foreach ($session['allAthletes'] ?? [] as $a) {
                        if ((string)($a['id'] ?? '') === $aid) {
                            $found = $a;
                            break;
                        }
                    }
                    if ($found) {
                        $current = $session['activeQueue'][0] ?? null;
                        if ($current && (string)($current['id'] ?? '') === $aid) {
                            $session['activeQueue'] = [];
                        } else {
                            $session['activeQueue'] = [$found];
                        }
                    }
                    break;
                }

                case 'clear_queue': {
                    $session['activeQueue'] = [];
                    break;
                }

                case 'add_athlete': {
                    $name = trim($ev['name'] ?? '');
                    if ($name !== '') {
                        $uniqueName = $name;
                        $c = 1;
                        $namesUpper = array_map(fn($a) => mb_strtoupper($a['name'] ?? ''), $session['allAthletes'] ?? []);
                        while (in_array(mb_strtoupper($uniqueName), $namesUpper, true)) {
                            $c++;
                            $uniqueName = "{$name} {$c}";
                        }
                        $newAthlete = ['id' => 'MANUAL-' . nowMs() . '-' . $c, 'name' => $uniqueName];
                        $session['allAthletes'][] = $newAthlete;
                        if (!empty($ev['autoQueue'])) {
                            $session['activeQueue'] = [$newAthlete];
                        }
                    }
                    break;
                }

                case 'athlete_ready': {
                    $name = trim($ev['name'] ?? 'Tuntematon');
                    $devId = $ev['deviceId'] ?? ('ATH-' . nowMs());
                    $existsInQueue = false;
                    foreach ($session['activeQueue'] ?? [] as $q) {
                        if (($q['id'] ?? '') === $devId) $existsInQueue = true;
                    }
                    if (!$existsInQueue) {
                        $session['activeQueue'][] = ['id' => $devId, 'name' => $name];
                    }
                    break;
                }

                case 'mark_dnf': {
                    $runnerId = (string) ($ev['runnerId'] ?? '');
                    foreach ($session['onCourse'] ?? [] as $idx => $r) {
                        if ((string)($r['id'] ?? '') === $runnerId || (string)($r['runId'] ?? '') === $runnerId) {
                            $runner = $session['onCourse'][$idx];
                            array_splice($session['onCourse'], $idx, 1);
                            $runner['status'] = 'DNF';
                            $runner['totalTime'] = 0;
                            $runner['done'] = true;
                            array_unshift($session['results'], $runner);
                            saveRunCardFile($runner, $session);
                            $lastTimingEvent = ['type' => 'DNF', 'runner' => $runner];
                            break;
                        }
                    }
                    break;
                }

                case 'manual_finish': {
                    $runnerId = (string) ($ev['runnerId'] ?? '');
                    foreach ($session['onCourse'] ?? [] as $idx => $r) {
                        if ((string)($r['id'] ?? '') === $runnerId || (string)($r['runId'] ?? '') === $runnerId) {
                            $runner = $session['onCourse'][$idx];
                            array_splice($session['onCourse'], $idx, 1);
                            $runner['finishTime'] = $timestamp;
                            $runner['totalTime'] = max(0, $timestamp - ($runner['startTime'] ?? $timestamp));
                            $runner['done'] = true;
                            $runner['manual'] = true;
                            array_unshift($session['results'], $runner);
                            flushUnpairedVideos($session);
                            saveRunCardFile($runner, $session);
                            $lastTimingEvent = ['type' => 'FINISH', 'runner' => $runner];
                            break;
                        }
                    }
                    break;
                }

                case 'confirm_result': {
                    $runnerId = (string) ($ev['runnerId'] ?? '');
                    foreach ($session['pendingResults'] ?? [] as $idx => $r) {
                        if ((string)($r['id'] ?? '') === $runnerId || (string)($r['runId'] ?? '') === $runnerId) {
                            $runner = $session['pendingResults'][$idx];
                            array_splice($session['pendingResults'], $idx, 1);
                            unset($runner['suspicious']);
                            array_unshift($session['results'], $runner);
                            saveRunCardFile($runner, $session);
                            break;
                        }
                    }
                    break;
                }

                case 'reject_result': {
                    $runnerId = (string) ($ev['runnerId'] ?? '');
                    $session['pendingResults'] = array_values(array_filter(
                        $session['pendingResults'] ?? [],
                        fn($r) => (string)($r['id'] ?? '') !== $runnerId && (string)($r['runId'] ?? '') !== $runnerId
                    ));
                    break;
                }

                case 'update_session_name': {
                    $newName = trim($ev['name'] ?? '');
                    if ($newName !== '') {
                        $session['name'] = $newName;
                    }
                    break;
                }

                case 'set_starter_clock_mode': {
                    $devId = trim($ev['deviceId'] ?? '');
                    $enabled = !empty($ev['enabled']);
                    if ($devId && isset($session['devices'][$devId])) {
                        $session['devices'][$devId]['actsAsStartClock'] = $enabled;
                    }
                    if ($enabled) {
                        // Ensure no duplicate LÄHTÖ device remains if starter explicitly takes over start clock
                        foreach ($session['devices'] ?? [] as $did => $dev) {
                            if (($dev['role'] ?? '') === 'LÄHTÖ' && $did !== $devId) {
                                unset($session['devices'][$did]);
                            }
                        }
                    }
                    break;
                }

                case 'end_session': {
                    $session['ended'] = true;
                    $archiveFile = archiveSessionData($session);
                    $session['archiveFilename'] = $archiveFile;
                    break;
                }
            }
        }

        $updatedSession = $session;
    });

    if (!$updatedSession) {
        sendJson(['success' => false, 'error' => 'Istuntoa ei löytynyt'], 404);
    }

    sendJson([
        'success'     => true,
        'session'     => $updatedSession,
        'timingEvent' => $lastTimingEvent,
        'serverTime'  => nowMs()
    ]);
}

// 8. VIDEO UPLOAD & MULTI-CAMERA TIMESTAMP PAIRING
if ($action === 'upload_video') {
    $sessionId          = trim($_POST['sessionId'] ?? '');
    $runId              = trim($_POST['runId'] ?? '');
    $runnerName         = trim($_POST['runnerName'] ?? 'LASKIJA');
    $role               = trim($_POST['role'] ?? 'VIDEO');
    $cameraName         = trim($_POST['cameraName'] ?? $role);
    $triggerTime        = (int) ($_POST['triggerTime'] ?? nowMs());
    $videoStartTime     = (int) ($_POST['videoCaptureStartTime'] ?? $_POST['videoStartTime'] ?? 0);
    $videoEndTime       = (int) ($_POST['videoCaptureEndTime'] ?? $_POST['videoEndTime'] ?? nowMs());
    $clipDurationMs     = ($videoStartTime > 0 && $videoEndTime > $videoStartTime) ? ($videoEndTime - $videoStartTime) : 0;

    if (!isset($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
        $errCode = $_FILES['video']['error'] ?? -1;
        sendJson(['success' => false, 'error' => "Videon vastaanotto epäonnistui (koodi: {$errCode})"], 400);
    }

    $safeSession = sanitizeId($sessionId ?: 'GENERAL');
    $sessionUploadDir = $uploadsDir . '/' . $safeSession;
    if (!is_dir($sessionUploadDir)) {
        @mkdir($sessionUploadDir, 0775, true);
    }

    $ext = pathinfo($_FILES['video']['name'] ?? 'clip.mp4', PATHINFO_EXTENSION) ?: 'mp4';
    $safeCam = sanitizeId($cameraName ?: $role);
    $safeRunner = sanitizeId($runnerName);
    $filename = "{$safeCam}_{$safeRunner}_{$triggerTime}_" . substr(md5(uniqid('', true)), 0, 5) . ".{$ext}";
    $targetPath = $sessionUploadDir . '/' . $filename;

    if (!move_uploaded_file($_FILES['video']['tmp_name'], $targetPath)) {
        sendJson(['success' => false, 'error' => 'Videotiedoston tallennus levylle epäonnistui'], 500);
    }

    $relativeUrl = "uploads/videos/{$safeSession}/{$filename}";

    $videoClip = [
        'id'             => 'vid_' . bin2hex(random_bytes(4)),
        'url'            => $relativeUrl,
        'role'           => $role,
        'cameraName'     => $cameraName,
        'triggerTime'    => $triggerTime,
        'videoStartTime' => $videoStartTime,
        'videoEndTime'   => $videoEndTime,
        'durationMs'     => $clipDurationMs,
        'uploadedAt'     => nowMs(),
        'runId'          => ($runId && $runId !== 'N/A') ? $runId : null
    ];

    $paired = false;
    $updatedSession = null;

    if ($sessionId && file_exists(getSessionPath($sessionId))) {
        withSessionLock($sessionId, function (&$session) use ($videoClip, $runId, &$paired, &$updatedSession) {
            if (!$session) return;
            $paired = pairVideoWithSessionRuns($session, $videoClip, $runId);
            if (!$paired) {
                if (!isset($session['unpairedVideos']) || !is_array($session['unpairedVideos'])) {
                    $session['unpairedVideos'] = [];
                }
                $session['unpairedVideos'][] = $videoClip;
            }
            $updatedSession = $session;
        });
    }

    sendJson([
        'success' => true,
        'url'     => $relativeUrl,
        'video'   => $videoClip,
        'paired'  => $paired,
        'session' => $updatedSession
    ]);
}

// 9. GET INDIVIDUAL RUN CARD
if ($action === 'get_run') {
    $runId = sanitizeId($_GET['runId'] ?? '');
    if (!$runId) sendJson(['error' => 'runId puuttuu'], 400);

    // 1. Check saved runcards directory
    $cardPath = $runcardsDir . '/' . $runId . '.json';
    if (file_exists($cardPath)) {
        $card = json_decode(file_get_contents($cardPath), true);
        // Refresh from active session if session is still active (to include newly uploaded camera angles)
        $sid = $card['sessionId'] ?? '';
        if ($sid && file_exists(getSessionPath($sid))) {
            $sess = json_decode(file_get_contents(getSessionPath($sid)), true);
            foreach ($sess['results'] ?? [] as $r) {
                if (($r['runId'] ?? '') === $runId) {
                    saveRunCardFile($r, $sess);
                    $card = json_decode(file_get_contents($cardPath), true);
                    break;
                }
            }
        }
        sendJson($card);
    }

    // 2. Fallback: search active sessions and archives
    foreach (array_merge(glob($sessionsDir . '/*.json'), glob($archivesDir . '/*.json')) as $file) {
        $sess = json_decode(@file_get_contents($file), true);
        if (!$sess) continue;
        foreach ($sess['results'] ?? [] as $r) {
            if (($r['runId'] ?? '') === $runId) {
                saveRunCardFile($r, $sess);
                sendJson(json_decode(file_get_contents($cardPath), true));
            }
        }
    }

    sendJson(['error' => 'Suoritusta ei löytynyt'], 404);
}

// 10. ARCHIVES LIST & OPERATIONS
if ($action === 'archives') {
    $list = [];
    foreach (glob($archivesDir . '/*.json') as $file) {
        $data = json_decode(@file_get_contents($file), true);
        if (!$data) continue;
        $results = $data['results'] ?? [];
        $athletes = array_values(array_unique(array_map(fn($r) => $r['name'] ?? '', $results)));
        $list[] = [
            'filename'     => basename($file),
            'name'         => $data['name'] ?? basename($file, '.json'),
            'date'         => $data['archivedAt'] ?? $data['startTime'] ?? (filemtime($file) * 1000),
            'athleteCount' => count($results),
            'athletes'     => $athletes,
            'autoArchived' => !empty($data['autoArchived'])
        ];
    }
    usort($list, fn($a, $b) => ($b['date'] ?? 0) <=> ($a['date'] ?? 0));
    sendJson($list);
}

if ($action === 'get_archive') {
    $filename = basename($_GET['filename'] ?? '');
    if (!str_ends_with($filename, '.json')) $filename .= '.json';
    $path = $archivesDir . '/' . $filename;
    if (!file_exists($path)) {
        sendJson(['error' => 'Arkistoa ei löytynyt'], 404);
    }
    sendJson(json_decode(file_get_contents($path), true));
}

if ($action === 'delete_archive') {
    $filename = basename($_GET['filename'] ?? $_POST['filename'] ?? '');
    if (!str_ends_with($filename, '.json')) $filename .= '.json';
    $path = $archivesDir . '/' . $filename;
    if (file_exists($path)) {
        @unlink($path);
    }
    sendJson(['success' => true]);
}

if ($action === 'delete_archive_run') {
    $filename = basename($_GET['filename'] ?? $_POST['filename'] ?? '');
    $runId    = trim($_GET['runId'] ?? $_POST['runId'] ?? '');
    if (!str_ends_with($filename, '.json')) $filename .= '.json';
    $path = $archivesDir . '/' . $filename;
    if (!file_exists($path)) {
        sendJson(['error' => 'Arkistoa ei löytynyt'], 404);
    }
    $data = json_decode(file_get_contents($path), true);
    $data['results'] = array_values(array_filter(
        $data['results'] ?? [],
        fn($r) => ($r['runId'] ?? '') !== $runId
    ));
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    sendJson(['success' => true, 'remaining' => count($data['results'])]);
}

sendJson(['error' => 'Tuntematon toiminto: ' . $action], 400);
