import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  IsDateString,
  IsArray,
  IsIn,
} from 'class-validator';

export class UpdateProjectionDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  requiredSkills?: string[];

  @IsInt()
  @IsOptional()
  @Min(1)
  allocatedMinutes?: number;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsString()
  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'])
  status?: string;
}
