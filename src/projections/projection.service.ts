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
            data: updateProjectionDto,
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
                    throw new BadRequestException('Reason is required when switching projects');
                }

                if (!['ACCEPTED', 'IN_PROGRESS'].includes(projection.status)) {
                    throw new BadRequestException('Can only switch active or accepted projections');
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
                                    (now.getTime() -
                                        new Date(latestBreak.startTime).getTime()) /
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
