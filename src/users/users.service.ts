import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async findAll() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isAssignable: true,
        isProjectAssignable: true,
        isApproved: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findPendingApproval() {
    // Return all unapproved users:
    // - Newly registered (isApproved: false, isActive: false)
    // - Legacy users from before approval system (isApproved: false, isActive: true)
    return this.prisma.user.findMany({
      where: {
        isApproved: false,
        // Include both inactive (pending) and active (legacy) users
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        isActive: true, // Include this to show which are legacy vs new
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

  async findProjectAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true, isProjectAssignable: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isProjectAssignable: true,
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
        isProjectAssignable: true,
        isApproved: true,
      },
    });
  }

  async setProjectAssignable(id: number, isProjectAssignable: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { isProjectAssignable },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isProjectAssignable: true,
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

    try {
      // For pending users, first unassign any tasks and documents if they somehow have any
      await this.prisma.task.updateMany({
        where: {
          OR: [{ assignedToId: id }, { allottedFromId: id }],
        },
        data: {
          assignedToId: null,
          allottedFromId: null,
        },
      });

      // Unassign any documents uploaded by this user
      await this.prisma.taskDocument.updateMany({
        where: { uploadedById: id },
        data: { uploadedById: undefined },
      });

      // Delete the user record entirely on rejection
      await this.prisma.user.delete({ where: { id } });
      return { message: 'User registration rejected and removed' };
    } catch (error) {
      if (
        error instanceof Object &&
        'code' in error &&
        (error.code === '23503' || error.code === '23001')
      ) {
        throw new BadRequestException(
          'Cannot reject user: User has dependencies. Please delete assigned tasks first.',
        );
      }
      throw error;
    }
  }

  async removeUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    try {
      // Unassign all tasks from this user (set to NULL instead of deleting them)
      // This ensures data integrity while allowing user deletion
      await this.prisma.task.updateMany({
        where: {
          OR: [{ assignedToId: id }, { allottedFromId: id }],
        },
        data: {
          assignedToId: null,
          allottedFromId: null,
        },
      });

      // Unassign any documents uploaded by this user
      await this.prisma.taskDocument.updateMany({
        where: { uploadedById: id },
        data: { uploadedById: undefined },
      });

      // Now delete the user safely
      await this.prisma.user.delete({ where: { id } });
      return {
        message:
          'User deleted successfully. Associated tasks have been unassigned.',
      };
    } catch (error) {
      if (
        error instanceof Object &&
        'code' in error &&
        (error.code === '23503' || error.code === '23001')
      ) {
        throw new BadRequestException(
          'Cannot delete user: User has dependencies in the system. Please contact support.',
        );
      }
      throw error;
    }
  }
}
