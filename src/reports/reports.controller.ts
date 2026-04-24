import { Controller, Get, Query, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
    constructor(private reportsService: ReportsService) { }

    /** GET /api/reports/me?from=2026-04-01&to=2026-04-30 */
    @Get('me')
    getMyReport(
        @Request() req: any,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.reportsService.getUserReport(req.user.id, from, to);
    }

    /** GET /api/reports/all?from=2026-04-01&to=2026-04-30  (admin/manager only — enforced by RolesGuard via role check in service) */
    @Get('all')
    getAllReports(
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.reportsService.getAllUsersReport(from, to);
    }

    /** GET /api/reports/user/:id — admin gets specific user's report */
    @Get('user')
    getUserReport(
        @Query('userId') userId: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.reportsService.getUserReport(Number(userId), from, to);
    }
}
