import { Module } from '@nestjs/common';
import { TaskTimeTrackingController } from './task-time-tracking.controller';
import { TaskTimeTrackingService } from './task-time-tracking.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TaskTimeTrackingController],
  providers: [TaskTimeTrackingService],
  exports: [TaskTimeTrackingService],
})
export class TaskTimeTrackingModule {}
