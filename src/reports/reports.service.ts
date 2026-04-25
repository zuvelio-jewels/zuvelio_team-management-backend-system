import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserReportStats {
  userId: number;
  userName: string;
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  stuck: number;
  rework: number;
  completedOnTime: number;
  completedLate: number;
  onTimeRate: number; // percentage
  taskBreakdown: {
    id: number;
    title: string;
    taskDetail: string;
    cabin: string;
    personStatus: string;
    qcCheck: string | null;
    alert: string;
    createdAt: Date;
    deadline: Date | null;
    updatedBy: Date | null;
    completeBy: string;
  }[];
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private computeAlert(task: {
    personStatus: string;
    deadline: Date | null;
    updatedBy: Date | null;
    qcCheck: string | null;
  }): string {
    const now = new Date();
    const deadline = task.deadline ? new Date(task.deadline) : null;
    const isOverdue = deadline ? now > deadline : false;

    if (task.qcCheck === 'ISSUE') return 'RE_WORK';
    if (task.personStatus === 'DONE') {
      if (task.updatedBy && deadline) {
        return new Date(task.updatedBy) <= deadline
          ? 'COMPLETE_IN_TIME'
          : 'LATE_COMPLETE_WITH_TIMEOUT';
      }
      return 'COMPLETE_IN_TIME';
    }
    if (task.personStatus === 'IN_PROGRESS')
      return isOverdue ? 'UNDER_PROCESS_TIMEOUT' : 'UNDER_PROCESS_IN_TIME';
    if (task.personStatus === 'STUCK')
      return isOverdue ? 'STUCK_WITH_TIMEOUT' : 'STUCK_IN_TIME';
    return isOverdue ? 'NOT_START_YET_TIMEOUT' : 'NOT_START_YET_IN_TIME';
  }

  /** Report for a single user (self) */
  async getUserReport(
    userId: number,
    from?: string,
    to?: string,
  ): Promise<UserReportStats> {
    const where: any = { assignedToId: userId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const user =
      tasks[0]?.assignedTo ??
      (await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true },
      }));

    return this.computeStats(userId, user?.name ?? 'Unknown', tasks);
  }

  /** Report for all users (admin view) */
  async getAllUsersReport(
    from?: string,
    to?: string,
  ): Promise<UserReportStats[]> {
    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Group by assignedToId
    const byUser = new Map<number, { name: string; tasks: typeof tasks }>();
    for (const task of tasks) {
      const uid = task.assignedToId;
      if (!byUser.has(uid)) {
        byUser.set(uid, { name: task.assignedTo.name, tasks: [] });
      }
      byUser.get(uid)!.tasks.push(task);
    }

    const results: UserReportStats[] = [];
    for (const [uid, { name, tasks: userTasks }] of byUser) {
      results.push(this.computeStats(uid, name, userTasks));
    }

    return results.sort((a, b) => b.total - a.total);
  }

  private computeStats(
    userId: number,
    userName: string,
    tasks: any[],
  ): UserReportStats {
    const tasksWithAlert = tasks.map((t) => ({
      ...t,
      alert: this.computeAlert(t),
    }));

    const done = tasksWithAlert.filter((t) => t.personStatus === 'DONE').length;
    const inProgress = tasksWithAlert.filter(
      (t) => t.personStatus === 'IN_PROGRESS',
    ).length;
    const notStarted = tasksWithAlert.filter(
      (t) => t.personStatus === 'NOT_STARTED',
    ).length;
    const stuck = tasksWithAlert.filter(
      (t) => t.personStatus === 'STUCK',
    ).length;
    const rework = tasksWithAlert.filter((t) => t.alert === 'RE_WORK').length;
    const completedOnTime = tasksWithAlert.filter(
      (t) => t.alert === 'COMPLETE_IN_TIME',
    ).length;
    const completedLate = tasksWithAlert.filter(
      (t) => t.alert === 'LATE_COMPLETE_WITH_TIMEOUT',
    ).length;
    const onTimeRate =
      done > 0 ? Math.round((completedOnTime / done) * 100) : 0;

    return {
      userId,
      userName,
      total: tasks.length,
      done,
      inProgress,
      notStarted,
      stuck,
      rework,
      completedOnTime,
      completedLate,
      onTimeRate,
      taskBreakdown: tasksWithAlert.map((t) => ({
        id: t.id,
        title: t.title,
        taskDetail: t.taskDetail,
        cabin: t.cabin,
        personStatus: t.personStatus,
        qcCheck: t.qcCheck,
        alert: t.alert,
        createdAt: t.createdAt,
        deadline: t.deadline,
        updatedBy: t.updatedBy,
        completeBy: t.completeBy,
      })),
    };
  }
}
