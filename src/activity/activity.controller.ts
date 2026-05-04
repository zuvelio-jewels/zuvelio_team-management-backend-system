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
  constructor(private activityService: ActivityService) { }

  private getAgentRoot() {
    return join(process.cwd(), '..', 'activity-monitor-agent');
  }

  private pickExistingPath(paths: string[]) {
    return paths.find((path) => existsSync(path));
  }

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
    const prebuiltSetupPath = this.pickExistingPath([
      join(this.getAgentRoot(), 'ZuvelioSetup.zip'),
    ]);

    if (prebuiltSetupPath) {
      return res.download(
        prebuiltSetupPath,
        `zuvelio-activity-setup-user-${req.user.id}.zip`,
      );
    }

    const device = await this.activityService.registerSelfDevice(
      req.user.id,
      deviceName,
    );
    return this.sendSetupPackage(res, req, device.token, req.user.id);
  }

  // ─── Browser heartbeat ─────────────────────────────────────────────────────

  /**
   * POST /activity/heartbeat
   * Angular browser app calls this every ~60 s while the user is logged in.
   * Updates lastActivityAt so the user shows as Online on the admin dashboard
   * regardless of whether monitoring event collection is enabled or idle.
   */
  @Post('heartbeat')
  async browserHeartbeat(@Req() req) {
    return this.activityService.recordBrowserHeartbeat(req.user.id);
  }

  // ─── Agent heartbeat / offline ─────────────────────────────────────────────

  /**
   * POST /activity/agent/heartbeat
   * Desktop agent calls this every ~60 s to keep the user showing as online
   * while the PC is powered on, even during mouse/keyboard idle periods.
   */
  @Post('agent/heartbeat')
  async agentHeartbeat(@Req() req) {
    return this.activityService.recordHeartbeat(req.user.id);
  }

  /**
   * POST /activity/agent/offline
   * Desktop agent calls this on controlled shutdown (PC shutdown / session end).
   * Marks the user offline immediately instead of waiting for the 5-min stale
   * timeout.
   */
  @Post('agent/offline')
  async agentOffline(@Req() req) {
    return this.activityService.recordOffline(req.user.id);
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

  /** GET /activity/admin/employees/:id — single employee profile */
  @Get('admin/employees/:id')
  async getEmployeeProfile(
    @Req() req,
    @Param('id', ParseIntPipe) targetId: number,
  ) {
    return this.activityService.getAdminEmployeeProfile(req.user.role, targetId);
  }

  /** GET /activity/admin/employees/:id/dashboard — today's dashboard for any employee */
  @Get('admin/employees/:id/dashboard')
  async getEmployeeDashboard(
    @Req() req,
    @Param('id', ParseIntPipe) targetId: number,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      throw new ForbiddenException('Admins and managers only');
    }
    return this.activityService.getTodayActivityDashboard(targetId);
  }

  /** GET /activity/admin/employees/:id/summary?startDate=&endDate= */
  @Get('admin/employees/:id/summary')
  async getEmployeeSummary(
    @Req() req,
    @Param('id', ParseIntPipe) targetId: number,
    @Query() query: GetActivitySummaryDto,
  ) {
    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      throw new ForbiddenException('Admins and managers only');
    }
    return this.activityService.getAdminEmployeeSummary(targetId, query);
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
    const agentRoot = this.getAgentRoot();

    const exePath = this.pickExistingPath([
      join(agentRoot, 'dist', 'zuvelio-activity-agent.exe'),
      join(agentRoot, 'zuvelio-activity-agent.exe'),
    ]);

    const installerPath = this.pickExistingPath([
      join(agentRoot, 'INSTALL_OFFICE_TRACKING.bat'),
    ]);

    const oneClickPath = this.pickExistingPath([
      join(agentRoot, 'ONE_CLICK_INSTALL.bat'),
    ]);

    const employeeSetupPath = this.pickExistingPath([
      join(agentRoot, 'EMPLOYEE_SETUP.bat'),
    ]);

    const readmePath = this.pickExistingPath([join(agentRoot, 'README_USER.txt')]);

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
      'HEARTBEAT_INTERVAL_MS=60000',
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

    // ── Installer script: local file → env URL → generated fallback ────────
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
        'title Zuvelio Activity Agent — Installer',
        '',
        ':: Re-launch as administrator if not already elevated',
        'net session >nul 2>&1',
        'if %errorlevel% neq 0 (',
        '    echo Requesting administrator access...',
        '    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath \'%~f0\' -WorkingDirectory \'%~dp0\' -Verb RunAs"',
        '    exit /b',
        ')',
        '',
        'echo ============================================',
        'echo  Zuvelio Activity Agent Installer',
        'echo ============================================',
        'echo.',
        '',
        ':: Accept both exe name variants',
        'set EXE_FOUND=0',
        'if exist "%~dp0zuvelio-activity-agent.exe" set EXE_FOUND=1',
        'if %EXE_FOUND%==0 if exist "%~dp0zuvelio-activity-agent-updated.exe" (',
        '    echo Renaming zuvelio-activity-agent-updated.exe...',
        '    copy /Y "%~dp0zuvelio-activity-agent-updated.exe" "%~dp0zuvelio-activity-agent.exe" >nul',
        '    set EXE_FOUND=1',
        ')',
        '',
        ':: Download from GitHub if exe is still missing',
        'if %EXE_FOUND%==0 (',
        '    echo Agent exe not found locally. Downloading from GitHub...',
        '    echo This may take a minute depending on your connection.',
        '    set DL_URL=https://github.com/zuvelio-jewels/zuvelio_team-management-backend-system/releases/download/v2.0.1/zuvelio-activity-agent.exe',
        '    set DL_OK=0',
        '',
        '    :: Try curl.exe first (built-in on Windows 10/11, handles GitHub redirects reliably)',
        '    where curl.exe >nul 2>&1',
        '    if %errorlevel% equ 0 (',
        '        curl.exe -L --retry 3 --retry-delay 2 -A "Mozilla/5.0" -o "%~dp0zuvelio-activity-agent.exe" "%DL_URL%"',
        '        if %errorlevel% equ 0 set DL_OK=1',
        '    )',
        '',
        '    :: Fall back to PowerShell WebClient (.NET) if curl failed or unavailable',
        '    if %DL_OK%==0 (',
        '        powershell -NoProfile -ExecutionPolicy Bypass -Command ^',
        '          "try { $wc=New-Object System.Net.WebClient; $wc.Headers.Add(\'User-Agent\',\'Mozilla/5.0 (Windows NT 10.0; Win64; x64)\'); $wc.DownloadFile(\'%DL_URL%\',\'%~dp0zuvelio-activity-agent.exe\'); Write-Host \'Download complete.\' } catch { Write-Host (\'Download failed: \' + $_.Exception.Message); exit 1 }"',
        '        if %errorlevel% equ 0 set DL_OK=1',
        '    )',
        '',
        '    if %DL_OK%==0 (',
        '        echo.',
        '        echo ERROR: Could not download the agent exe.',
        '        echo Please download manually from:',
        '        echo   https://github.com/zuvelio-jewels/zuvelio_team-management-backend-system/releases',
        '        echo Rename the downloaded file to: zuvelio-activity-agent.exe',
        '        echo Place it in this folder, then run this script again.',
        '        pause',
        '        exit /b 1',
        '    )',
        '    set EXE_FOUND=1',
        ')',
        '',
        'if not exist "%~dp0.env" (',
        '    echo ERROR: .env configuration file not found in %~dp0',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        ':: Stop any running instance before reinstalling',
        'echo Stopping existing agent (if any)...',
        'taskkill /F /IM zuvelio-activity-agent.exe >nul 2>&1',
        'timeout /t 2 /nobreak >nul',
        '',
        ':: Copy files to permanent install location',
        'set INSTALL_DIR=%ProgramFiles%\\Zuvelio\\ActivityAgent',
        'echo Installing to %INSTALL_DIR%...',
        'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"',
        'copy /Y "%~dp0zuvelio-activity-agent.exe" "%INSTALL_DIR%\\" >nul',
        'copy /Y "%~dp0.env" "%INSTALL_DIR%\\.env" >nul',
        '',
        ':: Register Windows startup so agent auto-starts on every login',
        'echo Registering auto-start on Windows login...',
        'cd /d "%INSTALL_DIR%"',
        'zuvelio-activity-agent.exe --install',
        '',
        ':: Start agent immediately in the background (hidden)',
        'echo Starting activity agent...',
        'start "" /B "%INSTALL_DIR%\\zuvelio-activity-agent.exe"',
        'timeout /t 3 /nobreak >nul',
        '',
        ':: Confirm it started',
        'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
        'if %errorlevel% equ 0 (',
        '    echo.',
        '    echo [OK] Agent is running. Activity tracking is now active.',
        '    echo      You can close this window.',
        ') else (',
        '    echo.',
        '    echo [WARN] Agent may not have started. Try running START_AGENT.bat',
        ')',
        'echo.',
        'pause',
        '',
      ].join('\r\n');

      zip.file('INSTALL_OFFICE_TRACKING.bat', fallbackInstaller);
    }

    // ── One-click launcher ───────────────────────────────────────────────
    if (oneClickPath) {
      zip.file('ONE_CLICK_INSTALL.bat', readFileSync(oneClickPath, 'utf8'));
    } else {
      const oneClickFallback = [
        '@echo off',
        'cd /d "%~dp0"',
        'call "INSTALL_OFFICE_TRACKING.bat"',
        '',
      ].join('\r\n');
      zip.file('ONE_CLICK_INSTALL.bat', oneClickFallback);
    }

    // ── Always include a manual START_AGENT.bat so employees can restart ─
    const startAgentBat = [
      '@echo off',
      'setlocal',
      'title Zuvelio Activity Agent',
      '',
      'set INSTALL_DIR=%ProgramFiles%\\Zuvelio\\ActivityAgent',
      '',
      ':: Check if already running',
      'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
      'if %errorlevel% equ 0 (',
      '    echo Agent is already running. Nothing to do.',
      '    timeout /t 3 /nobreak >nul',
      '    exit /b 0',
      ')',
      '',
      ':: Try installed location first, fall back to current folder',
      'if exist "%INSTALL_DIR%\\zuvelio-activity-agent.exe" (',
      '    cd /d "%INSTALL_DIR%"',
      ') else if exist "%~dp0zuvelio-activity-agent.exe" (',
      '    cd /d "%~dp0"',
      ') else (',
      '    echo ERROR: zuvelio-activity-agent.exe not found.',
      '    echo Please run INSTALL_OFFICE_TRACKING.bat first.',
      '    pause',
      '    exit /b 1',
      ')',
      '',
      'echo Starting Zuvelio activity agent...',
      'start "" /B zuvelio-activity-agent.exe',
      'timeout /t 3 /nobreak >nul',
      '',
      'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
      'if %errorlevel% equ 0 (',
      '    echo [OK] Agent started. You can close this window.',
      ') else (',
      '    echo [FAIL] Could not start agent. Contact your administrator.',
      '    pause',
      ')',
      '',
    ].join('\r\n');
    zip.file('START_AGENT.bat', startAgentBat);

    // ── CHECK_STATUS.bat — lets employee verify the agent is running ──────
    const checkStatusBat = [
      '@echo off',
      'echo Checking Zuvelio Activity Agent status...',
      'echo.',
      'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
      'if %errorlevel% equ 0 (',
      '    echo [RUNNING]  Activity tracking is active.',
      ') else (',
      '    echo [STOPPED]  Agent is NOT running.',
      '    echo            Run START_AGENT.bat to start it.',
      ')',
      'echo.',
      'pause',
      '',
    ].join('\r\n');
    zip.file('CHECK_STATUS.bat', checkStatusBat);

    // ── Employee self-setup: local file → env URL → generated fallback ──
    if (employeeSetupPath) {
      zip.file('EMPLOYEE_SETUP.bat', readFileSync(employeeSetupPath, 'utf8'));
    } else if (process.env.AGENT_EMPLOYEE_SETUP_URL) {
      const setupRes = await fetch(process.env.AGENT_EMPLOYEE_SETUP_URL);
      if (setupRes.ok) {
        zip.file('EMPLOYEE_SETUP.bat', await setupRes.text());
      }
    } else {
      const employeeSetupFallback = [
        '@echo off',
        'cd /d "%~dp0"',
        'echo Zuvelio Activity Agent — Employee Setup',
        'echo ----------------------------------------',
        'echo This will install the activity tracking agent on your PC.',
        'echo The agent runs silently in the background. You do NOT need',
        'echo to keep any browser or app open for tracking to work.',
        'echo.',
        'call "INSTALL_OFFICE_TRACKING.bat"',
        '',
      ].join('\r\n');
      zip.file('EMPLOYEE_SETUP.bat', employeeSetupFallback);
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
      'IMPORTANT: Once installed the agent runs silently in the background.',
      'You do NOT need to keep any browser open for tracking to work.',
      'Activity is captured at the OS level (keyboard, mouse) even when',
      'the browser is closed or you are using other applications.',
      '',
      'FIRST-TIME INSTALL',
      '------------------',
      '1. Keep ALL files in the same folder (do not move them separately)',
      '2. Double-click  EMPLOYEE_SETUP.bat',
      '3. Click "Yes" on the Windows administrator prompt',
      '4. Wait for "[OK] Agent is running" message',
      '5. You can now close this folder — tracking is active',
      '',
      'VERIFY AGENT IS RUNNING',
      '-----------------------',
      'Double-click  CHECK_STATUS.bat  at any time to confirm the agent is running.',
      '',
      'RESTART AGENT MANUALLY',
      '----------------------',
      'Double-click  START_AGENT.bat  to (re)start the agent without reinstalling.',
      '',
      'AUTO-START',
      '----------',
      'The agent is registered to start automatically every time Windows starts.',
      'If the PC is restarted you do NOT need to do anything — it starts itself.',
      '',
      'TROUBLESHOOTING',
      '---------------',
      '- CHECK_STATUS.bat says STOPPED → run START_AGENT.bat',
      '- START_AGENT.bat says "not found" → run EMPLOYEE_SETUP.bat again',
      '- Still not working → contact your administrator',
      '',
    ].join('\r\n');
    zip.file('SETUP_INSTRUCTIONS.txt', instructions);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const fileName = `zuvelio-activity-setup-user-${userId}-${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(zipBuffer);
  }
}
