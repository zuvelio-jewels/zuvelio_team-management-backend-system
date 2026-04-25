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
import { existsSync, readFileSync } from 'fs';
import JSZip from 'jszip';
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
  constructor(private activityService: ActivityService) {}

  /**
   * POST /activity/log
   * Client sends keyboard/mouse events for logging
   * Rate-limited to prevent abuse
   */
  @Post('log')
  async logActivity(
    @Req() req,
    @Body() createActivityDto: CreateActivityEventDto,
  ) {
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
      throw new ForbiddenException(
        'Only admins and managers can download the desktop agent',
      );
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
      throw new ForbiddenException(
        'Only admins and managers can download the desktop agent template',
      );
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

  @Post('agent/setup-package')
  async downloadAgentSetupPackage(
    @Req() req,
    @Body() dto: RegisterDeviceDto,
    @Res() res: Response,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      throw new ForbiddenException(
        'Only admins and managers can generate setup packages',
      );
    }

    const device = await this.activityService.registerDevice(
      req.user.id,
      req.user.role,
      dto.userId,
      dto.deviceName,
    );

    return this.sendSetupPackage(res, req, device.token, dto.userId);
  }

  @Get('agent/self-setup')
  async downloadSelfSetupPackage(
    @Req() req,
    @Query('deviceName') deviceName: string,
    @Res() res: Response,
  ) {
    const device = await this.activityService.registerSelfDevice(
      req.user.id,
      deviceName,
    );
    return this.sendSetupPackage(res, req, device.token, req.user.id);
  }

  // ─── Device Token Endpoints ────────────────────────────────────────────────

  @Post('agent/register-device')
  async registerDevice(@Req() req, @Body() dto: RegisterDeviceDto) {
    return this.activityService.registerDevice(
      req.user.id,
      req.user.role,
      dto.userId,
      dto.deviceName,
    );
  }

  @Public()
  @Post('agent/token-auth')
  async tokenAuth(@Body() dto: DeviceTokenAuthDto) {
    return this.activityService.authenticateWithDeviceToken(dto.deviceToken);
  }

  @Get('agent/devices')
  async listDevices(@Req() req, @Query('userId') userId?: string) {
    return this.activityService.listDeviceTokens(
      req.user.role,
      userId ? parseInt(userId) : undefined,
    );
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
    return this.activityService.toggleEmployeeMonitoring(
      req.user.role,
      targetId,
      enabled,
    );
  }

  private async sendSetupPackage(
    res: Response,
    req: any,
    deviceToken: string,
    userId: number,
  ) {
    const agentRoot = join(process.cwd(), '..', 'activity-monitor-agent');
    const pickExisting = (paths: string[]) => paths.find((p) => existsSync(p));

    const exePath = pickExisting([
      join(agentRoot, 'dist', 'zuvelio-activity-agent.exe'),
      join(agentRoot, 'zuvelio-activity-agent.exe'),
    ]);

    const installerPath = pickExisting([
      join(agentRoot, 'INSTALL_OFFICE_TRACKING.bat'),
    ]);

    const oneClickPath = pickExisting([
      join(agentRoot, 'ONE_CLICK_INSTALL.bat'),
    ]);

    const readmePath = pickExisting([join(agentRoot, 'README_USER.txt')]);

    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || req.protocol || 'https';
    const host = req.get('host');
    const apiUrl =
      process.env.ACTIVITY_AGENT_API_URL || `${protocol}://${host}/api`;

    const envContent = [
      `API_URL=${apiUrl}`,
      `DEVICE_TOKEN=${deviceToken}`,
      'FLUSH_INTERVAL_MS=5000',
      'MOUSE_MOVE_SAMPLE_MS=1000',
      'IDLE_THRESHOLD_MS=300000',
      'SESSION_ID=desktop-agent',
      '',
    ].join('\n');

    const zip = new JSZip();

    // ── Agent executable: local file → env URL → omit ────────────────────
    if (exePath) {
      zip.file('zuvelio-activity-agent.exe', readFileSync(exePath));
    } else if (process.env.AGENT_EXE_URL) {
      const exeRes = await fetch(process.env.AGENT_EXE_URL);
      if (exeRes.ok) {
        zip.file(
          'zuvelio-activity-agent.exe',
          Buffer.from(await exeRes.arrayBuffer()),
        );
      }
    }

    // ── Installer script: local file → env URL → omit ────────────────────
    if (installerPath) {
      zip.file(
        'INSTALL_OFFICE_TRACKING.bat',
        readFileSync(installerPath, 'utf8'),
      );
    } else if (process.env.AGENT_INSTALLER_URL) {
      const batRes = await fetch(process.env.AGENT_INSTALLER_URL);
      if (batRes.ok) {
        zip.file('INSTALL_OFFICE_TRACKING.bat', await batRes.text());
      }
    } else {
      const fallbackInstaller = [
        '@echo off',
        'setlocal',
        '',
        'net session >nul 2>&1',
        'if %errorlevel% neq 0 (',
        '    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"',
        '    exit /b',
        ')',
        '',
        'if not exist "zuvelio-activity-agent.exe" (',
        '    echo ERROR: zuvelio-activity-agent.exe is missing.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'if not exist ".env" (',
        '    echo ERROR: .env is missing.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'set INSTALL_DIR=%ProgramFiles%\\Zuvelio\\ActivityAgent',
        'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
        'copy /Y "zuvelio-activity-agent.exe" "%INSTALL_DIR%\\" >nul',
        'copy /Y ".env" "%INSTALL_DIR%\\.env" >nul',
        'cd /d "%INSTALL_DIR%"',
        'zuvelio-activity-agent.exe --install',
        'start "" zuvelio-activity-agent.exe',
        'echo Installation complete.',
        'pause',
        '',
      ].join('\n');

      zip.file('INSTALL_OFFICE_TRACKING.bat', fallbackInstaller);
    }

    // ── One-click launcher: local file → generated fallback ─────────────
    if (oneClickPath) {
      zip.file('ONE_CLICK_INSTALL.bat', readFileSync(oneClickPath, 'utf8'));
    } else {
      const oneClickFallback = [
        '@echo off',
        'cd /d "%~dp0"',
        'call "INSTALL_OFFICE_TRACKING.bat"',
        '',
      ].join('\n');
      zip.file('ONE_CLICK_INSTALL.bat', oneClickFallback);
    }

    // ── Optional readme ───────────────────────────────────────────────────
    if (readmePath) {
      zip.file('README_USER.txt', readFileSync(readmePath, 'utf8'));
    }

    // ── Always include pre-configured .env ───────────────────────────────
    zip.file('.env', envContent);

    // ── Setup instructions ────────────────────────────────────────────────
    const instructions = [
      'ZUVELIO ACTIVITY AGENT — SETUP INSTRUCTIONS',
      '============================================',
      '',
      '1. Keep all files in one folder',
      '2. Double-click ONE_CLICK_INSTALL.bat',
      '3. Click Yes on the Windows admin prompt',
      '4. Wait for installation complete message',
      '',
      'If zuvelio-activity-agent.exe is not included, ask your administrator for the download link.',
      '',
    ].join('\n');
    zip.file('SETUP_INSTRUCTIONS.txt', instructions);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const fileName = `zuvelio-activity-setup-user-${userId}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(zipBuffer);
  }
}
