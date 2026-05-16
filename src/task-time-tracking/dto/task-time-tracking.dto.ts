import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartTaskTimerDto {
  @IsInt()
  @IsNotEmpty()
  taskId: number;
}

export class SwitchTaskTimerDto {
  @IsInt()
  @IsNotEmpty()
  timeLogId: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CreateTaskOperationDto {
  @IsInt()
  @IsNotEmpty()
  taskId: number;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  order?: number;
}
