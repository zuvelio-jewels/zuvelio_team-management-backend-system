import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
    console.log('=== USER STATUS REPORT ===\n');

    // Get all users
    const allUsers = await prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            isApproved: true,
            isActive: true,
            role: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
    });

    console.log(`Total users: ${allUsers.length}\n`);

    // Group by status
    const pending = allUsers.filter(u => !u.isApproved && !u.isActive);
    const approved = allUsers.filter(u => u.isApproved && u.isActive);
    const inactive = allUsers.filter(u => u.isApproved && !u.isActive);

    console.log(`📋 PENDING APPROVAL (${pending.length}):`);
    if (pending.length === 0) {
        console.log('   None - All users are approved!');
    } else {
        pending.forEach(u => {
            console.log(`   - ${u.name} (${u.email}) - ${u.role}`);
        });
    }

    console.log(`\n✅ APPROVED & ACTIVE (${approved.length}):`);
    if (approved.length === 0) {
        console.log('   None');
    } else {
        approved.forEach(u => {
            console.log(`   - ${u.name} (${u.email}) - ${u.role}`);
        });
    }

    console.log(`\n⏸️ APPROVED BUT INACTIVE (${inactive.length}):`);
    if (inactive.length === 0) {
        console.log('   None');
    } else {
        inactive.forEach(u => {
            console.log(`   - ${u.name} (${u.email}) - ${u.role}`);
        });
    }

    console.log('\n=== END OF REPORT ===');
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error('Error:', e);
        prisma.$disconnect();
        process.exit(1);
    });
