import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto';

@Controller('tasks')
@UseInterceptors(ClassSerializerInterceptor)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto, @Request() req: any) {
    return this.tasksService.create(dto, req.user.id);
  }

  @Get()
  findAll(
    @Query('assignedToId') assignedToId?: string,
    @Query('personStatus') personStatus?: string,
    @Query('hideDone') hideDone?: string,
  ) {
    return this.tasksService.findAll({
      assignedToId: assignedToId ? +assignedToId : undefined,
      personStatus,
      hideDone: hideDone === 'true',
    });
  }

  @Get('summary')
  getSummary() {
    return this.tasksService.getSummary();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.findOne(id);
  }

  @Get(':id/notes')
  getNoteHistory(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.findNoteHistory(id);
  }

  @Post(':id/notes')
  addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body('note') note: string,
    @Request() req: any,
  ) {
    return this.tasksService.createNote(id, note, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @Request() req: any,
  ) {
    return this.tasksService.update(id, dto, req.user?.id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.remove(id);
  }
}
