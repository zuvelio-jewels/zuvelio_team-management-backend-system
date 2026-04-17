import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, email: true, role: true },
            orderBy: { name: 'asc' },
        });
    }

    async findOne(id: number) {
        return this.prisma.user.findUnique({
            where: { id },
            select: { id: true, name: true, email: true, role: true },
        });
    }
}
