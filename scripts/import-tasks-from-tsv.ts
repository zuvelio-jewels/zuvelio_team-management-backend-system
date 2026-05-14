/**
 * Import Daily Tasks from Tab-Separated (Excel export) file into PostgreSQL
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/import-tasks-from-tsv.ts <path-to-file>
 *
 * Example:
 *   npx ts-node -r tsconfig-paths/register scripts/import-tasks-from-tsv.ts "C:\Users\Admin\Documents\102Data.txt"
 *
 * Columns in TSV (0-indexed):
 *   0  - Task ID
 *   1  - Created DateTime (e.g. "01-May, 11:15")
 *   2  - Cabin
 *   3  - Assigned To (employee name)
 *   4  - Allotted From (name)
 *   5  - Task Detail
 *   6  - Complete By (Today / Tomorrow / Within 3 Days / Within 7 Days)
 *   7  - Is Present (Present / Absent)
 *   8  - Deadline date (e.g. "02-May")
 *   9  - Updated At (e.g. "30-Apr, 17:52")
 *   10 - Person Status (Done / etc.)
 *   11 - Note / Remark
 *   12 - Alert (Complete in Time / Late Complete with Time-Out / etc.)
 *   13 - QC Check (Done / Issue / empty)
 *   14 - Extra remark
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Allow overriding DATABASE_URL via command line: --db-url "postgres://..."
const dbUrlArgIndex = process.argv.indexOf('--db-url');
if (dbUrlArgIndex !== -1 && process.argv[dbUrlArgIndex + 1]) {
    process.env.DATABASE_URL = process.argv[dbUrlArgIndex + 1];
    console.log('🔗 Using custom DATABASE_URL from --db-url argument');
}
console.log(`📡 Connecting to: ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

// ── Date Helpers ─────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse "01-May, 11:15" or "01-May, 11:15" → Date (year auto-detected as 2026)
 */
function parseDateTime(raw: string, year = 2026): Date | null {
    if (!raw || raw.trim() === '') return null;
    raw = raw.trim();
    // Format: "01-May, 11:15"
    const match = raw.match(/^(\d{1,2})-([A-Za-z]{3}),?\s+(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = MONTH_MAP[match[2]];
    const hours = parseInt(match[3], 10);
    const minutes = parseInt(match[4], 10);
    if (month === undefined) return null;
    return new Date(year, month, day, hours, minutes, 0, 0);
}

/**
 * Parse "02-May" → Date at end of day (23:59:59)
 */
function parseDate(raw: string, year = 2026): Date | null {
    if (!raw || raw.trim() === '') return null;
    raw = raw.trim();
    const match = raw.match(/^(\d{1,2})-([A-Za-z]{3})$/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = MONTH_MAP[match[2]];
    if (month === undefined) return null;
    return new Date(year, month, day, 23, 59, 59, 999);
}

// ── Field Mappers ─────────────────────────────────────────────────────────────

function mapCompleteBy(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (v === 'today') return 'TODAY';
    if (v === 'tomorrow') return 'TOMORROW';
    if (v === 'within 3 days') return 'WITHIN_3_DAYS';
    if (v === 'within 7 days') return 'WITHIN_7_DAYS';
    return 'TODAY'; // default
}

function mapPersonStatus(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (v === 'done') return 'DONE';
    if (v === 'in progress') return 'IN_PROGRESS';
    return 'NOT_STARTED';
}

function mapAlert(raw: string): string | null {
    const v = raw.trim().toLowerCase();
    if (v === 'complete in time') return 'COMPLETE_IN_TIME';
    if (v.startsWith('late complete')) return 'LATE_COMPLETE_WITH_TIMEOUT';
    if (v === 're work' || v === 'rework') return 'RE_WORK';
    if (v === 'not start yet in time') return 'NOT_START_YET';
    if (v === '' || v === '#value!') return null;
    return raw.trim() || null;
}

function mapQcCheck(raw: string): string | null {
    const v = raw.trim().toLowerCase();
    if (v === 'done') return 'DONE';
    if (v === 'issue') return 'ISSUE';
    return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: npx ts-node ... scripts/import-tasks-from-tsv.ts <path-to-file>');
        process.exit(1);
    }

    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');

    console.log(`\n📂 File: ${absolutePath}`);
    console.log(`📋 Total rows: ${lines.length}\n`);

    // ── Load all users into a name→id map ──
    const allUsers = await prisma.user.findMany({ select: { id: true, name: true } });
    const userByName = new Map<string, number>();
    for (const u of allUsers) {
        userByName.set(u.name.trim().toLowerCase(), u.id);
    }
    console.log(`👤 Users loaded from DB: ${allUsers.length}`);
    const unmatchedNames = new Set<string>();

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length < 6) { skipped++; continue; }

        const rawId = cols[0]?.trim();
        const rawCreated = cols[1]?.trim() ?? '';
        const cabin = cols[2]?.trim() ?? '';
        const assignedName = cols[3]?.trim() ?? '';
        const allottedName = cols[4]?.trim() ?? '';
        const taskDetail = cols[5]?.trim() ?? '';
        const rawCompleteBy = cols[6]?.trim() ?? 'Today';
        const rawIsPresent = cols[7]?.trim() ?? 'Present';
        const rawDeadline = cols[8]?.trim() ?? '';
        const rawUpdatedAt = cols[9]?.trim() ?? '';
        const rawStatus = cols[10]?.trim() ?? '';
        const note = cols[11]?.trim() || null;
        const rawAlert = cols[12]?.trim() ?? '';
        const rawQcCheck = cols[13]?.trim() ?? '';
        const remark = cols[14]?.trim() || null;

        if (!taskDetail) { skipped++; continue; }

        const taskId = rawId ? parseInt(rawId, 10) : undefined;
        const createdAt = parseDateTime(rawCreated) ?? new Date();
        const deadline = parseDate(rawDeadline) ?? undefined;
        const updatedBy = parseDateTime(rawUpdatedAt) ?? undefined;
        const completeBy = mapCompleteBy(rawCompleteBy);
        const personStatus = mapPersonStatus(rawStatus);
        const isPresent = rawIsPresent.toLowerCase() !== 'absent';
        const alert = mapAlert(rawAlert);
        const qcCheck = mapQcCheck(rawQcCheck);

        // Lookup user IDs by name
        const assignedToId = userByName.get(assignedName.toLowerCase()) ?? null;
        const allottedFromId = userByName.get(allottedName.toLowerCase()) ?? null;

        if (assignedName && !assignedToId) unmatchedNames.add(assignedName);
        if (allottedName && !allottedFromId) unmatchedNames.add(allottedName);

        try {
            // Use upsert so re-running the script doesn't duplicate
            await prisma.task.upsert({
                where: { id: taskId ?? -1 },
                update: {
                    cabin,
                    taskDetail,
                    title: taskDetail.substring(0, 100),
                    completeBy,
                    deadline,
                    personStatus,
                    note,
                    alert,
                    qcCheck,
                    remark,
                    isPresent,
                    updatedBy,
                    assignedToId,
                    allottedFromId,
                    createdAt,
                },
                create: {
                    ...(taskId ? { id: taskId } : {}),
                    cabin,
                    taskDetail,
                    title: taskDetail.substring(0, 100),
                    completeBy,
                    deadline,
                    personStatus,
                    note,
                    alert,
                    qcCheck,
                    remark,
                    isPresent,
                    updatedBy,
                    assignedToId,
                    allottedFromId,
                    createdAt,
                },
            });
            created++;
            if (created % 20 === 0) console.log(`  ✓ ${created} tasks imported...`);
        } catch (e: any) {
            console.error(`  ✗ Error on row (ID ${rawId}): ${e.message}`);
            errors++;
        }
    }

    console.log('\n─────────────────────────────');
    console.log(`✅ Imported : ${created}`);
    console.log(`⏭️  Skipped  : ${skipped}`);
    console.log(`❌ Errors   : ${errors}`);

    if (unmatchedNames.size > 0) {
        console.log('\n⚠️  These names were NOT found in the Users table (tasks saved without user link):');
        for (const n of unmatchedNames) {
            console.log(`   - "${n}"`);
        }
        console.log('\n   👉 Make sure these employees are registered in the system.');
    }

    console.log('\nDone!\n');
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
