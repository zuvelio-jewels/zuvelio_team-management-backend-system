import { IsOptional, IsString, IsIn, IsBoolean } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  cabin?: string;

  @IsOptional()
  @IsString()
  taskDetail?: string;

  @IsOptional()
  @IsString()
  @IsIn(['TODAY', 'TOMORROW', 'WITHIN_3_DAYS', 'WITHIN_7_DAYS'])
  completeBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'STUCK', 'DONE'])
  personStatus?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DONE', 'ISSUE'])
  qcCheck?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsBoolean()
  isPresent?: boolean;
}
