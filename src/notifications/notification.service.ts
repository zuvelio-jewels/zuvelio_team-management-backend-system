import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  // Create a new notification
  async createNotification(
    projectionId: number,
    employeeId: number,
    type: string,
    title: string,
    message: string,
    actionUrl?: string,
  ) {
    return this.prisma.notification.create({
      data: {
        projectionId,
        employeeId,
        type,
        title,
        message,
        actionUrl,
      },
    });
  }

  // Get notifications for an employee
  async getEmployeeNotifications(
    employeeId: number,
    filters?: {
      isRead?: boolean;
      isDismissed?: boolean;
      limit?: number;
    },
  ) {
    const where: any = { employeeId };

    if (filters?.isRead !== undefined) where.isRead = filters.isRead;
    if (filters?.isDismissed !== undefined)
      where.isDismissed = filters.isDismissed;

    return this.prisma.notification.findMany({
      where,
      include: {
        projection: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
    });
  }

  // Get unread notification count
  async getUnreadCount(employeeId: number) {
    return this.prisma.notification.count({
      where: {
        employeeId,
        isRead: false,
        isDismissed: false,
      },
    });
  }

  // Mark notification as read
  async markAsRead(notificationId: number, employeeId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.employeeId !== employeeId) {
      throw new Error('This notification is not for you');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  // Dismiss notification
  async dismissNotification(notificationId: number, employeeId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.employeeId !== employeeId) {
      throw new Error('This notification is not for you');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isDismissed: true,
        dismissedAt: new Date(),
      },
    });
  }

  // Mark all notifications as read
  async markAllAsRead(employeeId: number) {
    return this.prisma.notification.updateMany({
      where: {
        employeeId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  // Get notification by ID
  async getById(notificationId: number) {
    return this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        projection: {
          select: {
            id: true,
            title: true,
            status: true,
            allocatedMinutes: true,
          },
        },
        employee: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  // Delete notification
  async deleteNotification(notificationId: number) {
    return this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  // Clear dismissed notifications older than X days
  async clearOldDismissedNotifications(daysOld: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return this.prisma.notification.deleteMany({
      where: {
        isDismissed: true,
        dismissedAt: {
          lt: cutoffDate,
        },
      },
    });
  }
}
