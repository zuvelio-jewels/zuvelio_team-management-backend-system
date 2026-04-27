import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StartTimeLogDto } from './dto/start-time-log.dto';

@Injectable()
export class TimeTrackingService {
  constructor(private prisma: PrismaService) {}

  // Start a new time log session
  async startTimeLog(employeeId: number, startDto: StartTimeLogDto) {
    const { projectionId } = startDto;

    // Verify projection exists and is assigned to this employee
    const projection = await this.prisma.projection.findUnique({
      where: { id: projectionId },
    });

    if (!projection) {
      throw new NotFoundException('Projection not found');
    }

    if (projection.employeeId !== employeeId) {
      throw new BadRequestException('You are not assigned to this projection');
    }

    // Check if employee already has an active time log for this projection
    const existingActiveLog = await this.prisma.timeLog.findFirst({
      where: {
        projectionId,
        employeeId,
        status: { in: ['active', 'paused'] },
        sessionEnd: null,
      },
    });

    if (existingActiveLog) {
      throw new BadRequestException(
        'You already have an active timer for this projection',
      );
    }

    // Create new time log
    const timeLog = await this.prisma.timeLog.create({
      data: {
        projectionId,
        employeeId,
        sessionStart: new Date(),
        allocatedDuration: projection.allocatedMinutes,
        status: 'active',
      },
      include: {
        projection: { select: { title: true, allocatedMinutes: true } },
      },
    });

    // Update projection status to IN_PROGRESS
    await this.prisma.projection.update({
      where: { id: projectionId },
      data: { status: 'IN_PROGRESS' },
    });

    return timeLog;
  }

  // Stop a time log session
  async stopTimeLog(employeeId: number, timeLogId: number) {
    const timeLog = await this.prisma.timeLog.findUnique({
      where: { id: timeLogId },
      include: { breaks: true },
    });

    if (!timeLog) {
      throw new NotFoundException('Time log not found');
    }

    if (timeLog.employeeId !== employeeId) {
      throw new BadRequestException('This time log is not yours');
    }

    if (timeLog.sessionEnd) {
      throw new BadRequestException('Time log is already stopped');
    }

    // Calculate actual duration (session time - breaks)
    const sessionDuration =
      (new Date().getTime() - new Date(timeLog.sessionStart).getTime()) / 60000; // minutes
    const breaksDuration = timeLog.breaks.reduce(
      (sum, b) => sum + (b.duration || 0),
      0,
    );
    const actualDuration = Math.max(0, sessionDuration - breaksDuration);

    const updated = await this.prisma.timeLog.update({
      where: { id: timeLogId },
      data: {
        sessionEnd: new Date(),
        actualDuration: Math.round(actualDuration),
        status: 'completed',
      },
      include: {
        projection: { select: { id: true, title: true } },
        breaks: true,
      },
    });

    return updated;
  }

  // Pause a time log (start a break)
  async pauseTimeLog(employeeId: number, timeLogId: number) {
    const timeLog = await this.prisma.timeLog.findUnique({
      where: { id: timeLogId },
    });

    if (!timeLog) {
      throw new NotFoundException('Time log not found');
    }

    if (timeLog.employeeId !== employeeId) {
      throw new BadRequestException('This time log is not yours');
    }

    if (timeLog.status !== 'active') {
      throw new BadRequestException('Can only pause active time logs');
    }

    // Create a break record (without end time yet)
    const breakRecord = await this.prisma.break.create({
      data: {
        timeLogId,
        startTime: new Date(),
      },
    });

    const updated = await this.prisma.timeLog.update({
      where: { id: timeLogId },
      data: { status: 'paused' },
    });

    return { timeLog: updated, break: breakRecord };
  }

  // Resume a paused time log (end the break)
  async resumeTimeLog(employeeId: number, timeLogId: number) {
    const timeLog = await this.prisma.timeLog.findUnique({
      where: { id: timeLogId },
      include: { breaks: { orderBy: { startTime: 'desc' }, take: 1 } },
    });

    if (!timeLog) {
      throw new NotFoundException('Time log not found');
    }

    if (timeLog.employeeId !== employeeId) {
      throw new BadRequestException('This time log is not yours');
    }

    if (timeLog.status !== 'paused') {
      throw new BadRequestException('Can only resume paused time logs');
    }

    // End the current break
    if (timeLog.breaks.length > 0) {
      const lastBreak = timeLog.breaks[0];
      if (!lastBreak.endTime) {
        const breakDurationMinutes =
          (new Date().getTime() - new Date(lastBreak.startTime).getTime()) /
          60000;

        await this.prisma.break.update({
          where: { id: lastBreak.id },
          data: {
            endTime: new Date(),
            duration: Math.round(breakDurationMinutes),
          },
        });
      }
    }

    const updated = await this.prisma.timeLog.update({
      where: { id: timeLogId },
      data: { status: 'active' },
    });

    return updated;
  }

  // Get current time log for an employee on a projection
  async getCurrentTimeLog(employeeId: number, projectionId: number) {
    return this.prisma.timeLog.findFirst({
      where: {
        employeeId,
        projectionId,
        sessionEnd: null,
      },
      include: {
        breaks: true,
        projection: {
          select: { id: true, title: true, allocatedMinutes: true },
        },
      },
    });
  }

  // Get all time logs for a projection
  async getProjectionTimeLogs(projectionId: number) {
    return this.prisma.timeLog.findMany({
      where: { projectionId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        breaks: true,
      },
      orderBy: { sessionStart: 'asc' },
    });
  }

  // Get employee's time logs (with optional date filter)
  async getEmployeeTimeLogs(
    employeeId: number,
    filters?: {
      projectionId?: number;
      fromDate?: Date;
      toDate?: Date;
    },
  ) {
    const where: any = { employeeId };

    if (filters?.projectionId) where.projectionId = filters.projectionId;

    if (filters?.fromDate || filters?.toDate) {
      where.sessionStart = {};
      if (filters.fromDate) where.sessionStart.gte = filters.fromDate;
      if (filters.toDate) where.sessionStart.lte = filters.toDate;
    }

    return this.prisma.timeLog.findMany({
      where,
      include: {
        projection: { select: { id: true, title: true } },
        breaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });
  }

  // Get time log statistics for employee on a specific day
  async getEmployeeDailyStats(employeeId: number, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const timeLogs = await this.prisma.timeLog.findMany({
      where: {
        employeeId,
        sessionStart: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        projection: {
          select: { id: true, title: true, allocatedMinutes: true },
        },
        breaks: true,
      },
    });

    // Calculate statistics
    let totalMinutesSpent = 0;
    let totalMinutesAllocated = 0;
    const projectionsWorkedOn = new Map<number, any>();

    for (const log of timeLogs) {
      totalMinutesSpent += log.actualDuration;
      totalMinutesAllocated += log.allocatedDuration;

      if (!projectionsWorkedOn.has(log.projectionId)) {
        projectionsWorkedOn.set(log.projectionId, {
          id: log.projectionId,
          title: log.projection.title,
          timeSpent: 0,
          sessions: [],
        });
      }

      const proj = projectionsWorkedOn.get(log.projectionId);
      proj.timeSpent += log.actualDuration;
      proj.sessions.push({
        start: log.sessionStart,
        end: log.sessionEnd,
        duration: log.actualDuration,
      });
    }

    return {
      date,
      totalMinutesSpent,
      totalMinutesAllocated,
      efficiency:
        totalMinutesAllocated > 0
          ? Math.round((totalMinutesSpent / totalMinutesAllocated) * 100)
          : 0,
      projectionsWorkedOn: Array.from(projectionsWorkedOn.values()),
      sessionsCount: timeLogs.length,
    };
  }
}
