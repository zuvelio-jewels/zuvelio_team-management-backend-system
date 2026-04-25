import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Role } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
    // Get pending users first
    const pendingUsers = await prisma.user.findMany({
        where: {
            isApproved: false,
            isActive: false,
        },
        select: {
            id: true,
            name: true,
            email: true,
        },
    });

    console.log(`Found ${pendingUsers.length} pending users:`);
    pendingUsers.forEach((user) => {
        console.log(`  - ${user.name} (${user.email})`);
    });

    if (pendingUsers.length === 0) {
        console.log('No pending users to approve.');
        return;
    }

    // Approve all pending users
    const result = await prisma.user.updateMany({
        where: {
            isApproved: false,
            isActive: false,
        },
        data: {
            isApproved: true,
            isActive: true,
            role: Role.EMPLOYEE,
        },
    });

    console.log(`\n✅ Successfully approved ${result.count} pending users!`);
    console.log('All pending users are now active and can login.');

    // Also approve any already active users that aren't marked as approved
    const activeResult = await prisma.user.updateMany({
        where: {
            isActive: true,
            isApproved: false,
        },
        data: {
            isApproved: true,
        },
    });

    if (activeResult.count > 0) {
        console.log(`✅ Also approved ${activeResult.count} active users.`);
    }
}

main()
    .then(() => {
        console.log('\n✨ Approval process completed!');
        prisma.$disconnect();
    })
    .catch((e) => {
        console.error('Error:', e);
        prisma.$disconnect();
        process.exit(1);
    });

