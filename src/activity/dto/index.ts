import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsArray,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateActivityEventDto {
  @IsEnum(['KEYPRESS', 'CLICK', 'MOUSE_MOVE'])
  eventType: 'KEYPRESS' | 'CLICK' | 'MOUSE_MOVE';

  @IsOptional()
  @IsString()
  keyCode?: string;

  @IsOptional()
  @IsNumber()
  mouseX?: number;

  @IsOptional()
  @IsNumber()
  mouseY?: number;

  @IsOptional()
  @IsEnum(['LEFT', 'RIGHT', 'MIDDLE'])
  clickType?: 'LEFT' | 'RIGHT' | 'MIDDLE';

  @IsOptional()
  @IsNumber()
  taskId?: number;

  @IsOptional()
  @IsString()
  sessionId?: string;

  /**
   * Optional ISO-8601 timestamp of when the event actually occurred.
   * The desktop agent sends the precise event time so the backend stores
   * accurate data even when events are batched or replayed from the offline queue.
   * Falls back to server-received time when omitted.
   */
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

export class CreateActivityBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateActivityEventDto)
  events: CreateActivityEventDto[];
}

export class GetActivitySummaryDto {
  @IsString()
  startDate: string;

  @IsString()
  endDate: string;
}

export class UpdateMonitoringConfigDto {
  @IsOptional()
  @IsBoolean()
  isMonitoringEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  startWorkHour?: number;

  @IsOptional()
  @IsNumber()
  endWorkHour?: number;

  @IsOptional()
  @IsNumber()
  idleThresholdMinutes?: number;
}

export class RegisterDeviceDto {
  @IsNumber()
  userId: number;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class DeviceTokenAuthDto {
  @IsString()
  deviceToken: string;
}
