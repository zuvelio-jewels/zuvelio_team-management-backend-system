import { PrismaClient } from '@prisma/client';
import { Role } from '@prisma/client';

const prisma = new PrismaClient();

async function approveAllPendingUsers() {
    try {
        console.log('Starting to approve all pending users...');

        // Get pending users (not approved, not active)
        const pendingUsers = await prisma.user.findMany({
            where: {
                isApproved: false,
                isActive: false,
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

        // Approve all pending users as EMPLOYEE by default
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

        console.log(`\n✅ Successfully approved ${result.count} users!`);
        console.log('All pending users are now active and can login.');

    } catch (error) {
        console.error('Error approving users:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

approveAllPendingUsers();
