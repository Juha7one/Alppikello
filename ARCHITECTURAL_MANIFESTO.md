# ALPPIKELLO ARCHITECTURAL MANIFESTO

> This document is the source of truth for the Alppikello system architecture. Any AI assistant working on this project MUST read and follow these rules to ensure system integrity.

## 1. Dual-Domain Architecture (The "Static-Backend Bridge")
Alppikello is split into two distinct environments:
- **Frontend (Static):** `alppikello.luodut.com` (Hosted on a standard cPanel webhotelli).
- **Backend (Node.js):** `alppikello-backend.onrender.com` (Hosted on Render.js).

**CRITICAL RULES:**
- **No Relative Paths for Assets:** All video URLs and API endpoints MUST be absolute (e.g., `https://domain.com/path` instead of `/path`).
- **CORS:** The backend must always have CORS enabled to allow the static frontend to fetch data and upload videos.
- **Frontend-Side Rendering:** Shared result cards (Run Cards) are rendered by the frontend single-page app (SPA) using the `?run=ID` query parameter to avoid 404/500 errors on the static host.

## 2. Video Life Cycle & Pairing
The system uses a decentralized video recording strategy (any device can be a camera).

**THE PAIRING CHAIN:**
1.  **Recording:** A device (e.g., Video Role) records a clip.
2.  **Metadata:** The device attaches the `runId` (unique per run) and `runnerId` (unique per athlete) to the video payload.
3.  **Upload:** Video is sent to `BACKEND/upload`.
4.  **Storage:** The server uploads the file to **AWS S3** (Primary) or `/uploads` (Fallback).
5.  **Linking:** The server finds the active run in memory using the `runId` and updates its `videoUrl`.
6.  **Persistence:** The video URL is saved into the `runCards` map for public sharing.

## 3. Storage & Persistence Strategy
Currently, Alppikello is "volatile" (RAM-based). 

**STORAGE LAYERS:**
- **Videos:** Permanent (AWS S3). They stay in the bucket forever unless manually deleted.
- **Active Sessions:** Volatile (In-Memory `sessions` object). Lost on server restart.
- **Public Shares:** Volatile (In-Memory `runCards` object). Lost on server restart.

**IMPROVEMENT PLAN (TO BE IMPLEMENTED):**
- **Session Archiving:** When a session is ended, the server must save the entire session metadata (results, times, names, video links) into a JSON file in the `/archives` directory.
- **Archive Browser:** A private "Coach Archive" view where old sessions can be picked and reviewed.

## 4. Time Synchronization
Alpine skiing requires millisecond precision.
- System uses a **Server-Offset NTP-style sync**.
- Devices calculate `serverTimeOffset = ((ServerTime - ClientTime) + (ServerTime - ResponseTime)) / 2`.
- All timestamps sent to the server MUST be adjusted using `getSyncedTime()`.

## 5. Device Communication (Socket.io)
- **Rooms:** Devices for the same session are joined into a Socket.io room named after the `SessionId`.
- **Heartbeats:** Devices send periodic heartbeats to keep the session alive.
- **Housekeeping:** Sessions with no heartbeats for >12 hours are purged from memory.

---
*Signed, Antigravity AI & Juha*
