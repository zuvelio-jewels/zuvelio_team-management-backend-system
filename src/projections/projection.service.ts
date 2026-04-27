import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectionDto } from './dto/create-projection.dto';
import { UpdateProjectionDto } from './dto/update-projection.dto';
import { ProjectionActionDto } from './dto/projection-action.dto';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class ProjectionService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) { }

  // Create a new projection (Admin only)
  async create(createProjectionDto: CreateProjectionDto, adminId: number) {
    const { employeeId, ...projectionData } = createProjectionDto;

    // Verify employee exists and is active
    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (!employee.isActive) {
      throw new BadRequestException('Employee is not active');
    }

    // Create projection
    const projection = await this.prisma.projection.create({
      data: {
        ...projectionData,
        employeeId,
        createdByAdminId: adminId,
        deadline: projectionData.deadline
          ? new Date(projectionData.deadline)
          : null,
      },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true } },
      },
    });

    // Send notification to employee
    await this.notificationService.createNotification(
      projection.id,
      employeeId,
      'PROJECTION_ASSIGNED',
      `New Task: ${projection.title}`,
      `You have been assigned a new task: ${projection.title}. Time allocated: ${projection.allocatedMinutes} minutes.`,
    );

    return projection;
  }

  // Get all projections with filtering
  async findAll(filters?: {
    employeeId?: number;
    status?: string;
    createdByAdminId?: number;
  }) {
    const where: any = {};

    if (filters?.employeeId) where.employeeId = filters.employeeId;
    if (filters?.status) where.status = filters.status;
    if (filters?.createdByAdminId)
      where.createdByAdminId = filters.createdByAdminId;

    return this.prisma.projection.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true } },
        timeLogs: { select: { id: true, actualDuration: true, status: true } },
        _count: { select: { timeLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get single projection with details
  async findOne(id: number) {
    const projection = await this.prisma.projection.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true } },
        timeLogs: {
          include: {
            breaks: true,
          },
        },
        projectionActions: {
          orderBy: { createdAt: 'desc' },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!projection) {
      throw new NotFoundException('Projection not found');
    }

    return projection;
  }

  // Update projection (Admin only)
  async update(
    id: number,
    updateProjectionDto: UpdateProjectionDto,
    adminId: number,
  ) {
    const projection = await this.findOne(id);

    // Only admin who created it can update
    if (projection.createdByAdminId !== adminId) {
      throw new ForbiddenException(
        'You can only update projections you created',
      );
    }

    // Cannot update if already completed
    if (projection.status === 'COMPLETED') {
      throw new BadRequestException('Cannot update a completed projection');
    }

    const updated = await this.prisma.projection.update({
      where: { id },
      data: {
        ...updateProjectionDto,
        deadline: updateProjectionDto.deadline
          ? new Date(updateProjectionDto.deadline)
          : undefined,
      },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  // Cancel projection
  async cancel(id: number, adminId: number) {
    const projection = await this.findOne(id);

    if (projection.createdByAdminId !== adminId) {
      throw new ForbiddenException(
        'You can only cancel projections you created',
      );
    }

    if (projection.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed projection');
    }

    return this.prisma.projection.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
  }

  // Get employee's current active projection
  async getEmployeeActiveProjection(employeeId: number) {
    return this.prisma.projection.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
      },
      include: {
        timeLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { timeLogs: true } },
      },
    });
  }

  // Get employee's completed projections
  async getEmployeeCompletedProjections(employeeId: number, limit = 10) {
    return this.prisma.projection.findMany({
      where: {
        employeeId,
        status: 'COMPLETED',
      },
      include: {
        timeLogs: { select: { actualDuration: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });
  }

  // Handle employee action (accept, reject, request time, switch, etc.)
  async handleEmployeeAction(
    projectionId: number,
    employeeId: number,
    actionDto: ProjectionActionDto,
  ) {
    const projection = await this.findOne(projectionId);

    // Verify employee is the one assigned
    if (projection.employeeId !== employeeId) {
      throw new ForbiddenException('You are not assigned to this projection');
    }

    let updatedProjection;
    const { actionType, reason, additionalMinutes } = actionDto;

    switch (actionType) {
      case 'ACCEPT':
        if (projection.status !== 'PENDING') {
          throw new BadRequestException('Can only accept pending projections');
        }
        updatedProjection = await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            status: 'ACCEPTED',
            employeeAcceptedAt: new Date(),
          },
        });

        // Notify admin
        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'PROJECTION_ACCEPTED',
          `${projection.employee.name} accepted task`,
          `${projection.employee.name} has accepted the task: "${projection.title}"`,
        );
        break;

      case 'REJECT':
        if (projection.status !== 'PENDING') {
          throw new BadRequestException('Can only reject pending projections');
        }
        updatedProjection = await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            status: 'REJECTED',
            employeeRejectedAt: new Date(),
            rejectionReason: reason,
          },
        });

        // Notify admin
        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'PROJECTION_REJECTED',
          `${projection.employee.name} rejected task`,
          `${projection.employee.name} rejected the task: "${projection.title}". Reason: ${reason || 'No reason provided'}`,
        );
        break;

      case 'REQUEST_TIME':
        if (!additionalMinutes || additionalMinutes < 1) {
          throw new BadRequestException('Additional minutes must be specified');
        }

        updatedProjection = await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            allocatedMinutes: projection.allocatedMinutes + additionalMinutes,
          },
        });

        // Notify admin
        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'TIME_EXTENSION_REQUESTED',
          'Time extension requested',
          `${projection.employee.name} requested ${additionalMinutes} additional minutes for "${projection.title}"`,
        );
        break;

      case 'COMPLETE':
        if (!['IN_PROGRESS', 'ACCEPTED'].includes(projection.status)) {
          throw new BadRequestException(
            'Can only complete in-progress or accepted projections',
          );
        }

        updatedProjection = await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Notify admin
        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'PROJECTION_COMPLETED',
          'Task completed',
          `${projection.employee.name} completed the task: "${projection.title}"`,
        );
        break;

      default:
        throw new BadRequestException(`Unknown action type: ${actionType}`);
    }

    // Log the action
    await this.prisma.projectionAction.create({
      data: {
        projectionId,
        employeeId,
        actionType,
        reason,
        details: additionalMinutes ? { additionalMinutes } : undefined,
      },
    });

    return updatedProjection;
  }

  // Get projections for admin dashboard
  async getAdminDashboard(adminId: number) {
    const projections = await this.prisma.projection.findMany({
      where: { createdByAdminId: adminId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        timeLogs: { select: { actualDuration: true } },
        _count: {
          select: { timeLogs: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate statistics
    const totalProjections = projections.length;
    const completedProjections = projections.filter(
      (p) => p.status === 'COMPLETED',
    ).length;
    const inProgressProjections = projections.filter(
      (p) => p.status === 'IN_PROGRESS',
    ).length;
    const pendingProjections = projections.filter(
      (p) => p.status === 'PENDING',
    ).length;

    const totalAllocatedTime = projections.reduce(
      (sum, p) => sum + p.allocatedMinutes,
      0,
    );
    const totalActualTime = projections.reduce(
      (sum, p) =>
        sum +
        p.timeLogs.reduce((logSum, log) => logSum + log.actualDuration, 0),
      0,
    );

    return {
      projections,
      statistics: {
        totalProjections,
        completedProjections,
        inProgressProjections,
        pendingProjections,
        totalAllocatedTime,
        totalActualTime,
        averageTimeEfficiency:
          totalAllocatedTime > 0
            ? Math.round((totalActualTime / totalAllocatedTime) * 100)
            : 0,
      },
    };
  }
}
