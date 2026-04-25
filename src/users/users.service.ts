import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAssignable: true,
        isApproved: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findPendingApproval() {
    return this.prisma.user.findMany({
      where: { isApproved: false, isActive: false },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true, isAssignable: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAssignable: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAssignable: true,
        isApproved: true,
      },
    });
  }

  async setAssignable(id: number, isAssignable: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { isAssignable },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAssignable: true,
      },
    });
  }

  async approveUser(id: number, role: Role) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { isApproved: true, isActive: true, role },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
      },
    });
  }

  async rejectUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    // Delete the user record entirely on rejection
    await this.prisma.user.delete({ where: { id } });
    return { message: 'User registration rejected and removed' };
  }

  async removeUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }
}
