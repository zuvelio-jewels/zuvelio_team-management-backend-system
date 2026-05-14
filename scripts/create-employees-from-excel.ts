/**
 * Creates missing employees in DB from the Excel task data.
 * Employees are created with:
 *   - email: firstname.lastname@zuvelio.com (lowercase, spaces replaced by dots)
 *   - password: Zuvelio@123 (bcrypt hashed)
 *   - role: EMPLOYEE
 *   - isActive: true, isApproved: true
 *   - isAssignable: true
 *
 * After running this, run import-tasks-from-tsv.ts again to re-link tasks.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/create-employees-from-excel.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

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

// All unique names from the Excel file that are NOT already in the DB
const EMPLOYEES_TO_CREATE = [
    'Jitender Soni',
    'Dinesh Bunkar',
    'Divya Nankani',
    'Kanhaiya Lal',
    'Rashmi Shrimal',
    'Priyanshi Rawat',
    'Chetna Sharma',
    'Ram Sharma',
    'Sneha Jain',
    'Kishan Sain',
    'Sanjeev Kumar',
    'Monika Mahena',
    'Pratibha Jaiswal',
    'Priyanka Saraf',
    'Lokesh Bairwa',
    'Deepak Prajapt',
];

const DEFAULT_PASSWORD = 'Zuvelio@123';

function nameToEmail(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '.') + '@zuvelio.com';
}

async function main() {
    console.log('\n👤 Creating missing employees...\n');

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    // Load existing users to avoid duplicates
    const existing = await prisma.user.findMany({ select: { name: true, email: true } });
    const existingNames = new Set(existing.map((u) => u.name.trim().toLowerCase()));
    const existingEmails = new Set(existing.map((u) => u.email.trim().toLowerCase()));

    let created = 0;
    let skipped = 0;

    for (const name of EMPLOYEES_TO_CREATE) {
        if (existingNames.has(name.toLowerCase())) {
            console.log(`  ⏭️  Already exists: ${name}`);
            skipped++;
            continue;
        }

        let email = nameToEmail(name);
        // If email conflicts, add a suffix
        let suffix = 1;
        while (existingEmails.has(email)) {
            email = nameToEmail(name).replace('@', `${suffix}@`);
            suffix++;
        }

        try {
            await prisma.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'EMPLOYEE',
                    isActive: true,
                    isApproved: true,
                    isAssignable: true,
                },
            });
            existingEmails.add(email);
            console.log(`  ✅ Created: ${name} → ${email}`);
            created++;
        } catch (e: any) {
            console.error(`  ❌ Failed: ${name} — ${e.message}`);
        }
    }

    console.log('\n─────────────────────────────');
    console.log(`✅ Created : ${created}`);
    console.log(`⏭️  Skipped : ${skipped}`);
    console.log(`\n🔑 Default password for all new employees: ${DEFAULT_PASSWORD}`);
    console.log('   👉 Ask employees to change their password after first login.\n');
    console.log('Now run the import script again to link tasks to these employees:');
    console.log('   npx ts-node -r tsconfig-paths/register scripts/import-tasks-from-tsv.ts "C:\\Users\\Admin\\Documents\\102Data.txt"\n');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
