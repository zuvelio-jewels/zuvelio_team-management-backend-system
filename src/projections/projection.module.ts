import { Module } from '@nestjs/common';
import { ProjectionService } from './projection.service';
import { ProjectionController } from './projection.controller';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [NotificationModule],
  providers: [ProjectionService],
  controllers: [ProjectionController],
  exports: [ProjectionService],
})
export class ProjectionModule {}
