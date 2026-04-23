import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Body,
    Query,
    Param,
    UseGuards,
    Req,
    Res,
    NotFoundException,
    ForbiddenException,
    ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { ActivityService } from './activity.service';
import {
    CreateActivityBatchDto,
    CreateActivityEventDto,
    GetActivitySummaryDto,
    UpdateMonitoringConfigDto,
    RegisterDeviceDto,
    DeviceTokenAuthDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
    constructor(private activityService: ActivityService) { }

    /**
     * POST /activity/log
     * Client sends keyboard/mouse events for logging
     * Rate-limited to prevent abuse
     */
    @Post('log')
    async logActivity(@Req() req, @Body() createActivityDto: CreateActivityEventDto) {
        const userId = req.user.id;
        return this.activityService.logActivityEvent(userId, createActivityDto);
    }

    @Post('log-batch')
    async logActivityBatch(@Req() req, @Body() batchDto: CreateActivityBatchDto) {
        const userId = req.user.id;
        return this.activityService.logActivityBatch(userId, batchDto.events ?? []);
    }

    /**
     * GET /activity/summary
     * Get aggregated activity summary for authenticated user
     * Query params: startDate, endDate (ISO format)
     */
    @Get('summary')
    async getActivitySummary(@Req() req, @Query() query: GetActivitySummaryDto) {
        const userId = req.user.id;
        return this.activityService.getActivitySummary(userId, userId, query);
    }

    /**
     * GET /activity/dashboard
     * Get today's activity dashboard data
     */
    @Get('dashboard')
    async getActivityDashboard(@Req() req) {
        const userId = req.user.id;
        return this.activityService.getTodayActivityDashboard(userId);
    }

    /**
     * GET /activity/team
     * Get team activity (managers/admins only)
     * Query params: startDate, endDate (ISO format)
     */
    @Get('team')
    async getTeamActivity(@Req() req, @Query() query: GetActivitySummaryDto) {
        const userId = req.user.id;
        return this.activityService.getTeamActivity(userId, query);
    }

    /**
     * GET /activity/monitoring/config
     * Get monitoring configuration for authenticated user
     */
    @Get('monitoring/config')
    async getMonitoringConfig(@Req() req) {
        const userId = req.user.id;
        return this.activityService.getMonitoringConfig(userId);
    }

    /**
     * PATCH /activity/monitoring/config
     * Update monitoring configuration (admin only)
     * Body: UpdateMonitoringConfigDto
     */
    @Patch('monitoring/config')
    async updateMonitoringConfig(
        @Req() req,
        @Body() updateData: UpdateMonitoringConfigDto,
    ) {
        const userId = req.user.id;
        const userRole = req.user.role;

        // For now, updates own config. Future: specify targetUserId for admin updates
        return this.activityService.updateMonitoringConfig(
            userId,
            userId,
            userRole,
            updateData,
        );
    }

    /**
     * GET /activity/status
     * Check if monitoring is currently active for the user
     */
    @Get('status')
    async getMonitoringStatus(@Req() req) {
        const userId = req.user.id;
        const isActive = await this.activityService.isMonitoringActive(userId);
        const config = await this.activityService.getMonitoringConfig(userId);

        return {
            isActive,
            workingHours: {
                start: config.startWorkHour,
                end: config.endWorkHour,
            },
            idleThreshold: config.idleThresholdMinutes,
        };
    }

    @Get('agent/download')
    downloadAgent(@Req() req, @Res() res: Response) {
        if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
            throw new ForbiddenException('Only admins and managers can download the desktop agent');
        }

        const agentPath = join(
            process.cwd(),
            '..',
            'activity-monitor-agent',
            'dist',
            'zuvelio-activity-agent.exe',
        );

        if (!existsSync(agentPath)) {
            throw new NotFoundException('Desktop agent executable not found');
        }

        return res.download(agentPath, 'zuvelio-activity-agent.exe');
    }

    @Get('agent/env-template')
    downloadAgentEnvTemplate(@Req() req, @Res() res: Response) {
        if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
            throw new ForbiddenException('Only admins and managers can download the desktop agent template');
        }

        const envTemplatePath = join(
            process.cwd(),
            '..',
            'activity-monitor-agent',
            '.env.example',
        );

        if (!existsSync(envTemplatePath)) {
            throw new NotFoundException('Desktop agent env template not found');
        }

        return res.download(envTemplatePath, 'activity-agent.env.example');
    }

    // ─── Device Token Endpoints ────────────────────────────────────────────────

    @Post('agent/register-device')
    async registerDevice(@Req() req, @Body() dto: RegisterDeviceDto) {
        return this.activityService.registerDevice(req.user.id, req.user.role, dto.userId, dto.deviceName);
    }

    @Public()
    @Post('agent/token-auth')
    async tokenAuth(@Body() dto: DeviceTokenAuthDto) {
        return this.activityService.authenticateWithDeviceToken(dto.deviceToken);
    }

    @Get('agent/devices')
    async listDevices(@Req() req, @Query('userId') userId?: string) {
        return this.activityService.listDeviceTokens(req.user.role, userId ? parseInt(userId) : undefined);
    }

    @Delete('agent/devices/:id')
    async revokeDevice(@Req() req, @Param('id', ParseIntPipe) id: number) {
        return this.activityService.revokeDeviceToken(req.user.role, id);
    }

    // ─── Admin Employee Management ─────────────────────────────────────────────

    @Get('admin/employees')
    async getEmployeeList(@Req() req) {
        return this.activityService.getAdminEmployeeList(req.user.role);
    }

    @Patch('admin/employees/:id/monitoring')
    async toggleMonitoring(
        @Req() req,
        @Param('id', ParseIntPipe) targetId: number,
        @Body('enabled') enabled: boolean,
    ) {
        return this.activityService.toggleEmployeeMonitoring(req.user.role, targetId, enabled);
    }
}
