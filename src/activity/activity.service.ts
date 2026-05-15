import {
  Injectable,
  Logger,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { CreateActivityEventDto, GetActivitySummaryDto } from './dto';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private readonly MIN_IDLE_THRESHOLD_MINUTES = 10;
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
      activeWindow?: string;
      timestamp: Date;
    }>
  > = new Map();

  /**
   * In-memory cache for MonitoringConfig records.
   * Avoids a DB query on every single event batch.
   * Entries expire after CONFIG_CACHE_TTL_MS and are invalidated immediately
   * whenever the config is updated or monitoring is toggled.
   */
  private configCache = new Map<number, { config: any; expiresAt: number }>();
  private readonly CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      // Always stamp lastActivityAt first so the user's online status stays
      // accurate even when event collection (monitoring) is disabled.
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastActivityAt: new Date() },
      });

      const canAcceptEvent = await this.canAcceptActivityEvent(userId);
      if (!canAcceptEvent) {
        return { success: false, reason: 'Monitoring not active' };
      }

      this.bufferActivityEvents(userId, [createActivityDto]);
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

      // Always stamp lastActivityAt first so the user's online status stays
      // accurate even when event collection (monitoring) is disabled.
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastActivityAt: new Date() },
      });

      const canAcceptEvent = await this.canAcceptActivityEvent(userId);
      if (!canAcceptEvent) {
        return {
          success: false,
          reason: 'Monitoring not active',
          acceptedEvents: 0,
        };
      }

      this.bufferActivityEvents(userId, activityEvents);
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

    const receivedAt = new Date();
    for (const activityEvent of activityEvents) {
      // Use the agent-supplied timestamp when available so idle-time
      // calculations reflect the actual event time, not the batch-receive time.
      let eventTimestamp: Date;
      if (activityEvent.timestamp) {
        const parsed = new Date(activityEvent.timestamp);
        eventTimestamp = isNaN(parsed.getTime()) ? receivedAt : parsed;
      } else {
        eventTimestamp = receivedAt;
      }

      buffer.push({
        eventType: activityEvent.eventType,
        keyCode: activityEvent.keyCode,
        mouseX: activityEvent.mouseX,
        mouseY: activityEvent.mouseY,
        clickType: activityEvent.clickType,
        taskId: activityEvent.taskId,
        sessionId: activityEvent.sessionId,
        activeWindow: activityEvent.activeWindow,
        timestamp: eventTimestamp,
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
    // Serve from cache when still fresh to avoid a DB round-trip on every batch.
    const cached = this.configCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config;
    }

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
          idleThresholdMinutes: this.MIN_IDLE_THRESHOLD_MINUTES,
          timezoneOffsetHours: 5,
        },
      });
    }

    this.configCache.set(userId, {
      config,
      expiresAt: Date.now() + this.CONFIG_CACHE_TTL_MS,
    });

    return config;
  }

  private getEffectiveIdleThresholdMs(
    configuredMinutes?: number | null,
  ): number {
    const thresholdMinutes = Math.max(
      this.MIN_IDLE_THRESHOLD_MINUTES,
      configuredMinutes ?? this.MIN_IDLE_THRESHOLD_MINUTES,
    );
    return thresholdMinutes * 60 * 1000;
  }

  /**
   * Flush buffered events to database
   * Called periodically by interval
   */
  private async flushEventBuffer() {
    for (const [userId, events] of this.eventBuffer.entries()) {
      if (events.length === 0) continue;

      // Drain the array atomically before the async DB write so that events
      // arriving concurrently during the write are NOT included in this batch
      // AND are NOT lost when we clear the buffer on success.
      const snapshot = events.splice(0);

      try {
        await this.prisma.activityEvent.createMany({
          data: snapshot.map((event) => ({
            userId,
            eventType: event.eventType,
            keyCode: event.keyCode,
            mouseX: event.mouseX,
            mouseY: event.mouseY,
            clickType: event.clickType,
            taskId: event.taskId,
            sessionId: event.sessionId,
            activeWindow: event.activeWindow,
            timestamp: event.timestamp,
          })),
          skipDuplicates: false,
        });

        // If the array is now empty (no new events arrived during the write),
        // remove the map entry to free memory.
        if (events.length === 0) {
          this.eventBuffer.delete(userId);
        }
      } catch (error) {
        this.logger.error(`Error flushing events for user ${userId}:`, error);
        // Return the snapshot to the front of the buffer so it will be retried
        // on the next flush cycle.
        events.unshift(...snapshot);
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

      // Return all users' activities during the date range (no role filter —
      // admins and managers should also appear in team activity view).
      const teamActivity = await this.prisma.activitySummary.findMany({
        where: {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate),
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
          activeWindow: true,
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
          activeWindow: event.activeWindow ?? undefined,
        })),
        ...bufferedEvents.map((event) => ({
          eventType: event.eventType,
          timestamp: event.timestamp,
          activeWindow: event.activeWindow,
        })),
      ];

      // Get user's monitoring config once and enforce a minimum 10-minute
      // inactivity window before idle minutes start accumulating.
      const config = await this.prisma.monitoringConfig.findUnique({
        where: { userId },
      });
      const idleThresholdMs = this.getEffectiveIdleThresholdMs(
        config?.idleThresholdMinutes,
      );

      const hourlySummaries = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        totalKeystrokes: 0,
        totalClicks: 0,
        totalMouseMovement: 0,
        idleTimeMinutes: 0,
        // activeWindow frequency map — collapsed to topApps[] before returning
        _appFreq: new Map<string, number>(),
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

        // Track active app frequency (use only the process name part after '|'
        // for a compact display; fall back to the full string when no pipe present)
        if (event.activeWindow) {
          const pipIdx = event.activeWindow.indexOf('|');
          const appKey =
            pipIdx >= 0
              ? event.activeWindow.slice(pipIdx + 1).trim()
              : event.activeWindow.trim();
          if (appKey) {
            bucket._appFreq.set(appKey, (bucket._appFreq.get(appKey) ?? 0) + 1);
          }
        }
      }

      const sortedTimestamps = allTodayEvents
        .map((event) => new Date(event.timestamp).getTime())
        .filter((ts) => Number.isFinite(ts))
        .sort((a, b) => a - b);

      const nowMs = Date.now();
      const todayStartMs = today.getTime();
      const todayEndMs = tomorrow.getTime();
      const rangeEndMs = Math.min(Math.max(nowMs, todayStartMs), todayEndMs);

      const addIdleInterval = (startMs: number, endMs: number) => {
        // Count only the part after the idle threshold, e.g. for a 10-minute
        // threshold a 16-minute gap contributes 6 idle minutes.
        const idleStartMs = startMs + idleThresholdMs;
        if (idleStartMs >= endMs) {
          return;
        }

        let cursor = idleStartMs;
        while (cursor < endMs) {
          const segmentStart = new Date(cursor);
          const hour = segmentStart.getHours();
          const nextHourMs = new Date(
            segmentStart.getFullYear(),
            segmentStart.getMonth(),
            segmentStart.getDate(),
            segmentStart.getHours() + 1,
            0,
            0,
            0,
          ).getTime();
          const segmentEnd = Math.min(endMs, nextHourMs);
          hourlySummaries[hour].idleTimeMinutes +=
            (segmentEnd - cursor) / 60000;
          cursor = segmentEnd;
        }
      };

      for (let i = 1; i < sortedTimestamps.length; i++) {
        addIdleInterval(sortedTimestamps[i - 1], sortedTimestamps[i]);
      }

      if (sortedTimestamps.length > 0) {
        addIdleInterval(
          sortedTimestamps[sortedTimestamps.length - 1],
          rangeEndMs,
        );
      }

      for (const summary of hourlySummaries) {
        summary.idleTimeMinutes = Math.max(
          0,
          Math.round(summary.idleTimeMinutes),
        );
      }

      // Resolve top apps per hour (top 3 by event count, strip internal _appFreq)
      const todaySummaries = hourlySummaries
        .filter(
          (summary) =>
            summary.totalKeystrokes > 0 ||
            summary.totalClicks > 0 ||
            summary.totalMouseMovement > 0 ||
            summary.idleTimeMinutes > 0,
        )
        .map(({ _appFreq, ...rest }) => ({
          ...rest,
          topApps: [..._appFreq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name]) => name),
        }));

      // Compute the true tracked window: from the very first event today to now.
      // This avoids the "summaries.length × 60" overcounting when the first
      // summary only covers a few minutes of an hour (e.g. agent started at 9:55).
      const firstEventMs =
        sortedTimestamps.length > 0 ? sortedTimestamps[0] : rangeEndMs;
      const trackedDurationMinutes = Math.round(
        (rangeEndMs - firstEventMs) / 60000,
      );

      // Get current monitoring status
      const monitoringActive = await this.isMonitoringActive(userId);

      return {
        date: today,
        summaries: todaySummaries,
        trackedDurationMinutes,
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

      const normalizedUpdateData = { ...updateData };
      if (normalizedUpdateData.idleThresholdMinutes !== undefined) {
        normalizedUpdateData.idleThresholdMinutes = Math.max(
          this.MIN_IDLE_THRESHOLD_MINUTES,
          normalizedUpdateData.idleThresholdMinutes,
        );
      }

      const config = await this.prisma.monitoringConfig.upsert({
        where: { userId },
        update: {
          ...normalizedUpdateData,
          updatedAt: new Date(),
        },
        create: {
          userId,
          ...normalizedUpdateData,
          createdBy: currentUserId,
        },
      });

      // Invalidate cache so the next request picks up the new config immediately.
      this.configCache.delete(userId);

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
   * Scheduled job to aggregate hourly statistics from events.
   * Runs at the top of every hour (e.g., 09:00, 10:00, ...) and processes
   * the PREVIOUS hour's raw ActivityEvent records into ActivitySummary rows.
   */
  @Cron(CronExpression.EVERY_HOUR)
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

        // Calculate idle time from no-activity gaps; idle starts only after
        // the threshold window has elapsed.
        let idleThresholdMs = this.getEffectiveIdleThresholdMs(null);
        if (!idleThresholdCache.has(group.userId)) {
          const config = await this.prisma.monitoringConfig.findUnique({
            where: { userId: group.userId },
            select: { idleThresholdMinutes: true },
          });
          idleThresholdCache.set(
            group.userId,
            this.getEffectiveIdleThresholdMs(config?.idleThresholdMinutes),
          );
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
              idleMs += gap - idleThresholdMs;
            }
          }

          // Include trailing inactivity in the processed hour up to hour end.
          const trailingGap = nextHour.getTime() - sorted[sorted.length - 1];
          if (trailingGap >= idleThresholdMs) {
            idleMs += trailingGap - idleThresholdMs;
          }

          idleTimeMinutes = Math.round(idleMs / 60000);
        }

        const taskIdForUpsert = group.taskId ?? null;

        // Use findFirst + update/create instead of upsert because PostgreSQL
        // treats NULL != NULL in unique-constraint conflict detection, so
        // prisma's upsert fails to detect the conflict when taskId is null.
        const existing = await this.prisma.activitySummary.findFirst({
          where: {
            userId: group.userId,
            date: lastHour,
            hour: lastHour.getHours(),
            taskId: taskIdForUpsert,
          },
        });

        if (existing) {
          await this.prisma.activitySummary.update({
            where: { id: existing.id },
            data: {
              totalKeystrokes: keystrokes,
              totalClicks: clicks,
              totalMouseMovement: mouseMovement,
              idleTimeMinutes,
            },
          });
        } else {
          await this.prisma.activitySummary.create({
            data: {
              userId: group.userId,
              date: lastHour,
              hour: lastHour.getHours(),
              taskId: taskIdForUpsert,
              totalKeystrokes: keystrokes,
              totalClicks: clicks,
              totalMouseMovement: mouseMovement,
              idleTimeMinutes,
            },
          });
        }
      }

      this.logger.debug(
        `Completed hourly aggregation. Processed ${events.length} events.`,
      );
    } catch (error) {
      this.logger.error('Error during hourly aggregation:', error);
    }
  }

  // ─── Agent heartbeat / offline ─────────────────────────────────────────────

  /**   * Called by the browser Angular app every ~60 s while logged in.
   * Keeps the user showing as online independently of keyboard/mouse events
   * and regardless of whether monitoring is enabled.
   */
  async recordBrowserHeartbeat(userId: number): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActivityAt: new Date() },
    });
    return { ok: true };
  }

  /**   * Called by the desktop agent every ~60 s while the PC is on.
   * Keeps the user's lastActivityAt fresh so they appear online even when idle.
   */
  async recordHeartbeat(userId: number): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActivityAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Called by the desktop agent during controlled shutdown (PC shutdown / user
   * logout). Sets lastActivityAt to null so the user appears offline immediately
   * rather than waiting for the 5-minute stale-data timeout.
   */
  async recordOffline(userId: number): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActivityAt: null },
    });
    return { ok: true };
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
      throw new ForbiddenException(
        'Only admins and managers can access employee profiles',
      );
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
          select: {
            id: true,
            deviceName: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException(`User ${targetUserId} not found`);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return {
      ...user,
      isOnline: user.lastActivityAt
        ? user.lastActivityAt > fiveMinutesAgo
        : false,
    };
  }

  /**
   * Get date-range activity summary for any employee (admin only)
   */
  async getAdminEmployeeSummary(
    targetUserId: number,
    query: GetActivitySummaryDto,
  ) {
    const { startDate, endDate } = query;

    const toIstDate = (date: Date) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
      const m = parts.find((p) => p.type === 'month')?.value ?? '01';
      const d = parts.find((p) => p.type === 'day')?.value ?? '01';
      return `${y}-${m}-${d}`;
    };

    // Build inclusive day range: gte = start-of-startDate, lt = start-of-day AFTER endDate
    // Using lt (not lte) avoids the "midnight only" bug where lte: new Date("2026-05-09")
    // equals exactly 00:00 UTC and therefore excludes all same-day rows stored at later hours.
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);
    rangeEnd.setDate(rangeEnd.getDate() + 1); // exclusive upper bound (next day midnight)

    const storedRows = await this.prisma.activitySummary.findMany({
      where: {
        userId: targetUserId,
        date: {
          gte: rangeStart,
          lt: rangeEnd,
        },
      },
      orderBy: [{ date: 'asc' }, { hour: 'asc' }],
    });

    // If the requested range includes today, merge in live (not-yet-aggregated) data
    // so the current incomplete hour is visible without waiting for the cron to run.
    const todayStr = toIstDate(new Date());

    if (startDate <= todayStr && endDate >= todayStr) {
      const liveData = await this.getTodayActivityDashboard(targetUserId);
      const liveSummaries = liveData.summaries.map((s: any) => ({
        id: -1,
        userId: targetUserId,
        taskId: null as number | null,
        date: new Date(),
        hour: s.hour as number,
        totalKeystrokes: s.totalKeystrokes as number,
        totalClicks: s.totalClicks as number,
        totalMouseMovement: s.totalMouseMovement as number,
        idleTimeMinutes: s.idleTimeMinutes as number,
        isWorkingHours: s.hour >= 10 && s.hour < 18,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Build a set of stored hours for today so we only add live rows that
      // are not yet persisted (i.e., the current in-progress hour).
      const storedTodayHours = new Set(
        storedRows
          .filter((r) => {
            const rowDateStr = toIstDate(r.date);
            return rowDateStr === todayStr;
          })
          .map((r) => r.hour),
      );

      for (const liveRow of liveSummaries) {
        if (!storedTodayHours.has(liveRow.hour)) {
          storedRows.push(liveRow as any);
        }
      }

      // Re-sort after merge
      storedRows.sort((a, b) => {
        const dateCompare =
          new Date(a.date).getTime() - new Date(b.date).getTime();
        return dateCompare !== 0 ? dateCompare : a.hour - b.hour;
      });
    }

    return storedRows;
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

    // Invalidate config cache so the change takes effect immediately.
    this.configCache.delete(targetUserId);

    return {
      success: true,
      userId: targetUserId,
      isMonitoringEnabled: enabled,
    };
  }

  // ─── Auto-Update Management ────────────────────────────────────────────────

  /**
   * Broadcast update notification to all connected agents (admin only)
   * Agents will check for updates within the next polling interval
   */
  async broadcastUpdateNotification(
    adminRole: string,
    versionInfo?: { version: string; force: boolean },
  ) {
    if (adminRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Only admins can broadcast update notifications',
      );
    }

    // In a real distributed system, you would:
    // 1. Push notification to Redis pub/sub
    // 2. WebSocket notification to connected agents
    // 3. Database flag that agents read on next check

    // For now, we log it for the backend to track
    this.logger.log(
      `Update broadcast requested: v${versionInfo?.version || 'latest'} (force=${versionInfo?.force || false})`,
    );

    return {
      success: true,
      message:
        'Update notification queued. Agents will check within the next hour.',
      version: versionInfo?.version || 'latest',
    };
  }

  /**
   * Get agent statistics for admin dashboard
   */
  async getAgentStatistics(adminRole: string) {
    if (!['ADMIN', 'MANAGER'].includes(adminRole)) {
      throw new ForbiddenException(
        'Only admins and managers can view agent statistics',
      );
    }

    const devices = await this.prisma.deviceToken.findMany({
      select: {
        id: true,
        userId: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        isRevoked: true,
        user: {
          select: { id: true, name: true, email: true, lastActivityAt: true },
        },
      },
    });

    const activeDevices = devices.filter((d) => !d.isRevoked);
    const onlineDevices = activeDevices.filter((d) => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return d.user.lastActivityAt && d.user.lastActivityAt > fiveMinutesAgo;
    });

    return {
      totalDevices: devices.length,
      activeDevices: activeDevices.length,
      onlineDevices: onlineDevices.length,
      offlineDevices: activeDevices.length - onlineDevices.length,
      revokedDevices: devices.filter((d) => d.isRevoked).length,
      devices: activeDevices,
    };
  }
}
