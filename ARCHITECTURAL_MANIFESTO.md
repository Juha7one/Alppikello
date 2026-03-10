# 📜 ALPPIKELLO ARCHITECTURAL MANIFESTO & OPERATING PROTOCOL

This document defines the strict rules for the Alppikello project. Every AI agent must adhere to these principles to ensure system stability, scalability, and consistent deployment.

## 1. INFRASTRUCTURE & SERVICE BOUNDARIES (Critical)
The application is split across three distinct environments. Do NOT attempt to perform server-side actions in the browser, or direct local file access from the server.

*   **Node.js Backend (server.js)**:
    *   Handles **Socket.io** orchestration, session state, and global timing.
    *   Manages **S3 Uploads** (AWS SDK) and metadata.
    *   Does NOT serve files (handled by the CDN/Static host).
    *   Does NOT have a persistent database (Current design is in-memory).
*   **Static/Public Frontend (public/)**:
    *   Runs in the **Browser**.
    *   Pure HTML/JS/CSS (Vanilla). No build step unless specified.
    *   All video processing (MediaRecorder) happens here.
    *   Must use relative paths for internal resources.
*   **Storage (AWS S3)**:
    *   Videos are uploaded here and served via public URLs.
    *   Local scripts must NEVER assume direct file system access to videos.

## 2. CODE STRUCTURE & MODULARITY (Anti-Monolith)
*   **Size Limit**: Files should generally stay under 400-500 lines.
*   **Separation of Concerns**: 
    *   `ui.js`: Rendering, DOM updates, visual logic.
    *   `socket.js`: All `socket.on` and `socket.emit` handlers.
    *   `app.js`: Main controller and onboarding flow.
    *   `timing.js`: Action triggers (Start/Finish/DNF).
    *   `video.js`: Camera, recording, and MediaRecorder logic.
*   **Global Variables**: Keep standard across files (e.g., `currentSession`, `currentRole`, `userName`). Verify in `state.js`.

## 3. DEPLOYMENT & UPDATE PROTOCOL (The Cycle)
Every push to Git MUST follow this exact sequence:
1.  **Version Bump**: Update `version` in `package.json` and `index.html`.
2.  **Identity Change**: Update the Splash Screen **Name** (e.g., STORM PEAK -> GLACIER RUN).
3.  **Color Shift**: Change the Splash Screen **Background CSS Color** to a new hex code.
4.  **Cache Busting**: Update the `?v=` parameter in every `<script>` and `<link>` tag in `index.html`.
5.  **Commit Header**: Start the message with the identity (e.g., `GLACIER RUN v2.69.0: Fixed...`).

## 4. UI/UX & MOBILE PRINCIPLES
*   **Aggressive Deduplication**: If a user has a session to continue, HIDE the manual code input. Only show one "primary" path to join.
*   **Smart Rendering**: Before updating the DOM (especially lists with video), check if data has changed (Hash check). **Never reload a video element needlessly.**
*   **Robustness**: Catch and handle browser errors like `AbortError` (canceled shares) or `NotAllowedError` (camera/location refused) gracefully.

## 5. ENVIRONMENT-AWARE CODING
*   **HTTPS Only**: Certain APIs (Camera, Location, Share) ONLY work in secure contexts.
*   **Latency**: Always assume network latency. Use `getSyncedTime()` and `serverTimeOffset` for all timing calculations.
*   **S3 Readiness**: Always check `s3Active` before attempting video features.

***
**FAILURE TO OBSERVE THESE RULES RESULTS IN SYSTEM FRAGMENTATION.**
