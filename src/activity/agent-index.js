const { randomUUID } = require('crypto');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { uIOhook } = require('uiohook-napi');
// Use node-fetch v2 instead of Node's experimental built-in fetch.
// Node 18's built-in fetch (backed by undici with worker threads) fails
// silently in pkg-bundled executables with "fetch failed".  node-fetch v2
// uses plain https.request — no worker threads, fully pkg-compatible.
const fetch = require('node-fetch');

dotenv.config();

// ─── Disk queue helpers ────────────────────────────────────────────────────────
// Events that fail to send are persisted to disk so they survive crashes and
// agent restarts, then replayed on the next successful connection.
const QUEUE_FILE = path.join(
    process.env.APPDATA || process.env.HOME || '.',
    'ZuvelioActivityAgent',
    'offline-queue.json',
);

function ensureQueueDir() {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readDiskQueue() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (_) { /* corrupt file — ignore */ }
    return [];
}

function writeDiskQueue(events) {
    try {
        ensureQueueDir();
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(events), 'utf8');
    } catch (err) {
        console.warn('Could not persist offline queue:', err.message);
    }
}

function clearDiskQueue() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            fs.unlinkSync(QUEUE_FILE);
        }
    } catch (_) { /* ignore */ }
}

// ─── Config ────────────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const DEVICE_TOKEN = process.env.DEVICE_TOKEN;       // Preferred auth method
const USER_EMAIL = process.env.USER_EMAIL;            // Fallback auth method
const USER_PASSWORD = process.env.USER_PASSWORD;      // Fallback auth method
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 5000);
const MOUSE_MOVE_SAMPLE_MS = Number(process.env.MOUSE_MOVE_SAMPLE_MS || 1000);
const IDLE_THRESHOLD_MS = Number(process.env.IDLE_THRESHOLD_MS || 600000);
const SESSION_ID = process.env.SESSION_ID || `desktop-agent-${randomUUID()}`;
// How often to ping the server to keep the user showing as "online" even when
// the keyboard/mouse has been idle beyond IDLE_THRESHOLD_MS.  Default 60 s.
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 60000);

// ─── --install flag: create Windows startup shortcut ──────────────────────────
if (process.argv.includes('--install')) {
    installStartup();
    process.exit(0);
}

if (process.argv.includes('--uninstall')) {
    uninstallStartup();
    process.exit(0);
}

function getExePath() {
    // When packaged by pkg, process.execPath is the EXE itself
    return process.pkg ? process.execPath : process.argv[1];
}

function getStartupDir() {
    return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function installStartup() {
    try {
        const exePath = getExePath();
        const startupDir = getStartupDir();
        const shortcutPath = path.join(startupDir, 'ZuvelioActivityAgent.bat');
        const envDir = path.dirname(exePath);

        // The BAT auto-elevates to Administrator so global keyboard/mouse
        // hooks can capture input from ALL applications (Notepad, Excel, etc.)
        const batContent = [
            '@echo off',
            ':: Auto-elevate to Administrator for global input hooks',
            'net session >nul 2>&1',
            'if %errorLevel% neq 0 (',
            `    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process '%~f0' -Verb RunAs"`,
            '    exit /b',
            ')',
            `cd /d "${envDir}"`,
            `start "Zuvelio Activity Agent" "${exePath}"`,
        ].join('\r\n') + '\r\n';
        fs.writeFileSync(shortcutPath, batContent, 'utf8');
        console.log(`Auto-start installed. Agent will launch on next Windows login.`);
        console.log(`Startup bat: ${shortcutPath}`);
        console.log(`Make sure your .env file is in: ${envDir}`);
    } catch (err) {
        console.error('Failed to install startup entry:', err.message);
        process.exit(1);
    }
}

function uninstallStartup() {
    try {
        const shortcutPath = path.join(getStartupDir(), 'ZuvelioActivityAgent.bat');
        if (fs.existsSync(shortcutPath)) {
            fs.unlinkSync(shortcutPath);
            console.log('Auto-start removed.');
        } else {
            console.log('No startup entry found.');
        }
    } catch (err) {
        console.error('Failed to remove startup entry:', err.message);
        process.exit(1);
    }
}

// ─── Windows admin check ─────────────────────────────────────────────────────
// uiohook-napi uses WH_KEYBOARD_LL / WH_MOUSE_LL Windows global hooks.
// Without Administrator privileges these hooks are silently blocked by
// Windows security when another process (e.g. Notepad) is in the foreground.
function checkWindowsAdmin() {
    if (process.platform !== 'win32') return;
    const { execSync } = require('child_process');
    try {
        execSync('net session', { stdio: 'ignore', windowsHide: true });
        console.log('Running as Administrator — global hooks will capture all applications.');
    } catch (_) {
        console.error('=========================================================');
        console.error('WARNING: Not running as Administrator!');
        console.error('Global keyboard/mouse hooks CANNOT capture input from');
        console.error('other applications (Notepad, Excel, etc.) without admin.');
        console.error('Please right-click the agent EXE and choose');
        console.error('"Run as administrator" for full monitoring coverage.');
        console.error('=========================================================');

        // Attempt to self-elevate via PowerShell so the user sees a UAC prompt.
        // This only works when launched directly (not via a pipe / service).
        if (process.pkg) {
            // packaged exe — relaunch self with elevation
            try {
                const quoted = process.execPath.replace(/'/g, "''");
                const args = process.argv.slice(2).map(a => `'${a.replace(/'/g, "''")}'`).join(',');
                const argList = args ? `, ArgumentList @(${args})` : '';
                execSync(
                    `powershell -NoProfile -WindowStyle Hidden -Command ` +
                    `"Start-Process '${quoted}'${argList} -Verb RunAs"`,
                    { windowsHide: true },
                );
                console.log('Relaunching as Administrator…');
                process.exit(0);
            } catch (elevErr) {
                // UAC cancelled or unavailable — continue without elevation.
                console.warn('Could not auto-elevate (UAC cancelled?). Continuing without admin.');
                console.warn('Events from other applications may NOT be captured.');
            }
        }
    }
}

if (process.platform === 'win32') checkWindowsAdmin();

// ─── Auth validation ───────────────────────────────────────────────────────────
if (!DEVICE_TOKEN && (!USER_EMAIL || !USER_PASSWORD)) {
    console.error('Missing auth config. Set DEVICE_TOKEN  OR  USER_EMAIL + USER_PASSWORD in .env');
    console.error('');
    console.error('To install auto-start on Windows login, run:');
    console.error('  zuvelio-activity-agent.exe --install');
    process.exit(1);
}

// ─── Agent ─────────────────────────────────────────────────────────────────────
class AgentClient {
    constructor() {
        this.accessToken = null;
        this.refreshToken = null;
        this.eventBuffer = [];
        this.lastMouseMoveAt = 0;
        this.lastActivityAt = Date.now();
        this.isShuttingDown = false;
        this.flushTimer = null;
        this.heartbeatTimer = null;
        this.heldKeysCleanupTimer = null;
        // Prevent simultaneous flush calls from timer + flushIfNeeded
        this.isFlushing = false;
        // Track which keys are currently held down to skip auto-repeat.
        // Uses Map<keycode, pressedAtMs> so stale "stuck" keys (e.g. after
        // Alt+Tab or Ctrl+Tab loses a keyup event) are automatically evicted
        // after 2 seconds — preventing permanent key-ignore bugs.
        this.heldKeys = new Map();
        // Count hook events received — used to detect silent hook failures
        this.hookEventsReceived = 0;
    }

    async start() {
        // Replay any events that were queued to disk during a previous offline
        // session before we try to authenticate — we'll send them after login.
        await this.authenticate();
        await this.printStatus();
        this.registerHooks();
        this.startFlushLoop();
        this.startHeartbeatLoop();
        this.registerShutdownHandlers();
        // Replay queued offline events now that we are online
        await this.replayDiskQueue();
        const identity = DEVICE_TOKEN ? `device token` : USER_EMAIL;
        console.log(`Zuvelio activity agent started (${identity})`);
        console.log(`Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s | Idle threshold ${IDLE_THRESHOLD_MS / 1000}s`);
        console.log(`Tip: run with --install to auto-start on Windows login.`);
    }

    // ── Authentication ──────────────────────────────────────────────────────

    async authenticate() {
        if (DEVICE_TOKEN) {
            await this.loginWithDeviceToken();
        } else {
            await this.loginWithCredentials();
        }
    }

    async loginWithDeviceToken() {
        const response = await fetch(`${API_URL}/activity/agent/token-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceToken: DEVICE_TOKEN }),
        });

        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new Error(`Device token auth failed: ${response.status} ${JSON.stringify(body)}`);
        }

        const body = await response.json();
        this.accessToken = body.accessToken;
        // Device token auth doesn't return a refresh token; re-auth on 401
        this.refreshToken = null;
    }

    async loginWithCredentials() {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
        });

        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new Error(`Login failed: ${response.status} ${JSON.stringify(body)}`);
        }

        const body = await response.json();
        this.accessToken = body.accessToken;
        this.refreshToken = body.refreshToken;
    }

    async refreshAccessToken() {
        if (DEVICE_TOKEN) {
            await this.loginWithDeviceToken();
            return;
        }

        if (!this.refreshToken) {
            await this.loginWithCredentials();
            return;
        }

        const response = await fetch(`${API_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.refreshToken }),
        });

        if (!response.ok) {
            await this.loginWithCredentials();
            return;
        }

        const body = await response.json();
        this.accessToken = body.accessToken;
        this.refreshToken = body.refreshToken;
    }

    // ── Disk queue (offline persistence) ───────────────────────────────────

    /**
     * Persist any in-memory events to disk so they survive a crash or
     * unexpected shutdown.
     */
    persistToDisk(events) {
        if (!events.length) return;
        const existing = readDiskQueue();
        writeDiskQueue([...existing, ...events]);
    }

    /**
     * After a successful authentication, drain the disk queue back to the
     * server in chunks so we don't hit request-size limits.
     */
    async replayDiskQueue() {
        const queued = readDiskQueue();
        if (!queued.length) return;

        console.log(`Replaying ${queued.length} offline-queued events…`);
        const CHUNK = 200;
        let sent = 0;

        for (let i = 0; i < queued.length; i += CHUNK) {
            const chunk = queued.slice(i, i + CHUNK);
            try {
                await this.authorizedRequest('/activity/log-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ events: chunk }),
                });
                sent += chunk.length;
            } catch (err) {
                // Network still down — leave the remaining events on disk and
                // stop replaying for now; they will be retried next startup.
                console.warn(`Offline replay partially failed after ${sent} events:`, err.message);
                writeDiskQueue(queued.slice(i));
                return;
            }
        }

        clearDiskQueue();
        console.log(`Offline replay complete — ${sent} events sent.`);
    }

    // ── I/O hooks ──────────────────────────────────────────────────────────

    async printStatus() {
        try {
            const status = await this.authorizedRequest('/activity/status', { method: 'GET' });
            console.log(
                `Monitoring: ${status.isActive ? 'ACTIVE' : 'INACTIVE'} | working hours ${status.workingHours.start}:00-${status.workingHours.end}:00`,
            );
        } catch (error) {
            console.warn('Unable to fetch monitoring status on startup:', error.message);
        }
    }

    registerHooks() {
        // Surface native hook errors instead of silently dropping them.
        uIOhook.on('error', (err) => {
            console.error('uIOhook native error — global hooks may be inactive:', err && err.message ? err.message : err);
            console.error('Try running the agent as Administrator.');
        });

        uIOhook.on('keydown', (event) => {
            const key = event.keycode;
            if (key === undefined || key === null) return; // guard against bad events
            const now = Date.now();

            // Skip auto-repeat: same key pressed again within 2 seconds = held down.
            // Using a Map (keycode → pressedAtMs) instead of a Set so we can evict
            // "stuck" keys — keys whose keyup event was missed (e.g. after Alt+Tab,
            // Ctrl+Tab, screen lock, or UAC prompt stealing focus).  A key that has
            // been "held" for more than 2 seconds is treated as a fresh press so it
            // is never silently ignored for the rest of the session.
            const pressedAt = this.heldKeys.get(key);
            if (pressedAt !== undefined && now - pressedAt < 2000) return;

            this.heldKeys.set(key, now);

            this.lastActivityAt = now;
            this.hookEventsReceived++;
            this.eventBuffer.push({
                eventType: 'KEYPRESS',
                keyCode: String(key),
                sessionId: SESSION_ID,
                timestamp: new Date().toISOString(),
            });
            this.flushIfNeeded();
        });

        uIOhook.on('keyup', (event) => {
            if (event.keycode !== undefined && event.keycode !== null) {
                this.heldKeys.delete(event.keycode);
            }
        });

        // Periodic cleanup: evict any keys stuck in heldKeys for more than 2 s.
        // This is a safety net in case keyup events are silently dropped by the OS.
        this.heldKeysCleanupTimer = setInterval(() => {
            const cutoff = Date.now() - 2000;
            for (const [key, pressedAt] of this.heldKeys) {
                if (pressedAt < cutoff) this.heldKeys.delete(key);
            }
        }, 3000);

        uIOhook.on('mousedown', (event) => {
            const now = Date.now();
            this.lastActivityAt = now;
            this.hookEventsReceived++;
            this.eventBuffer.push({
                eventType: 'CLICK',
                clickType: this.getClickType(event.button),
                mouseX: event.x,
                mouseY: event.y,
                sessionId: SESSION_ID,
                timestamp: new Date().toISOString(),
            });
            this.flushIfNeeded();
        });

        uIOhook.on('mousemove', (event) => {
            const now = Date.now();
            if (now - this.lastMouseMoveAt < MOUSE_MOVE_SAMPLE_MS) {
                return;
            }

            this.lastMouseMoveAt = now;
            this.lastActivityAt = now;
            this.hookEventsReceived++;
            this.eventBuffer.push({
                eventType: 'MOUSE_MOVE',
                mouseX: event.x,
                mouseY: event.y,
                sessionId: SESSION_ID,
                timestamp: new Date().toISOString(),
            });
            this.flushIfNeeded();
        });

        // Track scroll-wheel activity as MOUSE_MOVE so it counts toward active
        // time even when the user isn't clicking or moving the physical mouse.
        uIOhook.on('wheel', (event) => {
            const now = Date.now();
            // Apply the same 1-second throttle as regular mouse moves.
            if (now - this.lastMouseMoveAt < MOUSE_MOVE_SAMPLE_MS) return;

            this.lastMouseMoveAt = now;
            this.lastActivityAt = now;
            this.hookEventsReceived++;
            this.eventBuffer.push({
                eventType: 'MOUSE_MOVE',
                mouseX: event.x,
                mouseY: event.y,
                sessionId: SESSION_ID,
                timestamp: new Date().toISOString(),
            });
            this.flushIfNeeded();
        });

        try {
            uIOhook.start();
            console.log('Global input hooks started — capturing keyboard/mouse from ALL applications.');
        } catch (err) {
            console.error('CRITICAL: Failed to start global input hooks:', err.message);
            console.error('Keystroke and mouse tracking is DISABLED.');
            console.error('Try running the agent as Administrator.');
            return; // Continue running for heartbeats only
        }

        // Verify hooks are actually firing after 60 seconds (extended from 30s
        // to avoid false positives on slow-starting systems).
        setTimeout(() => {
            if (this.hookEventsReceived === 0) {
                console.warn('=======================================================');
                console.warn('WARNING: No keyboard/mouse events received after 60s.');
                console.warn('Global hooks may be blocked by Windows security.');
                console.warn('SOLUTION: Restart the agent as Administrator.');
                console.warn('If already admin, check Windows Event Log for hook errors.');
                console.warn('=======================================================');
            }
        }, 60000);
    }

    // ── Flush loop (events) ────────────────────────────────────────────────

    startFlushLoop() {
        this.flushTimer = setInterval(async () => {
            // Skip event flush when idle — heartbeat keeps the "online" signal
            // alive separately, so we don't need to send empty batches.
            if (Date.now() - this.lastActivityAt > IDLE_THRESHOLD_MS) {
                return;
            }

            await this.flushEvents();
        }, FLUSH_INTERVAL_MS);
    }

    flushIfNeeded() {
        if (this.eventBuffer.length >= 100) {
            void this.flushEvents();
        }
    }

    async flushEvents() {
        if (!this.eventBuffer.length || this.isShuttingDown || this.isFlushing) {
            return;
        }

        this.isFlushing = true;
        const events = this.eventBuffer.splice(0, this.eventBuffer.length);

        try {
            const result = await this.authorizedRequest('/activity/log-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events }),
            });

            if (!result.success) {
                console.warn('Batch rejected:', result.reason || 'unknown reason');
            }
        } catch (error) {
            console.error('Failed to send activity batch — queuing to disk:', error.message);
            // Put events back in memory buffer first; if we are shutting down
            // they will be flushed to disk in the shutdown handler.
            this.eventBuffer.unshift(...events);
            this.persistToDisk(this.eventBuffer.splice(0, this.eventBuffer.length));
        } finally {
            this.isFlushing = false;
        }
    }

    // ── Heartbeat loop ─────────────────────────────────────────────────────

    /**
     * Send a lightweight ping every HEARTBEAT_INTERVAL_MS so the backend keeps
     * the user showing as "online" even during keyboard/mouse idle periods.
     * The browser session / logout state is irrelevant — this runs at OS level.
     */
    startHeartbeatLoop() {
        this.heartbeatTimer = setInterval(async () => {
            if (this.isShuttingDown) return;
            try {
                await this.authorizedRequest('/activity/agent/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
            } catch (err) {
                // Network blip — not fatal, next heartbeat will retry.
                console.warn('Heartbeat failed (will retry):', err.message);
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    // ── Authorized HTTP ────────────────────────────────────────────────────

    async authorizedRequest(path, options) {
        if (!this.accessToken) {
            await this.authenticate();
        }

        let response = await fetch(`${API_URL}${path}`, {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `Bearer ${this.accessToken}`,
            },
        });

        if (response.status === 401) {
            await this.refreshAccessToken();
            response = await fetch(`${API_URL}${path}`, {
                ...options,
                headers: {
                    ...(options.headers || {}),
                    Authorization: `Bearer ${this.accessToken}`,
                },
            });
        }

        if (!response.ok) {
            const body = await this.safeJson(response);
            throw new Error(`${response.status} ${JSON.stringify(body)}`);
        }

        return this.safeJson(response);
    }

    async safeJson(response) {
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    }

    getClickType(button) {
        if (button === 2) return 'RIGHT';
        if (button === 3) return 'MIDDLE';
        return 'LEFT';
    }

    // ── Shutdown ───────────────────────────────────────────────────────────

    registerShutdownHandlers() {
        const shutdown = async (signal) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            clearInterval(this.flushTimer);
            clearInterval(this.heartbeatTimer);
            clearInterval(this.heldKeysCleanupTimer);
            uIOhook.stop();

            // Flush any remaining in-memory events before exit.
            if (this.eventBuffer.length) {
                try {
                    await this.flushEvents();
                } catch (_) {
                    this.persistToDisk(this.eventBuffer.splice(0));
                }
            }

            // Tell the backend the PC is going offline so status updates
            // immediately rather than waiting for the 5-minute stale timeout.
            try {
                await this.authorizedRequest('/activity/agent/offline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                console.log('Offline signal sent. Goodbye.');
            } catch (err) {
                // Backend unreachable — that is fine; the stale-data timeout
                // will eventually mark the user offline on its own.
                console.warn('Could not send offline signal:', err.message);
            }

            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        // Windows-specific: fired when the session ends (log off / shutdown)
        if (process.platform === 'win32') {
            try {
                // node-windows or raw Windows message pump is not available
                // without native bindings.  We use the SIGTERM-equivalent that
                // Node.js maps from the Windows console control events.
                process.on('SIGHUP', () => shutdown('SIGHUP'));
            } catch (_) { /* not all Windows environments support SIGHUP */ }
        }
    }
}

void new AgentClient().start().catch((error) => {
    console.error('Desktop agent failed to start:', error.message);
    process.exit(1);
});

