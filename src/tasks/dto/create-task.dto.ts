import { IsNotEmpty, IsString, IsInt, IsOptional, IsIn, Min } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  cabin: string;

  @IsString()
  @IsOptional()
  taskDetail?: string;

  @IsString()
  @IsIn(['TODAY', 'TOMORROW', 'WITHIN_3_DAYS', 'WITHIN_7_DAYS', 'CUSTOM'])
  completeBy: string;

  @IsOptional()
  @IsString()
  customDeadline?: string;

  @IsInt()
  assignedToId: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  allocatedMinutes?: number;
}
