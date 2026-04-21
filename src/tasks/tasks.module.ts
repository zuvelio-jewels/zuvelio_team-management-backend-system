import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskDocumentsService } from './task-documents.service';
import { TaskDocumentsController } from './task-documents.controller';

@Module({
  providers: [TasksService, TaskDocumentsService],
  controllers: [TasksController, TaskDocumentsController],
})
export class TasksModule { }
