import { Module } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service';
import { TimeTrackingController } from './time-tracking.controller';

@Module({
  providers: [TimeTrackingService],
  controllers: [TimeTrackingController],
  exports: [TimeTrackingService],
})
export class TimeTrackingModule {}
