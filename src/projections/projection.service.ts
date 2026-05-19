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
import {
  CreateProjectionOperationDto,
  UpdateProjectionOperationDto,
} from './dto/projection-operation.dto';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class ProjectionService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // Create a new design projection (Admin only)
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
        operations: {
          orderBy: { order: 'asc' },
          include: {
            timeLogs: {
              select: { actualDuration: true, status: true },
            },
          },
        },
        timeLogs: {
          include: { breaks: true },
        },
        projectionActions: { orderBy: { createdAt: 'desc' } },
        notifications: { orderBy: { createdAt: 'desc' } },
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
      data: updateProjectionDto,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        createdByAdmin: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  // Delete projection from admin dashboard
  async cancel(id: number, actorId: number, actorRole?: string) {
    const projection = await this.findOne(id);

    const canManageAny = actorRole === 'ADMIN' || actorRole === 'MANAGER';
    if (!canManageAny && projection.createdByAdminId !== actorId) {
      throw new ForbiddenException(
        'You can only delete projections you created',
      );
    }

    // Hard delete the projection (related logs/actions/notifications cascade via Prisma schema).
    return this.prisma.projection.delete({
      where: { id },
    });
  }

  // Get employee's current active projection
  async getEmployeeActiveProjection(employeeId: number) {
    return this.prisma.projection.findFirst({
      where: {
        employeeId,
        status: 'IN_PROGRESS',
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
        projectionActions: {
          where: { actionType: 'REQUEST_TIME' },
          select: { details: true },
        },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });
  }

  async getEmployeePendingProjections(employeeId: number) {
    return this.prisma.projection.findMany({
      where: {
        employeeId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getEmployeeIncompleteProjections(employeeId: number) {
    return this.prisma.projection.findMany({
      where: {
        employeeId,
        status: 'INCOMPLETE',
      },
      include: {
        timeLogs: { select: { actualDuration: true } },
      },
      orderBy: { updatedAt: 'desc' },
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
    let actionDetails: any = undefined;

    switch (actionType) {
      case 'ACCEPT':
        if (projection.status !== 'PENDING') {
          throw new BadRequestException('Can only accept pending projections');
        }

        const otherActiveProjection = await this.prisma.projection.findFirst({
          where: {
            employeeId,
            id: { not: projectionId },
            status: { in: ['ACCEPTED', 'IN_PROGRESS'] },
          },
          select: { id: true, title: true, status: true },
        });

        // Auto-switch: if there's an active project, mark it INCOMPLETE first
        if (otherActiveProjection) {
          await this.finalizeOpenTimeLogForProjection(
            otherActiveProjection.id,
            employeeId,
          );
          await this.prisma.projection.update({
            where: { id: otherActiveProjection.id },
            data: {
              status: 'INCOMPLETE',
              rejectionReason: `Auto-switched when "${projection.title}" was accepted`,
            },
          });
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
        actionDetails = { additionalMinutes };
        break;

      case 'SWITCH_PROJECTION': {
        const switchToProjectionId = actionDto.switchToProjectionId;
        const switchReason = reason?.trim();

        if (!switchToProjectionId) {
          throw new BadRequestException('switchToProjectionId is required');
        }

        if (!switchReason) {
          throw new BadRequestException(
            'Reason is required when switching projects',
          );
        }

        if (!['ACCEPTED', 'IN_PROGRESS'].includes(projection.status)) {
          throw new BadRequestException(
            'Can only switch active or accepted projections',
          );
        }

        if (switchToProjectionId === projectionId) {
          throw new BadRequestException('Cannot switch to the same projection');
        }

        const targetProjection = await this.prisma.projection.findUnique({
          where: { id: switchToProjectionId },
          include: {
            employee: { select: { id: true, name: true, email: true } },
          },
        });

        if (!targetProjection) {
          throw new NotFoundException('Target projection not found');
        }

        if (targetProjection.employeeId !== employeeId) {
          throw new ForbiddenException(
            'You can only switch to your assigned projections',
          );
        }

        if (['COMPLETED', 'REJECTED'].includes(targetProjection.status)) {
          throw new BadRequestException(
            'Cannot switch to completed or rejected projections',
          );
        }

        const closedLog = await this.finalizeOpenTimeLogForProjection(
          projectionId,
          employeeId,
        );

        await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            status: 'INCOMPLETE',
            rejectionReason: switchReason,
            completedAt: null,
          },
        });

        const targetStatusData: any = {
          status: 'IN_PROGRESS',
        };

        if (targetProjection.status === 'PENDING') {
          targetStatusData.employeeAcceptedAt = new Date();
        }

        const switchedProjection = await this.prisma.projection.update({
          where: { id: switchToProjectionId },
          data: targetStatusData,
          include: {
            employee: { select: { id: true, name: true, email: true } },
            createdByAdmin: { select: { id: true, name: true } },
          },
        });

        const newTimeLog = await this.prisma.timeLog.create({
          data: {
            projectionId: switchToProjectionId,
            employeeId,
            sessionStart: new Date(),
            allocatedDuration: switchedProjection.allocatedMinutes,
            status: 'active',
          },
        });

        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'PROJECTION_SWITCHED',
          'Projection switched',
          `${projection.employee.name} marked "${projection.title}" as incomplete and switched to "${switchedProjection.title}". Reason: ${switchReason}`,
        );

        if (
          switchedProjection.createdByAdminId !== projection.createdByAdminId
        ) {
          await this.notificationService.createNotification(
            switchedProjection.id,
            switchedProjection.createdByAdminId,
            'PROJECTION_SWITCHED',
            'Projection switched',
            `${projection.employee.name} switched to "${switchedProjection.title}" and started work. Previous task marked incomplete. Reason: ${switchReason}`,
          );
        }

        actionDetails = {
          switchToProjectionId,
          switchedFromProjectionId: projectionId,
          switchedFromStatus: 'INCOMPLETE',
          switchReason,
          closedTimeLogId: closedLog?.id,
          newTimeLogId: newTimeLog.id,
        };

        updatedProjection = switchedProjection;
        break;
      }

      case 'COMPLETE':
        if (!['IN_PROGRESS', 'ACCEPTED'].includes(projection.status)) {
          throw new BadRequestException(
            'Can only complete in-progress or accepted projections',
          );
        }

        const finalizedLog = await this.finalizeOpenTimeLogForProjection(
          projectionId,
          employeeId,
        );

        const totals = await this.prisma.timeLog.aggregate({
          where: {
            projectionId,
            employeeId,
          },
          _sum: {
            actualDuration: true,
          },
          _count: {
            id: true,
          },
        });

        const totalActualMinutes = totals._sum.actualDuration || 0;
        const varianceMinutes =
          totalActualMinutes - projection.allocatedMinutes;

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
          `${projection.employee.name} completed "${projection.title}". Allocated: ${projection.allocatedMinutes} min, Actual: ${totalActualMinutes} min, Variance: ${varianceMinutes} min, Sessions: ${totals._count.id}.`,
        );

        actionDetails = {
          finalizedTimeLogId: finalizedLog?.id,
          allocatedMinutes: projection.allocatedMinutes,
          totalActualMinutes,
          varianceMinutes,
          sessionsCount: totals._count.id,
        };
        break;

      case 'RESUME_INCOMPLETE': {
        if (projection.status !== 'INCOMPLETE') {
          throw new BadRequestException(
            'Can only resume projections marked as incomplete',
          );
        }

        // If another projection has an open session, close it before resuming.
        const otherOpenLog = await this.prisma.timeLog.findFirst({
          where: {
            employeeId,
            projectionId: { not: projectionId },
            sessionEnd: null,
            status: { in: ['active', 'paused'] },
          },
          select: { projectionId: true },
        });

        if (otherOpenLog) {
          await this.finalizeOpenTimeLogForProjection(
            otherOpenLog.projectionId,
            employeeId,
          );

          await this.prisma.projection.update({
            where: { id: otherOpenLog.projectionId },
            data: {
              status: 'INCOMPLETE',
              rejectionReason:
                'Auto-switched while resuming another incomplete projection',
            },
          });
        }

        updatedProjection = await this.prisma.projection.update({
          where: { id: projectionId },
          data: {
            status: 'IN_PROGRESS',
            employeeAcceptedAt: projection.employeeAcceptedAt || new Date(),
          },
        });

        const existingOpenLog = await this.prisma.timeLog.findFirst({
          where: {
            projectionId,
            employeeId,
            sessionEnd: null,
            status: { in: ['active', 'paused'] },
          },
          include: {
            breaks: { orderBy: { startTime: 'desc' }, take: 1 },
          },
          orderBy: { sessionStart: 'desc' },
        });

        let resumedTimeLogId: number;

        if (existingOpenLog) {
          if (existingOpenLog.status === 'paused') {
            const latestBreak = existingOpenLog.breaks[0];
            if (latestBreak && !latestBreak.endTime) {
              const now = new Date();
              const breakDurationMinutes = Math.max(
                0,
                Math.round(
                  (now.getTime() - new Date(latestBreak.startTime).getTime()) /
                    60000,
                ),
              );

              await this.prisma.break.update({
                where: { id: latestBreak.id },
                data: {
                  endTime: now,
                  duration: breakDurationMinutes,
                },
              });
            }

            await this.prisma.timeLog.update({
              where: { id: existingOpenLog.id },
              data: { status: 'active' },
            });
          }

          resumedTimeLogId = existingOpenLog.id;
        } else {
          const newTimeLog = await this.prisma.timeLog.create({
            data: {
              projectionId,
              employeeId,
              sessionStart: new Date(),
              allocatedDuration: projection.allocatedMinutes,
              status: 'active',
            },
          });

          resumedTimeLogId = newTimeLog.id;
        }

        actionDetails = {
          resumedProjectionId: projectionId,
          resumedFromStatus: 'INCOMPLETE',
          resumedTimeLogId,
        };

        await this.notificationService.createNotification(
          projectionId,
          projection.createdByAdminId,
          'PROJECTION_SWITCHED',
          'Incomplete projection resumed',
          `${projection.employee.name} resumed incomplete task: "${projection.title}".`,
        );
        break;
      }

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
        details: actionDetails,
      },
    });

    return updatedProjection;
  }

  private async finalizeOpenTimeLogForProjection(
    projectionId: number,
    employeeId: number,
  ) {
    const openLog = await this.prisma.timeLog.findFirst({
      where: {
        projectionId,
        employeeId,
        sessionEnd: null,
      },
      include: {
        breaks: true,
      },
      orderBy: {
        sessionStart: 'desc',
      },
    });

    if (!openLog) {
      return null;
    }

    const now = new Date();

    for (const br of openLog.breaks) {
      if (!br.endTime) {
        const breakDurationMinutes = Math.max(
          0,
          Math.round(
            (now.getTime() - new Date(br.startTime).getTime()) / 60000,
          ),
        );

        await this.prisma.break.update({
          where: { id: br.id },
          data: {
            endTime: now,
            duration: breakDurationMinutes,
          },
        });
      }
    }

    const refreshedBreaks = await this.prisma.break.findMany({
      where: { timeLogId: openLog.id },
    });

    const sessionDurationMinutes =
      (now.getTime() - new Date(openLog.sessionStart).getTime()) / 60000;
    const breaksDurationMinutes = refreshedBreaks.reduce(
      (sum, br) => sum + (br.duration || 0),
      0,
    );

    const actualDuration = Math.max(
      0,
      Math.round(sessionDurationMinutes - breaksDurationMinutes),
    );

    return this.prisma.timeLog.update({
      where: { id: openLog.id },
      data: {
        sessionEnd: now,
        status: 'completed',
        actualDuration,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // PROJECTION OPERATIONS
  // ─────────────────────────────────────────────────────────────

  async addOperation(
    projectionId: number,
    dto: CreateProjectionOperationDto,
    adminId: number,
  ) {
    const projection = await this.findOne(projectionId);
    if (projection.createdByAdminId !== adminId) {
      throw new ForbiddenException('Only the creator can add operations');
    }

    const maxOrder = await this.prisma.projectionOperation.aggregate({
      where: { projectionId },
      _max: { order: true },
    });

    return this.prisma.projectionOperation.create({
      data: {
        projectionId,
        title: dto.title,
        description: dto.description,
        allocatedMinutes: dto.allocatedMinutes,
        order: dto.order ?? (maxOrder._max.order ?? 0) + 1,
      },
    });
  }

  async bulkAddOperations(
    projectionId: number,
    operations: CreateProjectionOperationDto[],
    adminId: number,
  ) {
    const projection = await this.findOne(projectionId);
    if (projection.createdByAdminId !== adminId) {
      throw new ForbiddenException('Only the creator can add operations');
    }

    const maxOrder = await this.prisma.projectionOperation.aggregate({
      where: { projectionId },
      _max: { order: true },
    });

    let nextOrder = (maxOrder._max.order ?? 0) + 1;
    const data = operations.map((op) => ({
      projectionId,
      title: op.title,
      description: op.description ?? null,
      allocatedMinutes: op.allocatedMinutes ?? null,
      order: op.order ?? nextOrder++,
    }));

    await this.prisma.projectionOperation.createMany({ data });
    return this.prisma.projectionOperation.findMany({
      where: { projectionId },
      orderBy: { order: 'asc' },
    });
  }

  async updateOperation(
    operationId: number,
    dto: UpdateProjectionOperationDto,
    adminId: number,
  ) {
    const op = await this.prisma.projectionOperation.findUnique({
      where: { id: operationId },
      include: { projection: { select: { createdByAdminId: true } } },
    });
    if (!op) throw new NotFoundException('Operation not found');
    if (op.projection.createdByAdminId !== adminId) {
      throw new ForbiddenException('Only the creator can update operations');
    }

    return this.prisma.projectionOperation.update({
      where: { id: operationId },
      data: dto,
    });
  }

  async deleteOperation(operationId: number, adminId: number) {
    const op = await this.prisma.projectionOperation.findUnique({
      where: { id: operationId },
      include: { projection: { select: { createdByAdminId: true } } },
    });
    if (!op) throw new NotFoundException('Operation not found');
    if (op.projection.createdByAdminId !== adminId) {
      throw new ForbiddenException('Only the creator can delete operations');
    }

    return this.prisma.projectionOperation.delete({ where: { id: operationId } });
  }

  async getOperations(projectionId: number) {
    const ops = await this.prisma.projectionOperation.findMany({
      where: { projectionId },
      orderBy: { order: 'asc' },
      include: {
        timeLogs: {
          select: { id: true, actualDuration: true, status: true, sessionStart: true, sessionEnd: true },
        },
      },
    });

    return ops.map((op) => ({
      ...op,
      totalMinutes: op.timeLogs.reduce((s, l) => s + (l.actualDuration ?? 0), 0),
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // OPERATION TIME TRACKING
  // ─────────────────────────────────────────────────────────────

  async startOperationTimer(operationId: number, employeeId: number) {
    const op = await this.prisma.projectionOperation.findUnique({
      where: { id: operationId },
      include: {
        projection: {
          select: { id: true, employeeId: true, status: true, allocatedMinutes: true },
        },
      },
    });

    if (!op) throw new NotFoundException('Operation not found');
    if (op.projection.employeeId !== employeeId) {
      throw new ForbiddenException('Not your projection');
    }
    if (!['ACCEPTED', 'IN_PROGRESS'].includes(op.projection.status)) {
      throw new BadRequestException('Projection must be accepted before starting work');
    }
    if (op.status === 'COMPLETED') {
      throw new BadRequestException('Operation already completed');
    }

    // Close any other open timer for this employee
    await this.closeOpenTimers(employeeId);

    // Mark operation and projection as IN_PROGRESS
    await this.prisma.projectionOperation.update({
      where: { id: operationId },
      data: { status: 'IN_PROGRESS' },
    });
    await this.prisma.projection.update({
      where: { id: op.projection.id },
      data: { status: 'IN_PROGRESS' },
    });

    const timeLog = await this.prisma.timeLog.create({
      data: {
        projectionId: op.projection.id,
        operationId,
        employeeId,
        sessionStart: new Date(),
        allocatedDuration: op.allocatedMinutes ?? op.projection.allocatedMinutes,
        status: 'active',
      },
    });

    return { timeLog, operation: op };
  }

  async pauseOperationTimer(timeLogId: number, employeeId: number) {
    const log = await this.getOpenTimeLog(timeLogId, employeeId);

    await this.prisma.break.create({
      data: { timeLogId: log.id, startTime: new Date() },
    });

    return this.prisma.timeLog.update({
      where: { id: log.id },
      data: { status: 'paused' },
    });
  }

  async resumeOperationTimer(timeLogId: number, employeeId: number) {
    const log = await this.getOpenTimeLog(timeLogId, employeeId);
    if (log.status !== 'paused') {
      throw new BadRequestException('Timer is not paused');
    }

    const openBreak = await this.prisma.break.findFirst({
      where: { timeLogId: log.id, endTime: null },
    });

    if (openBreak) {
      const now = new Date();
      const duration = Math.max(
        0,
        Math.round((now.getTime() - new Date(openBreak.startTime).getTime()) / 60000),
      );
      await this.prisma.break.update({
        where: { id: openBreak.id },
        data: { endTime: now, duration },
      });
    }

    return this.prisma.timeLog.update({
      where: { id: log.id },
      data: { status: 'active' },
    });
  }

  async completeOperationTimer(timeLogId: number, employeeId: number) {
    const log = await this.getOpenTimeLog(timeLogId, employeeId);
    const now = new Date();

    // Close any open break
    const openBreak = await this.prisma.break.findFirst({
      where: { timeLogId: log.id, endTime: null },
    });
    if (openBreak) {
      const duration = Math.max(
        0,
        Math.round((now.getTime() - new Date(openBreak.startTime).getTime()) / 60000),
      );
      await this.prisma.break.update({
        where: { id: openBreak.id },
        data: { endTime: now, duration },
      });
    }

    const allBreaks = await this.prisma.break.findMany({ where: { timeLogId: log.id } });
    const breaksMins = allBreaks.reduce((s, b) => s + (b.duration ?? 0), 0);
    const grossMins = (now.getTime() - new Date(log.sessionStart).getTime()) / 60000;
    const actualDuration = Math.max(0, Math.round(grossMins - breaksMins));

    const completed = await this.prisma.timeLog.update({
      where: { id: log.id },
      data: { sessionEnd: now, status: 'completed', actualDuration },
    });

    // Mark operation complete
    await this.prisma.projectionOperation.update({
      where: { id: log.operationId! },
      data: { status: 'COMPLETED' },
    });

    // Check if ALL operations are complete → auto-complete projection
    const allOps = await this.prisma.projectionOperation.findMany({
      where: { projectionId: log.projectionId },
    });
    const allDone = allOps.length > 0 && allOps.every((o) => o.status === 'COMPLETED');
    if (allDone) {
      const totals = await this.prisma.timeLog.aggregate({
        where: { projectionId: log.projectionId },
        _sum: { actualDuration: true },
      });
      await this.prisma.projection.update({
        where: { id: log.projectionId },
        data: { status: 'COMPLETED', completedAt: now },
      });
    }

    return { timeLog: completed, allOperationsComplete: allDone };
  }

  async getCurrentOperationTimer(employeeId: number) {
    return this.prisma.timeLog.findFirst({
      where: {
        employeeId,
        sessionEnd: null,
        status: { in: ['active', 'paused'] },
        operationId: { not: null },
      },
      include: {
        operation: true,
        projection: { select: { id: true, title: true, allocatedMinutes: true } },
        breaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });
  }

  private async closeOpenTimers(employeeId: number) {
    const openLogs = await this.prisma.timeLog.findMany({
      where: { employeeId, sessionEnd: null, status: { in: ['active', 'paused'] } },
      include: { breaks: true },
    });

    for (const log of openLogs) {
      const now = new Date();
      const openBreak = log.breaks.find((b) => !b.endTime);
      let breaksMins = log.breaks.reduce((s, b) => s + (b.duration ?? 0), 0);

      if (openBreak) {
        const bd = Math.max(0, Math.round((now.getTime() - new Date(openBreak.startTime).getTime()) / 60000));
        await this.prisma.break.update({ where: { id: openBreak.id }, data: { endTime: now, duration: bd } });
        breaksMins += bd;
      }

      const grossMins = (now.getTime() - new Date(log.sessionStart).getTime()) / 60000;
      const actualDuration = Math.max(0, Math.round(grossMins - breaksMins));

      await this.prisma.timeLog.update({
        where: { id: log.id },
        data: { sessionEnd: now, status: 'completed', actualDuration },
      });
    }
  }

  private async getOpenTimeLog(timeLogId: number, employeeId: number) {
    const log = await this.prisma.timeLog.findUnique({
      where: { id: timeLogId },
      include: { breaks: true },
    });
    if (!log) throw new NotFoundException('Time log not found');
    if (log.employeeId !== employeeId) throw new ForbiddenException('Not your timer');
    if (log.sessionEnd) throw new BadRequestException('Timer already closed');
    return log;
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
    const incompleteProjections = projections.filter(
      (p) => p.status === 'INCOMPLETE',
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
        incompleteProjections,
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
