import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  // Get employee notifications
  @Get()
  getNotifications(
    @Request() req: any,
    @Query('isRead') isRead?: string,
    @Query('isDismissed') isDismissed?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.notificationService.getEmployeeNotifications(req?.user?.id, {
      isRead: isRead === 'true',
      isDismissed: isDismissed === 'true',
      limit,
    });
  }

  // Get unread count
  @Get('count/unread')
  getUnreadCount(@Request() req) {
    return this.notificationService.getUnreadCount(req.user.id);
  }

  // Get single notification
  @Get(':id')
  getNotification(@Param('id', ParseIntPipe) id: number) {
    return this.notificationService.getById(id);
  }

  // Mark as read
  @Post(':id/read')
  markAsRead(
    @Param('id', ParseIntPipe) notificationId: number,
    @Request() req,
  ) {
    return this.notificationService.markAsRead(notificationId, req.user.id);
  }

  // Dismiss notification
  @Post(':id/dismiss')
  dismissNotification(
    @Param('id', ParseIntPipe) notificationId: number,
    @Request() req,
  ) {
    return this.notificationService.dismissNotification(
      notificationId,
      req.user.id,
    );
  }

  // Mark all as read
  @Post('mark-all/read')
  markAllAsRead(@Request() req) {
    return this.notificationService.markAllAsRead(req.user.id);
  }
}
