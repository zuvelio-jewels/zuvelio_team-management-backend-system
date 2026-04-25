import { Controller, Get, Post, Query, Request } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) { }

  @Get()
  findAll(@Request() req: any) {
    return this.attendanceService.getAll(req.user.id);
  }

  @Get('all-records')
  getAllRecords() {
    return this.attendanceService.getAllRecords();
  }

  @Post('check-in')
  checkIn(@Request() req: any) {
    return this.attendanceService.checkIn(req.user.id);
  }

  @Post('check-out')
  checkOut(@Request() req: any) {
    return this.attendanceService.checkOut(req.user.id);
  }

  @Public()
  @Get('availability')
  getAvailability(@Query('userIds') userIds?: string) {
    const parsedUserIds = userIds
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);

    return this.attendanceService.getAvailability(
      parsedUserIds?.length ? parsedUserIds : undefined,
    );
  }
}
