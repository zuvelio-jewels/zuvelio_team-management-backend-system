import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const databaseUrl = new URL(process.env.DATABASE_URL!);
const adapter = new PrismaPg(databaseUrl.toString());
const prisma = new PrismaClient({ adapter });

async function main() {
    const SALT_ROUNDS = 10;

    const users = [
        {
            name: 'Admin User',
            email: 'admin@zuvelio.com',
            password: 'Admin@123',
            role: 'ADMIN' as const,
        },
        {
            name: 'Manager User',
            email: 'manager@zuvelio.com',
            password: 'Manager@123',
            role: 'MANAGER' as const,
        },
        {
            name: 'Employee User',
            email: 'employee@zuvelio.com',
            password: 'Employee@123',
            role: 'EMPLOYEE' as const,
        },
    ];

    for (const user of users) {
        const existing = await prisma.user.findUnique({ where: { email: user.email } });
        if (existing) {
            console.log(`User already exists: ${user.email} (skipped)`);
            continue;
        }
        const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);
        await prisma.user.create({
            data: {
                name: user.name,
                email: user.email,
                password: hashedPassword,
                role: user.role,
                isActive: true,
            },
        });
        console.log(`Created ${user.role}: ${user.email} / ${user.password}`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
