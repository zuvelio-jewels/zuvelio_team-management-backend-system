import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Patch,
    Delete,
    Query,
    Request,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { ProjectionService } from './projection.service';
import { CreateProjectionDto } from './dto/create-projection.dto';
import { UpdateProjectionDto } from './dto/update-projection.dto';
import { ProjectionActionDto } from './dto/projection-action.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('projections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectionController {
    constructor(private projectionService: ProjectionService) { }

    // Create projection (Admin only)
    @Post()
    @Roles('ADMIN')
    create(@Body() createProjectionDto: CreateProjectionDto, @Request() req) {
        return this.projectionService.create(createProjectionDto, req.user.id);
    }

    // Get all projections with filters
    @Get()
    findAll(
        @Query('employeeId', new ParseIntPipe({ optional: true }))
        employeeId?: number,
        @Query('status') status?: string,
        @Query('createdByAdminId', new ParseIntPipe({ optional: true }))
        createdByAdminId?: number,
    ) {
        return this.projectionService.findAll({
            employeeId,
            status,
            createdByAdminId,
        });
    }

    // Get admin dashboard
    @Get('admin/dashboard')
    @Roles('ADMIN')
    getAdminDashboard(@Request() req) {
        return this.projectionService.getAdminDashboard(req.user.id);
    }

    // Get employee's active projection
    @Get('employee/active')
    getEmployeeActiveProjection(@Request() req) {
        return this.projectionService.getEmployeeActiveProjection(req.user.id);
    }

    // Get employee's completed projections
    @Get('employee/completed')
    getEmployeeCompletedProjections(
        @Request() req: any,
        @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    ) {
        return this.projectionService.getEmployeeCompletedProjections(
            req?.user?.id,
            limit,
        );
    }

    @Get('employee/pending')
    getEmployeePending(@Request() req) {
        return this.projectionService.getEmployeePendingProjections(req.user.id);
    }

    // Get single projection
    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.projectionService.findOne(id);
    }

    // Update projection (Admin only)
    @Patch(':id')
    @Roles('ADMIN')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateProjectionDto: UpdateProjectionDto,
        @Request() req,
    ) {
        return this.projectionService.update(id, updateProjectionDto, req.user.id);
    }

    // Cancel projection (Admin only)
    @Delete(':id')
    @Roles('ADMIN')
    cancel(@Param('id', ParseIntPipe) id: number, @Request() req) {
        return this.projectionService.cancel(id, req.user.id);
    }

    // Handle employee action on projection
    @Post(':id/action')
    handleAction(
        @Param('id', ParseIntPipe) projectionId: number,
        @Body() actionDto: ProjectionActionDto,
        @Request() req,
    ) {
        return this.projectionService.handleEmployeeAction(
            projectionId,
            req.user.id,
            actionDto,
        );
    }
}
