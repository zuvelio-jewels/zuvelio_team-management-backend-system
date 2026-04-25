import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
} from '@nestjs/common';
import { LeavesService } from './leaves.service';

@Controller('leaves')
export class LeavesController {
  constructor(private leavesService: LeavesService) {}

  @Get()
  async findAll(@Request() req: any) {
    // Return current user's leaves
    return this.leavesService.getMyLeaves(req.user.id);
  }

  @Post()
  async create(
    @Request() req: any,
    @Body() data: { type: string; fromDate: string; toDate: string },
  ) {
    return this.leavesService.create(req.user.id, data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.leavesService.update(parseInt(id), data);
  }
}
