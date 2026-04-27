import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    Request,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service';
import { StartTimeLogDto } from './dto/start-time-log.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('time-tracking')
@UseGuards(JwtAuthGuard)
export class TimeTrackingController {
    constructor(private timeTrackingService: TimeTrackingService) { }

    // Get employee's currently open timer (active or paused)
    @Get('employee/current')
    getEmployeeCurrentTimer(@Request() req) {
        return this.timeTrackingService.getEmployeeCurrentTimeLog(req.user.id);
    }

    // Start timer for a projection
    @Post('start')
    startTimer(@Body() startDto: StartTimeLogDto, @Request() req) {
        return this.timeTrackingService.startTimeLog(req.user.id, startDto);
    }

    // Stop timer
    @Post(':timeLogId/stop')
    stopTimer(
        @Param('timeLogId', ParseIntPipe) timeLogId: number,
        @Request() req,
    ) {
        return this.timeTrackingService.stopTimeLog(req.user.id, timeLogId);
    }

    // Pause timer (start break)
    @Post(':timeLogId/pause')
    pauseTimer(
        @Param('timeLogId', ParseIntPipe) timeLogId: number,
        @Request() req,
    ) {
        return this.timeTrackingService.pauseTimeLog(req.user.id, timeLogId);
    }

    // Resume timer (end break)
    @Post(':timeLogId/resume')
    resumeTimer(
        @Param('timeLogId', ParseIntPipe) timeLogId: number,
        @Request() req,
    ) {
        return this.timeTrackingService.resumeTimeLog(req.user.id, timeLogId);
    }

    // Get current timer for employee
    @Get('current/:projectionId')
    getCurrentTimer(
        @Param('projectionId', ParseIntPipe) projectionId: number,
        @Request() req,
    ) {
        return this.timeTrackingService.getCurrentTimeLog(
            req.user.id,
            projectionId,
        );
    }

    // Get all time logs for a projection
    @Get('projection/:projectionId')
    getProjectionTimeLogs(
        @Param('projectionId', ParseIntPipe) projectionId: number,
    ) {
        return this.timeTrackingService.getProjectionTimeLogs(projectionId);
    }

    // Get employee's time logs
    @Get('employee/logs')
    getEmployeeTimeLogs(
        @Request() req: any,
        @Query('projectionId', new ParseIntPipe({ optional: true }))
        projectionId?: number,
        @Query('fromDate') fromDate?: string,
        @Query('toDate') toDate?: string,
    ) {
        return this.timeTrackingService.getEmployeeTimeLogs(req?.user?.id, {
            projectionId,
            fromDate: fromDate ? new Date(fromDate) : undefined,
            toDate: toDate ? new Date(toDate) : undefined,
        });
    }

    // Get employee's daily statistics
    @Get('employee/daily-stats/:date')
    getEmployeeDailyStats(@Param('date') dateStr: string, @Request() req) {
        const date = new Date(dateStr);
        return this.timeTrackingService.getEmployeeDailyStats(req.user.id, date);
    }
}
