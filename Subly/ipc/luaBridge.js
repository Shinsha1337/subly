// Subly — Lua bridge (Node port of resolve_bridge.py)
//
// The WorkflowIntegration.node bridge cannot reliably reach tool-level Fusion
// scripting (tool:SetInput on Text+/AutoSubs), so the Fusion-text operations go
// through the original Lua bridge instead. We spawn fuscript.exe running
// subly_bridge_launcher.lua, which starts local HTTP JSON-RPC workers on
// 127.0.0.1. Normal Resolve actions use the primary worker; realtime Text+
// preview uses a tiny worker pool so slider updates are not stuck behind stale
// preview requests.
//
// Lifecycle: the process is started lazily on first Fusion call and kept warm
// during realtime preview (idle timer). It is killed immediately after one-shot
// operations (Create Captions) and on window close — so fuscript only runs while
// text is actively being worked on.

const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const HOST = '127.0.0.1';
const PRIMARY_PORT = 56003;
const PREVIEW_PORTS = [56004, 56005];
const LAUNCHER = 'subly_bridge_launcher.lua';
const LUA_DIR = path.join(__dirname, '..', 'lua');
const LAUNCHER_PATH = path.join(LUA_DIR, LAUNCHER);
const IDLE_MS = 5000;          // keep-warm window after the last realtime call
const PREVIEW_IDLE_MS = 4000;  // live-preview workers are cheaper to release
const PREVIEW_MIN_INTERVAL_MS = 33;
const START_TIMEOUT_MS = 8000; // cold fuscript start can be slow
const FAIL_COOLDOWN_MS = 4000; // after a failed start, skip retries this long
const FUSCRIPT_NAME = process.platform === 'win32' ? 'fuscript.exe' : 'fuscript';
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024; // cap a runaway bridge response

// Per-launch shared secret. Passed to fuscript via the SUBLY_TOKEN env var and
// required on every RPC (X-Subly-Token header) so no other local process — and
// no web page (a custom header forces a CORS preflight the server denies) — can
// drive the unauthenticated 127.0.0.1 bridge.
const AUTH_TOKEN = crypto.randomBytes(24).toString('hex');

let fuscriptPath = null; // cached

function createWorker(port, { cleanupBeforeStart = false } = {}) {
    return {
        port,
        child: null,
        starting: null,     // in-flight ensureWorker promise (dedupes rapid ticks)
        idleTimer: null,
        lastFail: null,     // { at, result } — caches a recent startup failure
        opQueue: Promise.resolve(),
        busy: false,
        cleanupBeforeStart
    };
}

const primaryWorker = createWorker(PRIMARY_PORT, { cleanupBeforeStart: true });
const previewWorkers = PREVIEW_PORTS.map(port => createWorker(port));

// ------------------------------------------------------------------ discovery

function fuscriptCandidates() {
    if (process.platform === 'darwin') {
        return [
            '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript',
            '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Resources/fuscript',
            '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/MacOS/fuscript'
        ];
    }
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    return [
        path.join(pf, 'Blackmagic Design', 'DaVinci Resolve', 'fuscript.exe'),
        path.join(pf, 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'fuscript.exe'),
        path.join(pfx86, 'Blackmagic Design', 'DaVinci Resolve', 'fuscript.exe')
    ];
}

function findFuscript() {
    if (fuscriptPath && fs.existsSync(fuscriptPath)) return fuscriptPath;
    for (const c of fuscriptCandidates()) {
        try { if (c && fs.existsSync(c)) { fuscriptPath = c; return c; } } catch { /* */ }
    }
    return null;
}

// ------------------------------------------------------------------ HTTP

function rpc(port, func, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ ...(payload || {}), func }), 'utf-8');
        const req = http.request({
            host: HOST,
            port,
            method: 'POST',
            path: '/',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': body.length,
                'Connection': 'close',
                'X-Subly-Token': AUTH_TOKEN
            }
        }, (res) => {
            const chunks = [];
            let total = 0;
            res.on('data', (d) => {
                total += d.length;
                if (total > MAX_RESPONSE_BYTES) { req.destroy(new Error('Lua bridge response too large')); return; }
                chunks.push(d);
            });
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                if (!raw) return resolve({});
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(new Error('Invalid JSON from Lua bridge: ' + e.message)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs || 10000, () => req.destroy(new Error('timeout')));
        req.end(body);
    });
}

async function isAlive(worker, timeoutMs = 500) {
    try {
        const r = await rpc(worker.port, 'Ping', null, timeoutMs);
        return !!(r && !r.error);
    } catch { return false; }
}

// ------------------------------------------------------------------ lifecycle

function clearIdle(worker) {
    if (worker.idleTimer) { clearTimeout(worker.idleTimer); worker.idleTimer = null; }
}

// Reset the keep-warm window. After IDLE_MS with no realtime call, shut down —
// enqueued so the idle-kill can't fire in the middle of a queued operation.
function touchIdle(worker, idleMs = IDLE_MS) {
    clearIdle(worker);
    worker.idleTimer = setTimeout(() => {
        worker.opQueue = worker.opQueue.then(() => killWorker(worker)).catch(() => {});
    }, idleMs);
}

function spawnFuscript(worker) {
    const exe = findFuscript();
    if (!exe) return { error: `${FUSCRIPT_NAME} not found`, detail: 'DaVinci Resolve installation not found in the standard location.' };
    if (!fs.existsSync(LAUNCHER_PATH)) return { error: 'Lua bridge missing', detail: `Launcher not found: ${LAUNCHER_PATH}` };
    try {
        const launched = spawn(exe, [LAUNCHER_PATH], {
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, SUBLY_TOKEN: AUTH_TOKEN, SUBLY_PORT: String(worker.port) }
        });
        worker.child = launched;
        launched.on('exit', () => { if (worker.child === launched) worker.child = null; });
        launched.on('error', () => { if (worker.child === launched) worker.child = null; });
        return { ok: true };
    } catch (e) {
        worker.child = null;
        return { error: 'Failed to start Lua bridge', detail: String(e) };
    }
}

// Ensure the Lua HTTP server is up. Returns { ok } or { error, detail }.
async function ensureWorker(worker) {
    if (await isAlive(worker, 400)) return { ok: true };
    if (worker.starting) return worker.starting;

    // Don't hammer fuscript/PowerShell on every realtime tick after a failure.
    if (worker.lastFail && (Date.now() - worker.lastFail.at) < FAIL_COOLDOWN_MS) return worker.lastFail.result;

    worker.starting = (async () => {
        if (worker.cleanupBeforeStart) await cleanupOrphans();
        const spawned = spawnFuscript(worker);
        if (spawned.error) return spawned;

        const deadline = Date.now() + START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 200));
            if (await isAlive(worker, 400)) return { ok: true };
            if (!worker.child) break; // process died during startup
        }
        return { error: 'Lua bridge did not start', detail: `${FUSCRIPT_NAME} started but the bridge server never came up on port ${worker.port}. Make sure a project and timeline are open in DaVinci Resolve.` };
    })();

    try {
        const result = await worker.starting;
        worker.lastFail = result.ok ? null : { at: Date.now(), result };
        return result;
    } finally {
        worker.starting = null;
    }
}

function ensureServer() {
    return ensureWorker(primaryWorker);
}

function cleanupOrphans() {
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            const ps = [
                "Get-CimInstance Win32_Process -Filter \"name = 'fuscript.exe'\" | ",
                `Where-Object { $_.CommandLine -like '*${LAUNCHER}*' } | `,
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
            ].join('');
            try {
                execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 3000 }, () => resolve());
            } catch { resolve(); }
        });
    }
    // macOS/Linux: match the launcher filename so only Subly's fuscript is reaped.
    return new Promise((resolve) => {
        try {
            execFile('/usr/bin/pkill', ['-f', LAUNCHER], { timeout: 3000 }, () => resolve());
        } catch { resolve(); }
    });
}

// Tell one worker to exit, then make sure its process is gone.
async function killWorker(worker) {
    clearIdle(worker);
    try { await rpc(worker.port, 'Exit', null, 1000); } catch { /* server may already be down */ }
    if (worker.child) {
        try { worker.child.kill(); } catch { /* */ }
        worker.child = null;
    }
    worker.busy = false;
    return true;
}

async function killServer() {
    const workers = [primaryWorker, ...previewWorkers];
    await Promise.all(workers.map(worker => killWorker(worker).catch(() => {})));
    await cleanupOrphans();
    return true;
}

// ------------------------------------------------------------------ public call
//
// keepWarm=true  → reset idle timer, leave the process running (realtime).
// keepWarm=false → kill the process right after the call returns (one-shot).

async function callImpl(worker, func, payload, { timeout = 30000, keepWarm = false, idleMs = IDLE_MS } = {}) {
    // Cancel any pending idle-kill from a previous keep-warm (preview) call, so
    // it can't fire mid-request and sever a long one-shot like Apply (ECONNRESET).
    clearIdle(worker);
    const up = await ensureWorker(worker);
    if (up.error) return up;
    let result;
    try {
        result = await rpc(worker.port, func, payload, timeout);
    } catch (e) {
        if (!keepWarm) await killWorker(worker);
        return { error: 'Lua bridge call failed', detail: String(e.message || e) };
    }
    if (keepWarm) touchIdle(worker, idleMs);
    else await killWorker(worker);
    return result;
}

// Run one normal bridge operation at a time. Preview uses callPreviewLatest()
// below, so heavy one-shots cannot build a stale slider-update backlog.
function call(func, payload, opts) {
    const run = () => callImpl(primaryWorker, func, payload, opts || {});
    const next = primaryWorker.opQueue.then(run, run);
    primaryWorker.opQueue = next.catch(() => {});
    return next;
}

let previewSeq = 0;
let previewPending = null;
let previewLatest = null;
let previewPumpTimer = null;
let previewLastDispatchAt = 0;
let previewWorkerIndex = 0;
const previewInFlightSeqs = new Set();

function nextPreviewWorker() {
    for (let i = 0; i < previewWorkers.length; i++) {
        const idx = (previewWorkerIndex + i) % previewWorkers.length;
        const worker = previewWorkers[idx];
        if (!worker.busy) {
            previewWorkerIndex = (idx + 1) % previewWorkers.length;
            return worker;
        }
    }
    return null;
}

function queuePreviewPump(delayMs = 0) {
    if (previewPumpTimer) return;
    previewPumpTimer = setTimeout(() => {
        previewPumpTimer = null;
        pumpPreview();
    }, delayMs);
}

function pumpPreview() {
    if (!previewPending) return;
    const worker = nextPreviewWorker();
    if (!worker) return;

    const wait = PREVIEW_MIN_INTERVAL_MS - (Date.now() - previewLastDispatchAt);
    if (wait > 0) {
        queuePreviewPump(wait);
        return;
    }

    const job = previewPending;
    previewPending = null;
    worker.busy = true;
    previewInFlightSeqs.add(job.seq);
    previewLastDispatchAt = Date.now();

    callImpl(worker, job.func, job.payload, {
        ...(job.opts || {}),
        keepWarm: true,
        idleMs: PREVIEW_IDLE_MS
    }).then(
        result => job.resolve(result),
        error => job.resolve({ error: 'Lua bridge call failed', detail: String(error.message || error) })
    ).finally(() => {
        worker.busy = false;
        previewInFlightSeqs.delete(job.seq);
        if (previewLatest && job.seq < previewLatest.seq && !previewPending && !previewInFlightSeqs.has(previewLatest.seq)) {
            previewPending = { ...previewLatest, resolve: () => {} };
        }
        pumpPreview();
    });
}

function callPreviewLatest(func, payload, opts) {
    return new Promise((resolve) => {
        if (previewPending) previewPending.resolve({ ok: true, superseded: true });
        const seq = ++previewSeq;
        previewLatest = { seq, func, payload, opts: opts || {} };
        previewPending = { ...previewLatest, resolve };
        pumpPreview();
    });
}

async function diagnose() {
    const exe = findFuscript();
    const steps = [];
    steps.push(FUSCRIPT_NAME + ': ' + (exe || 'NOT FOUND'));
    steps.push('launcher: ' + (fs.existsSync(LAUNCHER_PATH) ? LAUNCHER_PATH : 'MISSING ' + LAUNCHER_PATH));
    if (!exe) return { ok: false, report: steps.join('\n') };
    const up = await ensureServer();
    steps.push('bridge server: ' + (up.ok ? 'up' : 'FAILED — ' + (up.detail || up.error)));
    if (up.ok) {
        try {
            const r = await rpc(primaryWorker.port, 'Connect', null, 2000);
            steps.push('Connect: ' + (r && r.ok ? ('ok — ' + (r.name || '')) : ('error — ' + (r && (r.detail || r.error)))));
        } catch (e) { steps.push('Connect: THREW ' + e.message); }
    }
    await killServer();
    return { ok: true, report: steps.join('\n') };
}

module.exports = { call, callPreviewLatest, ensureServer, killServer, diagnose };
