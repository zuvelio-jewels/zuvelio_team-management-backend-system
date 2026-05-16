import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StartTaskTimerDto,
  SwitchTaskTimerDto,
  CreateTaskOperationDto,
} from './dto/task-time-tracking.dto';

@Injectable()
export class TaskTimeTrackingService {
  constructor(private prisma: PrismaService) {}

  // ─── Timer Operations ───────────────────────────────────────────────────────

  async startTimer(employeeId: number, dto: StartTaskTimerDto) {
    const { taskId } = dto;

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assignedToId !== employeeId)
      throw new ForbiddenException('You are not assigned to this task');
    if (task.personStatus === 'DONE')
      throw new BadRequestException('Task is already completed');

    // Enforce one active session at a time across all tasks
    const existingOpen = await this.prisma.taskTimeLog.findFirst({
      where: {
        employeeId,
        status: { in: ['active', 'paused'] },
        sessionEnd: null,
      },
      include: { task: { select: { id: true, title: true } } },
    });

    if (existingOpen && existingOpen.taskId !== taskId) {
      throw new BadRequestException(
        `You already have an active session on "${existingOpen.task.title}". Switch or complete it before starting another task.`,
      );
    }

    if (existingOpen && existingOpen.taskId === taskId) {
      throw new BadRequestException('Timer is already running for this task');
    }

    const timeLog = await this.prisma.taskTimeLog.create({
      data: {
        taskId,
        employeeId,
        sessionStart: new Date(),
        allocatedDuration: task.allocatedMinutes ?? 0,
        status: 'active',
      },
      include: {
        task: { select: { id: true, title: true, allocatedMinutes: true } },
      },
    });

    // Move task to IN_PROGRESS if it was NOT_STARTED
    if (task.personStatus === 'NOT_STARTED') {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { personStatus: 'IN_PROGRESS', updatedBy: new Date() },
      });
    }

    return timeLog;
  }

  async pauseTimer(employeeId: number, timeLogId: number) {
    const timeLog = await this.prisma.taskTimeLog.findUnique({
      where: { id: timeLogId },
    });
    if (!timeLog) throw new NotFoundException('Time log not found');
    if (timeLog.employeeId !== employeeId)
      throw new ForbiddenException('This time log is not yours');
    if (timeLog.status !== 'active')
      throw new BadRequestException('Can only pause an active timer');

    await this.prisma.taskBreak.create({
      data: { timeLogId, startTime: new Date() },
    });

    return this.prisma.taskTimeLog.update({
      where: { id: timeLogId },
      data: { status: 'paused' },
    });
  }

  async resumeTimer(employeeId: number, timeLogId: number) {
    const timeLog = await this.prisma.taskTimeLog.findUnique({
      where: { id: timeLogId },
      include: { taskBreaks: { orderBy: { startTime: 'desc' }, take: 1 } },
    });
    if (!timeLog) throw new NotFoundException('Time log not found');
    if (timeLog.employeeId !== employeeId)
      throw new ForbiddenException('This time log is not yours');
    if (timeLog.status !== 'paused')
      throw new BadRequestException('Can only resume a paused timer');

    const lastBreak = timeLog.taskBreaks[0];
    if (lastBreak && !lastBreak.endTime) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(lastBreak.startTime).getTime()) / 60000,
      );
      await this.prisma.taskBreak.update({
        where: { id: lastBreak.id },
        data: { endTime: new Date(), duration: durationMinutes },
      });
    }

    return this.prisma.taskTimeLog.update({
      where: { id: timeLogId },
      data: { status: 'active' },
    });
  }

  async switchTimer(employeeId: number, dto: SwitchTaskTimerDto) {
    const { timeLogId, reason } = dto;

    const timeLog = await this.prisma.taskTimeLog.findUnique({
      where: { id: timeLogId },
    });
    if (!timeLog) throw new NotFoundException('Time log not found');
    if (timeLog.employeeId !== employeeId)
      throw new ForbiddenException('This time log is not yours');
    if (timeLog.status === 'completed')
      throw new BadRequestException('Session already completed');

    // Close any open break first
    const openBreak = await this.prisma.taskBreak.findFirst({
      where: { timeLogId, endTime: null },
    });
    if (openBreak) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(openBreak.startTime).getTime()) / 60000,
      );
      await this.prisma.taskBreak.update({
        where: { id: openBreak.id },
        data: { endTime: new Date(), duration: durationMinutes },
      });
    }

    const now = new Date();
    const totalBreakMinutes = await this.computeTotalBreakMinutes(timeLogId);
    const grossMinutes = Math.round(
      (now.getTime() - new Date(timeLog.sessionStart).getTime()) / 60000,
    );
    const actualDuration = Math.max(0, grossMinutes - totalBreakMinutes);

    return this.prisma.taskTimeLog.update({
      where: { id: timeLogId },
      data: {
        sessionEnd: now,
        status: 'completed',
        actualDuration,
        switchReason: reason,
      },
    });
  }

  // Get the current open timer for the logged-in employee
  async getCurrentTimer(employeeId: number) {
    const log = await this.prisma.taskTimeLog.findFirst({
      where: {
        employeeId,
        status: { in: ['active', 'paused'] },
        sessionEnd: null,
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            allocatedMinutes: true,
            personStatus: true,
          },
        },
        taskBreaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });

    if (!log) return null;

    const elapsedSeconds = this.computeElapsedSeconds(log);
    return { ...log, elapsedSeconds };
  }

  // ─── Admin: mark task time session as completed (called when admin marks task DONE) ─

  async completeTimerForTask(taskId: number) {
    const openLog = await this.prisma.taskTimeLog.findFirst({
      where: { taskId, status: { in: ['active', 'paused'] }, sessionEnd: null },
    });
    if (!openLog) return null;

    const openBreak = await this.prisma.taskBreak.findFirst({
      where: { timeLogId: openLog.id, endTime: null },
    });
    if (openBreak) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(openBreak.startTime).getTime()) / 60000,
      );
      await this.prisma.taskBreak.update({
        where: { id: openBreak.id },
        data: { endTime: new Date(), duration: durationMinutes },
      });
    }

    const now = new Date();
    const totalBreakMinutes = await this.computeTotalBreakMinutes(openLog.id);
    const grossMinutes = Math.round(
      (now.getTime() - new Date(openLog.sessionStart).getTime()) / 60000,
    );
    const actualDuration = Math.max(0, grossMinutes - totalBreakMinutes);

    return this.prisma.taskTimeLog.update({
      where: { id: openLog.id },
      data: { sessionEnd: now, status: 'completed', actualDuration },
    });
  }

  // ─── Reporting ──────────────────────────────────────────────────────────────

  async getMyTimeLogs(employeeId: number) {
    const logs = await this.prisma.taskTimeLog.findMany({
      where: { employeeId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            allocatedMinutes: true,
            personStatus: true,
          },
        },
        taskBreaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });

    return logs.map((log) => ({
      ...log,
      elapsedSeconds: this.computeElapsedSeconds(log),
    }));
  }

  async getTaskTimeLogs(taskId: number) {
    return this.prisma.taskTimeLog.findMany({
      where: { taskId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        taskBreaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });
  }

  // Admin: all employee time summaries
  async getAdminTimeReport(fromDate?: Date, toDate?: Date) {
    const where: any = {};
    if (fromDate || toDate) {
      where.sessionStart = {};
      if (fromDate) where.sessionStart.gte = fromDate;
      if (toDate) where.sessionStart.lte = toDate;
    }

    const logs = await this.prisma.taskTimeLog.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        task: {
          select: {
            id: true,
            title: true,
            allocatedMinutes: true,
            personStatus: true,
          },
        },
        taskBreaks: true,
      },
      orderBy: { sessionStart: 'desc' },
    });

    // Group by employee
    const byEmployee = new Map<number, any>();
    for (const log of logs) {
      const emp = log.employee;
      if (!byEmployee.has(emp.id)) {
        byEmployee.set(emp.id, {
          employee: emp,
          totalAllocatedMinutes: 0,
          totalActualMinutes: 0,
          tasks: new Map<number, any>(),
        });
      }
      const entry = byEmployee.get(emp.id);
      entry.totalAllocatedMinutes += log.allocatedDuration;

      const actual =
        log.status === 'completed'
          ? log.actualDuration
          : Math.max(
              0,
              Math.round(
                (Date.now() - new Date(log.sessionStart).getTime()) / 60000,
              ) - log.taskBreaks.reduce((s, b) => s + b.duration, 0),
            );
      entry.totalActualMinutes += actual;

      const taskKey = log.task.id;
      if (!entry.tasks.has(taskKey)) {
        entry.tasks.set(taskKey, {
          task: log.task,
          allocatedMinutes: log.task.allocatedMinutes ?? 0,
          actualMinutes: 0,
          sessions: [],
        });
      }
      const taskEntry = entry.tasks.get(taskKey);
      taskEntry.actualMinutes += actual;
      taskEntry.sessions.push({
        id: log.id,
        start: log.sessionStart,
        end: log.sessionEnd,
        status: log.status,
        actualMinutes: actual,
      });
    }

    return Array.from(byEmployee.values()).map((e) => ({
      employee: e.employee,
      totalAllocatedMinutes: e.totalAllocatedMinutes,
      totalActualMinutes: e.totalActualMinutes,
      efficiency:
        e.totalAllocatedMinutes > 0
          ? Math.round((e.totalAllocatedMinutes / e.totalActualMinutes) * 100)
          : null,
      tasks: Array.from(e.tasks.values()),
    }));
  }

  // ─── Task Operations ────────────────────────────────────────────────────────

  async getOperations(taskId: number) {
    return this.prisma.taskOperation.findMany({
      where: { taskId },
      orderBy: { order: 'asc' },
    });
  }

  async createOperation(dto: CreateTaskOperationDto, adminId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });
    if (!task) throw new NotFoundException('Task not found');

    const maxOrder = await this.prisma.taskOperation.findFirst({
      where: { taskId: dto.taskId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.taskOperation.create({
      data: {
        taskId: dto.taskId,
        title: dto.title,
        description: dto.description,
        order: dto.order ?? (maxOrder ? maxOrder.order + 1 : 0),
      },
    });
  }

  async deleteOperation(operationId: number) {
    const op = await this.prisma.taskOperation.findUnique({ where: { id: operationId } });
    if (!op) throw new NotFoundException('Operation not found');
    return this.prisma.taskOperation.delete({ where: { id: operationId } });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async computeTotalBreakMinutes(timeLogId: number): Promise<number> {
    const breaks = await this.prisma.taskBreak.findMany({
      where: { timeLogId, endTime: { not: null } },
    });
    return breaks.reduce((sum, b) => sum + b.duration, 0);
  }

  private computeElapsedSeconds(log: {
    sessionStart: Date;
    sessionEnd: Date | null;
    status: string;
    taskBreaks: { duration: number; endTime: Date | null }[];
  }): number {
    const end = log.sessionEnd ? new Date(log.sessionEnd) : new Date();
    const grossSeconds = Math.round(
      (end.getTime() - new Date(log.sessionStart).getTime()) / 1000,
    );
    const breakSeconds =
      log.taskBreaks.reduce(
        (sum, b) => sum + (b.endTime ? b.duration * 60 : 0),
        0,
      );
    return Math.max(0, grossSeconds - breakSeconds);
  }
}
