import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  private computeDeadline(completeBy: string, createdAt: Date): Date {
    const deadline = new Date(createdAt);
    switch (completeBy) {
      case 'TODAY':
        deadline.setHours(23, 59, 59, 999);
        break;
      case 'TOMORROW':
        deadline.setDate(deadline.getDate() + 1);
        deadline.setHours(23, 59, 59, 999);
        break;
      case 'WITHIN_3_DAYS':
        deadline.setDate(deadline.getDate() + 3);
        deadline.setHours(23, 59, 59, 999);
        break;
      case 'WITHIN_7_DAYS':
        deadline.setDate(deadline.getDate() + 7);
        deadline.setHours(23, 59, 59, 999);
        break;
    }
    return deadline;
  }

  computeAlert(task: {
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

    if (task.personStatus === 'IN_PROGRESS') {
      return isOverdue ? 'UNDER_PROCESS_TIMEOUT' : 'UNDER_PROCESS_IN_TIME';
    }

    if (task.personStatus === 'STUCK') {
      return isOverdue ? 'STUCK_WITH_TIMEOUT' : 'STUCK_IN_TIME';
    }

    // NOT_STARTED
    return isOverdue ? 'NOT_START_YET_TIMEOUT' : 'NOT_START_YET_IN_TIME';
  }

  async create(dto: CreateTaskDto, allottedFromId: number) {
    const now = new Date();
    const deadline = this.computeDeadline(dto.completeBy, now);

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        cabin: dto.cabin,
        taskDetail: dto.taskDetail,
        completeBy: dto.completeBy,
        deadline,
        note: dto.note,
        assignedToId: dto.assignedToId,
        allottedFromId,
        alert: 'NOT_START_YET_IN_TIME',
      },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        allottedFrom: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Save initial note to history if provided
    if (dto.note) {
      await this.prisma.taskNoteHistory.create({
        data: { taskId: task.id, note: dto.note, authorId: allottedFromId },
      });
    }

    return task;
  }

  async findAll(filters?: {
    assignedToId?: number;
    personStatus?: string;
    hideDone?: boolean;
  }) {
    const where: any = {};

    if (filters?.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters?.personStatus) where.personStatus = filters.personStatus;
    if (filters?.hideDone) {
      where.NOT = {
        AND: [{ personStatus: 'DONE' }, { qcCheck: 'DONE' }],
      };
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        allottedFrom: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Recompute alerts dynamically
    return tasks.map((task) => ({
      ...task,
      alert: this.computeAlert(task),
    }));
  }

  async findOne(id: number) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        allottedFrom: {
          select: { id: true, name: true, email: true, role: true },
        },
        documents: {
          include: { uploadedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return { ...task, alert: this.computeAlert(task) };
  }

  async update(id: number, dto: UpdateTaskDto, authorId?: number) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Task not found');

    const data: any = { ...dto };

    // Recalculate deadline if completeBy changes
    if (dto.completeBy) {
      data.deadline = this.computeDeadline(dto.completeBy, existing.createdAt);
    }

    // Set updatedBy timestamp when person status changes
    if (dto.personStatus && dto.personStatus !== existing.personStatus) {
      data.updatedBy = new Date();
    }

    // Save note to history if note changed
    if (dto.note !== undefined && dto.note !== existing.note && authorId) {
      await this.prisma.taskNoteHistory.create({
        data: {
          taskId: id,
          note: dto.note,
          authorId,
        },
      });
    }

    const task = await this.prisma.task.update({
      where: { id },
      data,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        allottedFrom: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    return { ...task, alert: this.computeAlert(task) };
  }

  async remove(id: number) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Task not found');
    return this.prisma.task.delete({ where: { id } });
  }

  async createNote(taskId: number, note: string, authorId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    return this.prisma.taskNoteHistory.create({
      data: { taskId, note, authorId },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async findNoteHistory(taskId: number) {
    return this.prisma.taskNoteHistory.findMany({
      where: { taskId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSummary() {
    const tasks = await this.prisma.task.findMany({
      include: {
        assignedTo: { select: { id: true, name: true } },
        allottedFrom: { select: { id: true, name: true } },
      },
    });

    const tasksWithAlerts = tasks.map((t) => ({
      ...t,
      alert: this.computeAlert(t),
    }));

    // Group pending tasks by person
    const pendingByPerson: Record<
      number,
      { name: string; pendingCount: number; taskIds: number[] }
    > = {};

    for (const task of tasksWithAlerts) {
      if (task.personStatus !== 'DONE' || task.qcCheck !== 'DONE') {
        const uid = task.assignedToId;
        if (uid === null || !task.assignedTo) continue;
        if (!pendingByPerson[uid]) {
          pendingByPerson[uid] = {
            name: task.assignedTo.name,
            pendingCount: 0,
            taskIds: [],
          };
        }
        pendingByPerson[uid].pendingCount++;
        pendingByPerson[uid].taskIds.push(task.id);
      }
    }

    const totalTasks = tasks.length;
    const doneTasks = tasksWithAlerts.filter(
      (t) => t.personStatus === 'DONE' && t.qcCheck === 'DONE',
    ).length;
    const inProgressTasks = tasksWithAlerts.filter(
      (t) => t.personStatus === 'IN_PROGRESS',
    ).length;
    const issueTasks = tasksWithAlerts.filter(
      (t) => t.qcCheck === 'ISSUE',
    ).length;

    return {
      totalTasks,
      doneTasks,
      inProgressTasks,
      issueTasks,
      pendingByPerson: Object.values(pendingByPerson),
    };
  }
}
