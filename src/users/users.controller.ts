import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  Body,
  HttpCode,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApproveUserDto, AdminResetPasswordDto } from './dto';

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

  @Get('project-assignable')
  findProjectAssignable() {
    return this.usersService.findProjectAssignable();
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

  @Patch(':id/project-assignable')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  setProjectAssignable(
    @Param('id', ParseIntPipe) id: number,
    @Body('isProjectAssignable') isProjectAssignable: boolean,
  ) {
    return this.usersService.setProjectAssignable(id, isProjectAssignable);
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

  @Post(':id/reset-password')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(200)
  resetUserPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.usersService.resetUserPassword(id, dto.newPassword);
  }

  @Patch(':id/empcode')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  setEmpcode(
    @Param('id', ParseIntPipe) id: number,
    @Body('empcode') empcode: string,
  ) {
    return this.usersService.setEmpcode(id, empcode ?? '');
  }

  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('role') role: Role,
  ) {
    return this.usersService.setRole(id, role);
  }

  @Patch(':id/cabin-no')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  setCabinNo(
    @Param('id', ParseIntPipe) id: number,
    @Body('cabinNo') cabinNo: string,
  ) {
    return this.usersService.setCabinNo(id, cabinNo ?? '');
  }
}
