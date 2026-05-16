import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { TaskTimeTrackingService } from './task-time-tracking.service';
import {
  StartTaskTimerDto,
  SwitchTaskTimerDto,
  CreateTaskOperationDto,
} from './dto/task-time-tracking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('task-time-tracking')
@UseGuards(JwtAuthGuard)
export class TaskTimeTrackingController {
  constructor(private service: TaskTimeTrackingService) {}

  // ─── Employee: Timer ────────────────────────────────────────────────────────

  @Post('start')
  startTimer(@Body() dto: StartTaskTimerDto, @Request() req) {
    return this.service.startTimer(req.user.id, dto);
  }

  @Post(':timeLogId/pause')
  pauseTimer(
    @Param('timeLogId', ParseIntPipe) timeLogId: number,
    @Request() req,
  ) {
    return this.service.pauseTimer(req.user.id, timeLogId);
  }

  @Post(':timeLogId/resume')
  resumeTimer(
    @Param('timeLogId', ParseIntPipe) timeLogId: number,
    @Request() req,
  ) {
    return this.service.resumeTimer(req.user.id, timeLogId);
  }

  @Post('switch')
  switchTimer(@Body() dto: SwitchTaskTimerDto, @Request() req) {
    return this.service.switchTimer(req.user.id, dto);
  }

  @Get('current')
  getCurrentTimer(@Request() req) {
    return this.service.getCurrentTimer(req.user.id);
  }

  @Get('my-logs')
  getMyTimeLogs(@Request() req) {
    return this.service.getMyTimeLogs(req.user.id);
  }

  // ─── Task Operations (Admin/Manager) ────────────────────────────────────────

  @Get('operations/:taskId')
  getOperations(@Param('taskId', ParseIntPipe) taskId: number) {
    return this.service.getOperations(taskId);
  }

  @Post('operations')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  createOperation(@Body() dto: CreateTaskOperationDto, @Request() req) {
    return this.service.createOperation(dto, req.user.id);
  }

  @Delete('operations/:operationId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  deleteOperation(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.service.deleteOperation(operationId);
  }

  // ─── Admin Reports ──────────────────────────────────────────────────────────

  @Get('admin/report')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  getAdminReport(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.getAdminTimeReport(
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
    );
  }

  @Get('task/:taskId/logs')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  getTaskLogs(@Param('taskId', ParseIntPipe) taskId: number) {
    return this.service.getTaskTimeLogs(taskId);
  }
}
