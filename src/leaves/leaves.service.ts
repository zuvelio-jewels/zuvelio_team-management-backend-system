import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeavesService {
    constructor(private prisma: PrismaService) { }

    // Get all leaves (for admin/manager use)
    async getAll() {
        return this.prisma.leave.findMany({
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
            },
            orderBy: {
                fromDate: 'desc',
            },
        });
    }

    // Get current user's leaves
    async getMyLeaves(userId: number) {
        return this.prisma.leave.findMany({
            where: {
                userId: userId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
            },
            orderBy: {
                fromDate: 'desc',
            },
        });
    }

    // Apply for leave
    async create(
        userId: number,
        data: { type: string; fromDate: string; toDate: string },
    ) {
        return this.prisma.leave.create({
            data: {
                userId,
                type: data.type,
                fromDate: new Date(data.fromDate),
                toDate: new Date(data.toDate),
                status: 'PENDING',
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });
    }

    // Update leave status (for admin/manager)
    async update(id: number, data: any) {
        return this.prisma.leave.update({
            where: { id },
            data,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });
    }
}
