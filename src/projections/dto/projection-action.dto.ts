import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';

export class ProjectionActionDto {
  @IsString()
  @IsNotEmpty()
  actionType: string; // ACCEPT, REJECT, REQUEST_TIME, SWITCH_PROJECTION, RESUME_INCOMPLETE, PAUSE, RESUME, COMPLETE

  @IsString()
  @IsOptional()
  reason?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  additionalMinutes?: number; // For REQUEST_TIME action

  @IsInt()
  @IsOptional()
  switchToProjectionId?: number; // For SWITCH_PROJECTION action
}
