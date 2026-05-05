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
    // Serve pre-built universal ZIP if it exists locally (local dev)
    const prebuiltSetupPath = this.pickExistingPath([
      join(this.getAgentRoot(), 'ZuvelioSetup.zip'),
    ]);

    if (prebuiltSetupPath) {
      return res.download(
        prebuiltSetupPath,
        `zuvelio-activity-setup-user-${req.user.id}.zip`,
      );
    }

    // Railway / production: generate a lightweight ZIP on-the-fly.
    // The ZIP contains only source files (~50 KB). node_modules are installed
    // by npm on the employee's PC during INSTALL_ANY_PC.ps1 execution.
    return this.sendUniversalSetupPackage(res, req);
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

    // ── Agent executable: local file only ──────────────────────────────
    // NOTE: We intentionally do NOT download the exe from AGENT_EXE_URL
    // through the server — that causes a 35–40 MB ZIP which times out on
    // Railway before it reaches the browser. Instead the installer BAT
    // downloads the exe directly from GitHub on the employee's machine.
    if (exePath) {
      zip.file('zuvelio-activity-agent.exe', readFileSync(exePath));
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
      // INSTALL_OFFICE_TRACKING.bat — no UAC here; elevation handled by EMPLOYEE_SETUP.bat
      const fallbackInstaller = [
        '@echo off',
        'setlocal EnableDelayedExpansion',
        'title Zuvelio Activity Agent — Installer',
        '',
        'echo ============================================',
        'echo  Zuvelio Activity Agent Installer',
        'echo ============================================',
        'echo.',
        '',
        ':: Accept both exe name variants',
        'set EXE_FOUND=0',
        'if exist "%~dp0zuvelio-activity-agent.exe" set EXE_FOUND=1',
        'if !EXE_FOUND!==0 if exist "%~dp0zuvelio-activity-agent-updated.exe" (',
        '    echo Renaming zuvelio-activity-agent-updated.exe...',
        '    copy /Y "%~dp0zuvelio-activity-agent-updated.exe" "%~dp0zuvelio-activity-agent.exe" >nul',
        '    set EXE_FOUND=1',
        ')',
        '',
        'if !EXE_FOUND!==0 (',
        '    echo Downloading from GitHub... please wait...',
        '    set "DL_URL=https://github.com/zuvelio-jewels/zuvelio_team-management-backend-system/releases/download/v2.0.1/zuvelio-activity-agent.exe"',
        '    set DL_OK=0',
        '',
        '    where curl.exe >nul 2>&1',
        '    if !errorlevel! equ 0 (',
        '        curl.exe -L --retry 3 --retry-delay 2 -A "Mozilla/5.0" -o "%~dp0zuvelio-activity-agent.exe" "!DL_URL!"',
        '        if !errorlevel! equ 0 set DL_OK=1',
        '    )',
        '',
        '    if !DL_OK!==0 (',
        '        powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$wc=New-Object System.Net.WebClient;$wc.Headers[\'User-Agent\']=\'Mozilla/5.0\';$wc.DownloadFile($env:DL_URL,\'%~dp0zuvelio-activity-agent.exe\');Write-Host \'OK\'}catch{Write-Host $_;exit 1}"',
        '        if !errorlevel! equ 0 set DL_OK=1',
        '    )',
        '',
        '    if !DL_OK!==0 (',
        '        echo.',
        '        echo ERROR: Download failed.',
        '        echo  1. Open https://github.com/zuvelio-jewels/zuvelio_team-management-backend-system/releases',
        '        echo  2. Download zuvelio-activity-agent.exe',
        '        echo  3. Put it in this folder, then run EMPLOYEE_SETUP.bat again',
        '        echo.',
        '        pause',
        '        exit /b 1',
        '    )',
        '    set EXE_FOUND=1',
        ')',
        '',
        'if not exist "%~dp0.env" (',
        '    echo.',
        '    echo ERROR: .env file not found. Download a fresh setup package.',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'echo Stopping existing agent (if running)...',
        'taskkill /F /IM zuvelio-activity-agent.exe >nul 2>&1',
        'timeout /t 2 /nobreak >nul',
        '',
        'set "INSTALL_DIR=%ProgramFiles%\\Zuvelio\\ActivityAgent"',
        'echo Installing to !INSTALL_DIR!...',
        'if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"',
        'copy /Y "%~dp0zuvelio-activity-agent.exe" "!INSTALL_DIR!\\" >nul',
        'copy /Y "%~dp0.env" "!INSTALL_DIR!\\.env" >nul',
        '',
        'echo Registering auto-start on Windows login...',
        'cd /d "!INSTALL_DIR!"',
        '"!INSTALL_DIR!\\zuvelio-activity-agent.exe" --install',
        '',
        'echo Starting agent...',
        'start "" /B "!INSTALL_DIR!\\zuvelio-activity-agent.exe"',
        '',
        'set TRIES=0',
        ':CHECKLOOP',
        'timeout /t 2 /nobreak >nul',
        'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
        'if !errorlevel! equ 0 (',
        '    echo.',
        '    echo ============================================',
        '    echo  [OK] Installation complete!',
        '    echo  Activity tracking is now ACTIVE.',
        '    echo  You can close this window.',
        '    echo ============================================',
        '    echo.',
        '    pause',
        '    exit /b 0',
        ')',
        'set /a TRIES+=1',
        'if !TRIES! lss 5 goto CHECKLOOP',
        '',
        'echo.',
        'echo Agent launched. Tracking begins within 1 minute.',
        'echo Run CHECK_STATUS.bat to verify.',
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
        'pause',
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
      '',
      ':: Wait up to 10 seconds for the process to appear in tasklist',
      'set TRIES=0',
      ':WAITLOOP',
      'timeout /t 2 /nobreak >nul',
      'tasklist /FI "IMAGENAME eq zuvelio-activity-agent.exe" 2>nul | find /I "zuvelio-activity-agent.exe" >nul',
      'if %errorlevel% equ 0 (',
      '    echo [OK] Agent is running. Activity tracking is now active.',
      '    echo      You can close this window.',
      '    timeout /t 3 /nobreak >nul',
      '    exit /b 0',
      ')',
      'set /a TRIES+=1',
      'if %TRIES% lss 5 goto WAITLOOP',
      '',
      ':: After 10s still not in tasklist — agent may still be initialising',
      'echo [OK] Agent launched. If activity is not tracked after 1 minute,',
      'echo      run CHECK_STATUS.bat to verify.',
      'timeout /t 4 /nobreak >nul',
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
        'title Zuvelio Activity Agent \u2014 Setup',
        '',
        ':: Elevate via PowerShell if not already admin',
        'net session >nul 2>&1',
        'if %errorlevel% equ 0 goto :ISADMIN',
        '',
        'echo.',
        'echo  Administrator access is required.',
        'echo  Please click YES on the Windows security prompt.',
        'echo.',
        'powershell start cmd -a \'/K ""%~f0""\'  -verb runas',
        'exit /b',
        '',
        ':ISADMIN',
        'cls',
        'echo ============================================',
        'echo  Zuvelio Activity Agent \u2014 Employee Setup',
        'echo ============================================',
        'echo.',
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

  /**
   * Generate a lightweight universal setup ZIP (~50 KB).
   * Contains source code + installer scripts. No bundled node_modules —
   * npm install runs on the employee's PC during installation.
   * Used by /activity/agent/self-setup when no pre-built ZuvelioSetup.zip exists.
   */
  private async sendUniversalSetupPackage(res: Response, req: any) {
    const agentRoot = this.getAgentRoot();
    const zip = new JSZip();

    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || req.protocol || 'https';
    const host = req.get('host');
    const apiUrl =
      process.env.ACTIVITY_AGENT_API_URL || `${protocol}://${host}/api`;

    // ── src/index.js ───────────────────────────────────────────────────────
    const localIndexJs = join(agentRoot, 'src', 'index.js');
    const indexJsUrl = process.env.AGENT_INDEX_JS_URL || '';
    if (existsSync(localIndexJs)) {
      zip.file('src/index.js', readFileSync(localIndexJs, 'utf8'));
    } else if (indexJsUrl) {
      const r = await fetch(indexJsUrl);
      if (r.ok) zip.file('src/index.js', await r.text());
    }

    // ── package.json ───────────────────────────────────────────────────────
    const localPkgJson = join(agentRoot, 'package.json');
    if (existsSync(localPkgJson)) {
      zip.file('package.json', readFileSync(localPkgJson, 'utf8'));
    } else {
      // Minimal package.json — just enough for npm install
      const pkgJson = JSON.stringify({
        name: 'zuvelio-activity-agent',
        version: '1.0.0',
        main: 'src/index.js',
        dependencies: {
          'dotenv': '^16.0.0',
          'node-fetch': '^2.7.0',
          'uiohook-napi': '^1.5.4',
        },
      }, null, 2);
      zip.file('package.json', pkgJson);
    }

    // ── INSTALL_ANY_PC.bat ─────────────────────────────────────────────────
    const installBat = [
      '@echo off',
      'net session >nul 2>&1',
      'if %errorLevel% neq 0 (',
      '    echo Requesting Administrator permission...',
      '    powershell -NoProfile -Command "Start-Process \'%~f0\' -Verb RunAs -WorkingDirectory \'%~dp0\'"',
      '    exit /b',
      ')',
      'cd /d "%~dp0"',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_ANY_PC.ps1"',
    ].join('\r\n');
    zip.file('INSTALL_ANY_PC.bat', installBat);

    // ── INSTALL_ANY_PC.ps1 ─────────────────────────────────────────────────
    const localPs1 = join(agentRoot, 'INSTALL_ANY_PC.ps1');
    if (existsSync(localPs1)) {
      zip.file('INSTALL_ANY_PC.ps1', readFileSync(localPs1, 'utf8'));
    } else {
      // Inline fallback (same logic as local file)
      const ps1 = this.buildUniversalInstallerPs1(apiUrl);
      zip.file('INSTALL_ANY_PC.ps1', ps1);
    }

    // ── README ─────────────────────────────────────────────────────────────
    const readme = [
      'ZUVELIO ACTIVITY TRACKING - UNIVERSAL SETUP',
      '============================================',
      '',
      'STEPS (same for ALL employees):',
      '  1. Extract this ZIP to any folder (Desktop is fine)',
      '  2. Install Node.js if not already: https://nodejs.org -> LTS',
      '  3. Right-click INSTALL_ANY_PC.bat -> "Run as administrator"',
      '  4. Pick your name from the list',
      '  5. Done - tracking starts automatically.',
      '',
      'REQUIREMENTS:',
      '  - Windows 10 or 11',
      '  - Node.js (https://nodejs.org, download LTS)',
      '  - Internet connection',
      '  - Administrator access (installer asks automatically)',
    ].join('\r\n');
    zip.file('README.txt', readme);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ZuvelioSetup.zip"');
    return res.send(zipBuffer);
  }

  private buildUniversalInstallerPs1(apiUrl: string): string {
    // Returns the INSTALL_ANY_PC.ps1 script content with the API URL baked in.
    // This is only used when the local ps1 file doesn't exist (Railway prod).
    return `# Zuvelio Universal Installer - auto-generated
$ErrorActionPreference = "Stop"
$SCRIPT_DIR  = $PSScriptRoot
$API_URL     = "${apiUrl}"
$INSTALL_DIR = "C:\\Program Files\\Zuvelio\\ActivityAgent"
$NODE_EXE    = "C:\\Program Files\\nodejs\\node.exe"

function Write-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  ZUVELIO OFFICE ACTIVITY TRACKING - SETUP" -ForegroundColor Cyan
    Write-Host ""
}
function Write-Step($n,$total,$text){ Write-Host "  [$n/$total] $text" -ForegroundColor Yellow }
function Write-OK($t)  { Write-Host "       OK  $t" -ForegroundColor Green }
function Write-Fail($t){ Write-Host "     FAIL  $t" -ForegroundColor Red; pause; exit 1 }

Write-Banner

# Check Node.js
Write-Step 1 5 "Checking Node.js..."
if (-not (Test-Path $NODE_EXE)) {
    $nodeFallback = (Get-Command node -ErrorAction SilentlyContinue)?.Source
    if ($nodeFallback) { $NODE_EXE = $nodeFallback; Write-OK "Node.js found" }
    else {
        Write-Host "  Node.js is NOT installed." -ForegroundColor Red
        Write-Host "  1. Go to https://nodejs.org" -ForegroundColor Yellow
        Write-Host "  2. Download LTS and install" -ForegroundColor Yellow
        Write-Host "  3. Restart PC and run INSTALL_ANY_PC.bat again" -ForegroundColor Yellow
        pause; exit 1
    }
} else { Write-OK "Node.js found" }

# Connect to server
Write-Step 2 5 "Connecting to Zuvelio server..."
$adminCreds = '{"email":"admin@zuvelio.com","password":"Admin@123"}'
try {
    $authResp = Invoke-RestMethod -Uri "$API_URL/auth/login" -Method POST -ContentType "application/json" -Body $adminCreds -TimeoutSec 15
} catch { Write-Fail "Cannot connect to Zuvelio server. Check internet and try again." }
$jwt = $authResp.accessToken
Write-OK "Connected"

# Employee list
Write-Step 3 5 "Who is using this PC?"
$hdrs = @{ Authorization = "Bearer $jwt" }
$employees = Invoke-RestMethod -Uri "$API_URL/activity/admin/employees" -Headers $hdrs -TimeoutSec 15
Write-Host ""
$i = 1; $selectable = @()
foreach ($emp in $employees) {
    Write-Host ("    {0,2}.  {1}" -f $i, $emp.name) -ForegroundColor White
    $selectable += $emp; $i++
}
Write-Host ""
$choice = 0
while ($choice -lt 1 -or $choice -gt $selectable.Count) {
    $raw = Read-Host "  Enter number (1-$($selectable.Count))"
    if ($raw -match '^\\d+$') { $choice = [int]$raw }
}
$target = $selectable[$choice - 1]
Write-Host "  Selected: $($target.name)" -ForegroundColor Cyan

# Create device token
Write-Step 4 5 "Registering this PC..."
$deviceName = "PC-$(hostname)-$(Get-Date -Format 'yyyy-MM-dd')"
$regBody = "{""userId"":$($target.id),""deviceName"":""$deviceName""}"
$device = Invoke-RestMethod -Uri "$API_URL/activity/agent/register-device" -Method POST -ContentType "application/json" -Headers $hdrs -Body $regBody -TimeoutSec 15
$token = $device.token
Write-OK "Device registered"

# Install
Write-Step 5 5 "Installing..."
if (-not (Test-Path $INSTALL_DIR)) { New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null }
Copy-Item (Join-Path $SCRIPT_DIR "src")  (Join-Path $INSTALL_DIR "src")  -Recurse -Force
Copy-Item (Join-Path $SCRIPT_DIR "package.json") (Join-Path $INSTALL_DIR "package.json") -Force
Write-Host "       Installing dependencies (npm install ~30s)..." -ForegroundColor Gray
$npmExe = Join-Path (Split-Path $NODE_EXE) "npm.cmd"
if (-not (Test-Path $npmExe)) { $npmExe = "npm" }
Start-Process -FilePath $npmExe -ArgumentList "install","--production","--prefix",$INSTALL_DIR -Wait -WindowStyle Hidden
@"
API_URL=$API_URL
DEVICE_TOKEN=$($token)
FLUSH_INTERVAL_MS=5000
MOUSE_MOVE_SAMPLE_MS=1000
IDLE_THRESHOLD_MS=300000
HEARTBEAT_INTERVAL_MS=60000
SESSION_ID=desktop-agent
"@ | Set-Content (Join-Path $INSTALL_DIR ".env") -Encoding UTF8
'@echo off
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process ''%~f0'' -Verb RunAs"
    exit /b
)
cd /d "C:\\Program Files\\Zuvelio\\ActivityAgent"
"C:\\Program Files\\nodejs\\node.exe" src\\index.js
' | Set-Content (Join-Path $INSTALL_DIR "run-agent.bat") -Encoding ASCII
$startupDir = [System.Environment]::GetFolderPath('Startup')
'@echo off
cd /d "C:\\Program Files\\Zuvelio\\ActivityAgent"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process ''C:\\Program Files\\Zuvelio\\ActivityAgent\\run-agent.bat'' -Verb RunAs -WindowStyle Hidden"
' | Set-Content (Join-Path $startupDir "ZuvelioActivityAgent.bat") -Encoding ASCII
try { Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 1
Start-Process -FilePath (Join-Path $INSTALL_DIR "run-agent.bat") -Verb RunAs -WindowStyle Hidden
Write-OK "Agent started"

Write-Host ""
Write-Host "  INSTALLATION COMPLETE!" -ForegroundColor Green
Write-Host "  Employee: $($target.name)" -ForegroundColor White
Write-Host "  Tracking is now ACTIVE on this PC." -ForegroundColor White
Write-Host ""
pause
`;
  }
}
