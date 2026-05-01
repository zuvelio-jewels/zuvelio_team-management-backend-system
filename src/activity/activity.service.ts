import {
  Injectable,
  Logger,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { CreateActivityEventDto, GetActivitySummaryDto } from './dto';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private eventBuffer: Map<
    number,
    Array<{
      eventType: string;
      keyCode?: string;
      mouseX?: number;
      mouseY?: number;
      clickType?: string;
      taskId?: number;
      sessionId?: string;
      timestamp: Date;
    }>
  > = new Map();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    // Flush event buffer every 10 seconds
    setInterval(() => this.flushEventBuffer(), 10000);
  }

  /**
   * Log a single activity event (keyboard or mouse)
   * Events are buffered and flushed periodically to reduce database writes
   */
  async logActivityEvent(
    userId: number,
    createActivityDto: CreateActivityEventDto,
  ) {
    try {
      const canAcceptEvent = await this.canAcceptActivityEvent(userId);
      if (!canAcceptEvent) {
        return { success: false, reason: 'Monitoring not active' };
      }

      this.bufferActivityEvents(userId, [createActivityDto]);

      // Update lastActivityAt
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastActivityAt: new Date() },
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Error logging activity for user ${userId}:`, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async logActivityBatch(
    userId: number,
    activityEvents: CreateActivityEventDto[],
  ) {
    try {
      if (!activityEvents.length) {
        return { success: true, acceptedEvents: 0 };
      }

      const canAcceptEvent = await this.canAcceptActivityEvent(userId);
      if (!canAcceptEvent) {
        return {
          success: false,
          reason: 'Monitoring not active',
          acceptedEvents: 0,
        };
      }

      this.bufferActivityEvents(userId, activityEvents);

      await this.prisma.user.update({
        where: { id: userId },
        data: { lastActivityAt: new Date() },
      });

      return { success: true, acceptedEvents: activityEvents.length };
    } catch (error) {
      this.logger.error(
        `Error logging activity batch for user ${userId}:`,
        error,
      );
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message, acceptedEvents: 0 };
    }
  }

  private bufferActivityEvents(
    userId: number,
    activityEvents: CreateActivityEventDto[],
  ) {
    if (!this.eventBuffer.has(userId)) {
      this.eventBuffer.set(userId, []);
    }

    const buffer = this.eventBuffer.get(userId);
    if (!buffer) {
      return;
    }

    const now = new Date();
    for (const activityEvent of activityEvents) {
      buffer.push({
        eventType: activityEvent.eventType,
        keyCode: activityEvent.keyCode,
        mouseX: activityEvent.mouseX,
        mouseY: activityEvent.mouseY,
        clickType: activityEvent.clickType,
        taskId: activityEvent.taskId,
        sessionId: activityEvent.sessionId,
        timestamp: now,
      });
    }
  }

  private async canAcceptActivityEvent(userId: number): Promise<boolean> {
    const config = await this.getOrCreateMonitoringConfig(userId);
    // Accept events whenever the PC is on and monitoring is enabled.
    // No working-hours gate — online/offline is determined by PC activity, not time.
    return config.isMonitoringEnabled;
  }

  private isWithinWorkingHours(
    startWorkHour: number,
    endWorkHour: number,
    timezoneOffsetHours = 0,
  ): boolean {
    const utcHour = new Date().getUTCHours();
    const localHour = (utcHour + timezoneOffsetHours + 24) % 24;
    return localHour >= startWorkHour && localHour < endWorkHour;
  }

  /**
   * Check if current time is within working hours (inclusive of end hour)
   * Used for dashboard status display
   */
  private isWithinWorkingHoursInclusive(
    startWorkHour: number,
    endWorkHour: number,
    timezoneOffsetHours = 0,
  ): boolean {
    const utcHour = new Date().getUTCHours();
    const localHour = (utcHour + timezoneOffsetHours + 24) % 24;
    return localHour >= startWorkHour && localHour <= endWorkHour;
  }

  private async getOrCreateMonitoringConfig(userId: number) {
    let config = await this.prisma.monitoringConfig.findUnique({
      where: { userId },
    });

    if (!config) {
      config = await this.prisma.monitoringConfig.create({
        data: {
          userId,
          isMonitoringEnabled: true,
          startWorkHour: 9,
          endWorkHour: 18,
          idleThresholdMinutes: 5,
          timezoneOffsetHours: 5,
        },
      });
    }

    return config;
  }

  /**
   * Flush buffered events to database
   * Called periodically by interval
   */
  private async flushEventBuffer() {
    for (const [userId, events] of this.eventBuffer.entries()) {
      if (events.length === 0) continue;

      try {
        await this.prisma.activityEvent.createMany({
          data: events.map((event) => ({
            userId,
            eventType: event.eventType,
            keyCode: event.keyCode,
            mouseX: event.mouseX,
            mouseY: event.mouseY,
            clickType: event.clickType,
            taskId: event.taskId,
            sessionId: event.sessionId,
            timestamp: event.timestamp,
          })),
          skipDuplicates: false,
        });

        this.eventBuffer.delete(userId);
      } catch (error) {
        this.logger.error(`Error flushing events for user ${userId}:`, error);
      }
    }
  }

  /**
   * Check if monitoring should be active for a user
   * Respects monitoring enabled flag and working hours only.
   * Idle time is intentionally NOT checked here — idle state does not
   * mean monitoring is disabled; it only gates event acceptance.
   */
  async isMonitoringActive(userId: number): Promise<boolean> {
    try {
      const config = await this.getOrCreateMonitoringConfig(userId);
      // Monitoring is active as long as it's enabled — no time restriction.
      // The PC being on = active; PC off = no data = shown as offline.
      return config.isMonitoringEnabled;
    } catch (error) {
      this.logger.error(
        `Error checking monitoring status for user ${userId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get aggregated activity summary for a user
   */
  async getActivitySummary(
    userId: number,
    currentUserId: number,
    query: GetActivitySummaryDto,
  ) {
    // Authorization: user can only see their own data
    if (userId !== currentUserId) {
      throw new ForbiddenException(
        'Cannot access activity data of other users',
      );
    }

    const { startDate, endDate } = query;

    try {
      const summaries = await this.prisma.activitySummary.findMany({
        where: {
          userId,
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        orderBy: { date: 'desc' },
      });

      return summaries;
    } catch (error) {
      this.logger.error(
        `Error fetching activity summary for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get team activity for a manager
   * Managers can see activity of their subordinates (future: based on department/team)
   */
  async getTeamActivity(managerId: number, query: GetActivitySummaryDto) {
    try {
      const manager = await this.prisma.user.findUnique({
        where: { id: managerId },
      });

      // Only managers and admins can access team activity
      if (
        !manager ||
        (manager.role !== 'MANAGER' && manager.role !== 'ADMIN')
      ) {
        throw new ForbiddenException(
          'Only managers and admins can access team activity',
        );
      }

      const { startDate, endDate } = query;

      // For now, return all EMPLOYEE activities during the date range
      // TODO: Implement department/team filtering
      const teamActivity = await this.prisma.activitySummary.findMany({
        where: {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
          user: {
            role: 'EMPLOYEE',
          },
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }],
      });

      return teamActivity;
    } catch (error) {
      this.logger.error(
        `Error fetching team activity for manager ${managerId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get today's activity dashboard data for current user
   */
  async getTodayActivityDashboard(userId: number) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Read live events for today's dashboard so the UI updates immediately
      const todayEvents = await this.prisma.activityEvent.findMany({
        where: {
          userId,
          timestamp: {
            gte: today,
            lt: tomorrow,
          },
        },
        select: {
          eventType: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'asc' },
      });

      const bufferedEvents = (this.eventBuffer.get(userId) ?? []).filter(
        (event) => event.timestamp >= today && event.timestamp < tomorrow,
      );

      const allTodayEvents = [
        ...todayEvents.map((event) => ({
          eventType: event.eventType,
          timestamp: event.timestamp,
        })),
        ...bufferedEvents.map((event) => ({
          eventType: event.eventType,
          timestamp: event.timestamp,
        })),
      ];

      const hourlySummaries = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        totalKeystrokes: 0,
        totalClicks: 0,
        totalMouseMovement: 0,
        idleTimeMinutes: 0,
      }));

      for (const event of allTodayEvents) {
        const eventHour = new Date(event.timestamp).getHours();
        const bucket = hourlySummaries[eventHour];

        if (!bucket) {
          continue;
        }

        if (event.eventType === 'KEYPRESS') {
          bucket.totalKeystrokes += 1;
        }

        if (event.eventType === 'CLICK') {
          bucket.totalClicks += 1;
        }

        if (event.eventType === 'MOUSE_MOVE') {
          bucket.totalMouseMovement += 1;
        }
      }

      const todaySummaries = hourlySummaries.filter(
        (summary) =>
          summary.totalKeystrokes > 0 ||
          summary.totalClicks > 0 ||
          summary.totalMouseMovement > 0 ||
          summary.idleTimeMinutes > 0,
      );

      // Get current monitoring status
      const monitoringActive = await this.isMonitoringActive(userId);

      // Get user's monitoring config
      const config = await this.prisma.monitoringConfig.findUnique({
        where: { userId },
      });

      return {
        date: today,
        summaries: todaySummaries,
        totalKeystrokes: todaySummaries.reduce(
          (sum, s) => sum + s.totalKeystrokes,
          0,
        ),
        totalClicks: todaySummaries.reduce((sum, s) => sum + s.totalClicks, 0),
        totalIdleMinutes: todaySummaries.reduce(
          (sum, s) => sum + s.idleTimeMinutes,
          0,
        ),
        monitoringActive,
        workingHours: config
          ? { start: config.startWorkHour, end: config.endWorkHour }
          : { start: 9, end: 18 },
      };
    } catch (error) {
      this.logger.error(
        `Error fetching dashboard data for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get monitoring configuration for a user
   */
  async getMonitoringConfig(userId: number) {
    try {
      return this.getOrCreateMonitoringConfig(userId);
    } catch (error) {
      this.logger.error(
        `Error fetching monitoring config for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update monitoring configuration (admin/manager only)
   */
  async updateMonitoringConfig(
    userId: number,
    currentUserId: number,
    currentUserRole: string,
    updateData: {
      isMonitoringEnabled?: boolean;
      startWorkHour?: number;
      endWorkHour?: number;
      idleThresholdMinutes?: number;
    },
  ) {
    try {
      // Check authorization
      if (currentUserRole !== 'ADMIN') {
        throw new ForbiddenException(
          'Only admins can update monitoring configuration',
        );
      }

      const config = await this.prisma.monitoringConfig.upsert({
        where: { userId },
        update: {
          ...updateData,
          updatedAt: new Date(),
        },
        create: {
          userId,
          ...updateData,
          createdBy: currentUserId,
        },
      });

      return config;
    } catch (error) {
      this.logger.error(
        `Error updating monitoring config for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Scheduled job to aggregate hourly statistics from events
   * Should be called every hour by a scheduler
   */
  async aggregateHourlyStats() {
    try {
      this.logger.debug('Starting hourly activity aggregation...');

      // Get the previous hour
      const now = new Date();
      const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
      lastHour.setMinutes(0, 0, 0);

      const nextHour = new Date(lastHour.getTime() + 60 * 60 * 1000);

      // Get all events from the last hour
      const events = await this.prisma.activityEvent.findMany({
        where: {
          timestamp: {
            gte: lastHour,
            lt: nextHour,
          },
        },
      });

      // Group events by user and task
      const groupedByUserTask = new Map<
        string,
        { userId: number; taskId: number | null | undefined; events: any[] }
      >();

      for (const event of events) {
        const key = `${event.userId}_${event.taskId || 'none'}`;
        if (!groupedByUserTask.has(key)) {
          groupedByUserTask.set(key, {
            userId: event.userId,
            taskId: event.taskId || undefined,
            events: [],
          });
        }
        const group = groupedByUserTask.get(key);
        if (group) {
          group.events.push(event);
        }
      }

      // Cache idle thresholds per user to avoid repeated DB hits
      const idleThresholdCache = new Map<number, number>();

      // Create summaries
      for (const [_, group] of groupedByUserTask) {
        const keystrokes = group.events.filter(
          (e) => e.eventType === 'KEYPRESS',
        ).length;
        const clicks = group.events.filter(
          (e) => e.eventType === 'CLICK',
        ).length;
        const mouseMovement = group.events.filter(
          (e) => e.eventType === 'MOUSE_MOVE',
        ).length;

        // Calculate idle time: sum of gaps between consecutive events that exceed the idle threshold
        let idleThresholdMs = 5 * 60 * 1000; // default 5 min
        if (!idleThresholdCache.has(group.userId)) {
          const config = await this.prisma.monitoringConfig.findUnique({
            where: { userId: group.userId },
            select: { idleThresholdMinutes: true },
          });
          const thresholdMin = config?.idleThresholdMinutes ?? 5;
          idleThresholdCache.set(group.userId, thresholdMin * 60 * 1000);
        }
        idleThresholdMs = idleThresholdCache.get(group.userId)!;

        let idleTimeMinutes = 0;
        if (group.events.length > 1) {
          const sorted = group.events
            .map((e) => new Date(e.timestamp).getTime())
            .sort((a, b) => a - b);
          let idleMs = 0;
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i] - sorted[i - 1];
            if (gap >= idleThresholdMs) {
              idleMs += gap;
            }
          }
          idleTimeMinutes = Math.round(idleMs / 60000);
        }

        const taskIdForUpsert = group.taskId ?? null;

        const whereClause: any = {
          userId: group.userId,
          date: lastHour,
          hour: lastHour.getHours(),
          taskId: taskIdForUpsert,
        };

        await this.prisma.activitySummary.upsert({
          where: {
            userId_date_hour_taskId: whereClause,
          },
          update: {
            totalKeystrokes: keystrokes,
            totalClicks: clicks,
            totalMouseMovement: mouseMovement,
            idleTimeMinutes,
          },
          create: {
            userId: group.userId,
            date: lastHour,
            hour: lastHour.getHours(),
            taskId: group.taskId,
            totalKeystrokes: keystrokes,
            totalClicks: clicks,
            totalMouseMovement: mouseMovement,
            idleTimeMinutes,
          },
        });
      }

      this.logger.debug(
        `Completed hourly aggregation. Processed ${events.length} events.`,
      );
    } catch (error) {
      this.logger.error('Error during hourly aggregation:', error);
    }
  }

  // ─── Device Token Management ───────────────────────────────────────────────

  private async createDeviceTokenForUser(userId: number, deviceName?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    const device = await this.prisma.deviceToken.create({
      data: { token, userId, deviceName: deviceName ?? `Device-${Date.now()}` },
    });

    return {
      id: device.id,
      token: device.token,
      userId: device.userId,
      deviceName: device.deviceName,
      createdAt: device.createdAt,
    };
  }

  async registerDevice(
    adminId: number,
    adminRole: string,
    userId: number,
    deviceName?: string,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can register devices',
      );
    }

    return this.createDeviceTokenForUser(userId, deviceName);
  }

  async registerSelfDevice(userId: number, deviceName?: string) {
    return this.createDeviceTokenForUser(userId, deviceName);
  }

  async authenticateWithDeviceToken(token: string) {
    const device = await this.prisma.deviceToken.findUnique({
      where: { token },
    });
    if (!device || device.isRevoked) {
      throw new UnauthorizedException('Invalid or revoked device token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: device.userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is disabled');
    }

    await this.prisma.deviceToken.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '8h' });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async revokeDeviceToken(adminRole: string, tokenId: number) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can revoke device tokens',
      );
    }
    const device = await this.prisma.deviceToken.findUnique({
      where: { id: tokenId },
    });
    if (!device) throw new NotFoundException('Device token not found');

    await this.prisma.deviceToken.update({
      where: { id: tokenId },
      data: { isRevoked: true },
    });
    return { success: true, message: 'Device token revoked' };
  }

  async listDeviceTokens(adminRole: string, userId?: number) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can list device tokens',
      );
    }
    return this.prisma.deviceToken.findMany({
      where: userId ? { userId } : {},
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Admin Employee Management ─────────────────────────────────────────────

  /**
   * Get a single employee's full profile (admin view)
   */
  async getAdminEmployeeProfile(adminRole: string, targetUserId: number) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException('Only admins and managers can access employee profiles');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isMonitoringEnabled: true,
        lastActivityAt: true,
        createdAt: true,
        monitoringConfig: {
          select: {
            isMonitoringEnabled: true,
            startWorkHour: true,
            endWorkHour: true,
            idleThresholdMinutes: true,
            timezoneOffsetHours: true,
          },
        },
        deviceTokens: {
          where: { isRevoked: false },
          select: { id: true, deviceName: true, lastUsedAt: true, createdAt: true },
        },
      },
    });
    if (!user) throw new NotFoundException(`User ${targetUserId} not found`);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return { ...user, isOnline: user.lastActivityAt ? user.lastActivityAt > fiveMinutesAgo : false };
  }

  /**
   * Get date-range activity summary for any employee (admin only)
   */
  async getAdminEmployeeSummary(targetUserId: number, query: GetActivitySummaryDto) {
    const { startDate, endDate } = query;
    return this.prisma.activitySummary.findMany({
      where: {
        userId: targetUserId,
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: [{ date: 'asc' }, { hour: 'asc' }],
    });
  }

  async getAdminEmployeeList(adminRole: string) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can access employee list',
      );
    }

    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isMonitoringEnabled: true,
        lastActivityAt: true,
        monitoringConfig: {
          select: {
            isMonitoringEnabled: true,
            startWorkHour: true,
            endWorkHour: true,
            idleThresholdMinutes: true,
          },
        },
        deviceTokens: {
          where: { isRevoked: false },
          select: {
            id: true,
            deviceName: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    return users.map((u) => ({
      ...u,
      isOnline: u.lastActivityAt ? u.lastActivityAt > fiveMinutesAgo : false,
    }));
  }

  async toggleEmployeeMonitoring(
    adminRole: string,
    targetUserId: number,
    enabled: boolean,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can toggle monitoring',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) throw new NotFoundException(`User ${targetUserId} not found`);

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isMonitoringEnabled: enabled },
    });

    await this.prisma.monitoringConfig.upsert({
      where: { userId: targetUserId },
      update: { isMonitoringEnabled: enabled },
      create: { userId: targetUserId, isMonitoringEnabled: enabled },
    });

    return {
      success: true,
      userId: targetUserId,
      isMonitoringEnabled: enabled,
    };
  }
}
