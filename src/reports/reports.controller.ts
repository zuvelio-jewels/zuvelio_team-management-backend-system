import { Controller, Get, Query, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /** GET /api/reports/me?from=2026-04-01&to=2026-04-30 */
  @Get('me')
  getMyReport(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getUserReport(req.user.id, from, to);
  }

  /** GET /api/reports/all?from=2026-04-01&to=2026-04-30 (admin/manager only) */
  @Get('all')
  @Roles(Role.ADMIN, Role.MANAGER)
  getAllReports(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getAllUsersReport(from, to);
  }

  /** GET /api/reports/user?userId=X (admin/manager only) */
  @Get('user')
  @Roles(Role.ADMIN, Role.MANAGER)
  getUserReport(
    @Query('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getUserReport(Number(userId), from, to);
  }
}
