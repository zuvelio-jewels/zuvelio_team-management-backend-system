import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('teams')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.remove(id);
  }

  @Post(':id/members/:userId')
  addMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.teamsService.addMember(id, userId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.teamsService.removeMember(id, userId);
  }
}
