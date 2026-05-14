/**
 * Import Daily Tasks from TSV file directly into PRODUCTION via REST API.
 * No DATABASE_URL needed — uses admin login token.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/import-tasks-via-api.ts "C:\Users\Admin\Documents\102Data.txt"
 *
 * Optional flags:
 *   --api-url  "https://your-api.railway.app/api"   (default: Railway production)
 *   --email    "admin@zuvelio.com"
 *   --password "Admin@123"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as dotenv from 'dotenv';

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────
const API_URL = getArg('--api-url') ?? 'https://zuvelioteam-management-backend-system-production.up.railway.app/api';
const EMAIL = getArg('--email') ?? 'admin@zuvelio.com';
const PASSWORD = getArg('--password') ?? 'Admin@123';
const FILE_PATH = process.argv[2]?.startsWith('--') ? undefined : process.argv[2];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getArg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
}

function apiRequest<T>(method: string, endpoint: string, body?: object, token?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const url = new URL(API_URL + endpoint);
        const bodyStr = body ? JSON.stringify(body) : undefined;
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        };
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
                    } else {
                        resolve(parsed as T);
                    }
                } catch {
                    reject(new Error(`Parse error: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Date / Field Mappers ──────────────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

function parseDateTime(raw: string, year = 2026): string | null {
    if (!raw?.trim()) return null;
    const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3}),?\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const mo = MONTH_MAP[m[2]];
    if (mo === undefined) return null;
    const d = new Date(year, mo, +m[1], +m[3], +m[4]);
    return d.toISOString();
}

function mapCompleteBy(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (v === 'today') return 'TODAY';
    if (v === 'tomorrow') return 'TOMORROW';
    if (v === 'within 3 days') return 'WITHIN_3_DAYS';
    if (v === 'within 7 days') return 'WITHIN_7_DAYS';
    return 'TODAY';
}

function mapPersonStatus(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (v === 'done') return 'DONE';
    if (v === 'in progress') return 'IN_PROGRESS';
    return 'NOT_STARTED';
}

function mapQcCheck(raw: string): string | undefined {
    const v = raw.trim().toLowerCase();
    if (v === 'done') return 'DONE';
    if (v === 'issue') return 'ISSUE';
    return undefined;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    if (!FILE_PATH) {
        console.error('Usage: npx ts-node ... scripts/import-tasks-via-api.ts <path-to-file>');
        process.exit(1);
    }
    const absPath = path.resolve(FILE_PATH);
    if (!fs.existsSync(absPath)) { console.error(`File not found: ${absPath}`); process.exit(1); }

    console.log(`\n🌐 API: ${API_URL}`);
    console.log(`📂 File: ${absPath}\n`);

    // 1. Login
    console.log(`🔐 Logging in as ${EMAIL}...`);
    const loginRes = await apiRequest<{ accessToken: string }>('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
    const token = loginRes.accessToken;
    console.log('✅ Logged in\n');

    // 2. Load all users → name map (with fuzzy aliases for production name variants)
    const users = await apiRequest<{ id: number; name: string }[]>('GET', '/users', undefined, token);
    const userByName = new Map<string, number>();
    for (const u of users) userByName.set(u.name.trim().toLowerCase(), u.id);

    // Manual aliases: Excel name → production name (for mismatches)
    const ALIASES: Record<string, string> = {
        'kanhaiya lal': 'kanhaiya lal jangid',
        'deepak prajapt': 'deepak kumar prajapat',
        'deepak prajapat': 'deepak kumar prajapat',
        'sanjeev kumar': 'sanjeev kumar (sanju )',
        'vishal saini': 'vishal saini',
        'ram sharma': 'ram sharma',
    };
    // Also add partial-match fallback for deepak
    for (const u of users) {
        if (u.name.toLowerCase().includes('deepak') && u.name.toLowerCase().includes('prajap')) {
            userByName.set('deepak prajapt', u.id);
            userByName.set('deepak prajapat', u.id);
        }
    }
    for (const [alias, real] of Object.entries(ALIASES)) {
        const id = userByName.get(real.toLowerCase());
        if (id && !userByName.has(alias)) userByName.set(alias, id);
    }
    console.log(`👤 Users in production DB: ${users.length}`);

    // 3. Parse TSV
    const lines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/).filter(l => l.trim());
    console.log(`📋 Rows in file: ${lines.length}\n`);

    const unmatchedNames = new Set<string>();
    let created = 0, skipped = 0, errors = 0;

    for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length < 6) { skipped++; continue; }

        // normalize: replace non-breaking spaces (U+00A0) with regular spaces
        const normalize = (s: string) => s.replace(/\u00a0/g, ' ').trim();

        const assignedName = normalize(cols[3] ?? '');
        const allottedName = normalize(cols[4] ?? '');
        const taskDetail = cols[5]?.trim() ?? '';
        const rawCompleteBy = cols[6]?.trim() ?? 'Today';
        const rawStatus = cols[10]?.trim() ?? '';
        const note = cols[11]?.trim() || undefined;
        const rawQcCheck = cols[13]?.trim() ?? '';
        const remark = cols[14]?.trim() || undefined;
        const rawUpdatedAt = cols[9]?.trim() ?? '';

        if (!taskDetail) { skipped++; continue; }

        const assignedToId = userByName.get(assignedName.toLowerCase());
        const allottedFromId = userByName.get(allottedName.toLowerCase());

        if (assignedName && !assignedToId) unmatchedNames.add(assignedName);
        if (!assignedToId) { skipped++; continue; } // cannot create task without assignedToId

        const completeBy = mapCompleteBy(rawCompleteBy);
        const personStatus = mapPersonStatus(rawStatus);
        const qcCheck = mapQcCheck(rawQcCheck);

        try {
            // Create task
            const created_task = await apiRequest<{ id: number }>('POST', '/tasks', {
                title: taskDetail.substring(0, 100),
                cabin: normalize(cols[2] ?? '') || 'N/A',
                taskDetail,
                completeBy,
                assignedToId,
                note,
            }, token);

            // Update with status, qcCheck, remark (PATCH)
            const patchBody: any = { personStatus };
            if (qcCheck) patchBody.qcCheck = qcCheck;
            if (remark) patchBody.remark = remark;

            await apiRequest('PATCH', `/tasks/${created_task.id}`, patchBody, token);

            created++;
            if (created % 10 === 0) console.log(`  ✓ ${created} tasks imported...`);
            await sleep(50); // avoid rate limiting
        } catch (e: any) {
            console.error(`  ✗ Error (${assignedName} / ${taskDetail.substring(0, 40)}): ${e.message}`);
            errors++;
        }
    }

    console.log('\n─────────────────────────────');
    console.log(`✅ Imported : ${created}`);
    console.log(`⏭️  Skipped  : ${skipped}`);
    console.log(`❌ Errors   : ${errors}`);

    if (unmatchedNames.size > 0) {
        console.log('\n⚠️  Names not found in production users (tasks skipped for these):');
        for (const n of unmatchedNames) console.log(`   - "${n}"`);
        console.log('\n   👉 First create these employees in production, then re-run.');
    }
    console.log('\nDone!\n');
}

main().catch(e => { console.error(e); process.exit(1); });
