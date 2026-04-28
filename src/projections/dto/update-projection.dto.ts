import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  IsIn,
} from 'class-validator';

export class UpdateProjectionDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  allocatedMinutes?: number;

  @IsString()
  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'INCOMPLETE'])
  status?: string;
}
