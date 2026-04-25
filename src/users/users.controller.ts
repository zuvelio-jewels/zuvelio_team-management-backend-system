import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApproveUserDto } from './dto';

@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('assignable')
  findAssignable() {
    return this.usersService.findAssignable();
  }

  @Get('pending')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  findPendingApproval() {
    return this.usersService.findPendingApproval();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/assignable')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  setAssignable(
    @Param('id', ParseIntPipe) id: number,
    @Body('isAssignable') isAssignable: boolean,
  ) {
    return this.usersService.setAssignable(id, isAssignable);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  approveUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveUserDto,
  ) {
    return this.usersService.approveUser(id, dto.role);
  }

  @Delete(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  rejectUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.rejectUser(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  removeUser(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.removeUser(id);
  }
}
