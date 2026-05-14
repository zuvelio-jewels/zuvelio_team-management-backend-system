/**
 * Query tasks from DB by person name (assignedTo or allottedFrom)
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/query-tasks-by-person.ts "Dinesh"
 *   npx ts-node -r tsconfig-paths/register scripts/query-tasks-by-person.ts "Kishan"
 *   npx ts-node -r tsconfig-paths/register scripts/query-tasks-by-person.ts  (shows all)
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
    const search = process.argv[2] ?? '';

    const where: any = search ? {
        OR: [
            { assignedTo: { name: { contains: search, mode: 'insensitive' } } },
            { allottedFrom: { name: { contains: search, mode: 'insensitive' } } },
        ],
    } : {};

    const tasks = await prisma.task.findMany({
        where,
        select: {
            id: true,
            cabin: true,
            taskDetail: true,
            personStatus: true,
            completeBy: true,
            alert: true,
            qcCheck: true,
            createdAt: true,
            assignedTo: { select: { name: true } },
            allottedFrom: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    console.log(`\n🔍 Search: "${search || 'ALL'}"`);
    console.log(`📋 Total tasks found: ${tasks.length}\n`);

    const pad = (s: string | undefined | null, len: number) =>
        (s ?? '').substring(0, len).padEnd(len);

    console.log(
        pad('#ID', 6) +
        pad('AssignedTo', 18) +
        pad('AllottedFrom', 18) +
        pad('Cabin', 7) +
        pad('Status', 13) +
        pad('Alert', 26) +
        pad('QC', 7) +
        'Task'
    );
    console.log('─'.repeat(140));

    for (const t of tasks) {
        console.log(
            pad(String(t.id), 6) +
            pad(t.assignedTo?.name, 18) +
            pad(t.allottedFrom?.name, 18) +
            pad(t.cabin, 7) +
            pad(t.personStatus, 13) +
            pad(t.alert ?? '', 26) +
            pad(t.qcCheck ?? '', 7) +
            (t.taskDetail ?? '').substring(0, 60)
        );
    }
    console.log('\n');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
