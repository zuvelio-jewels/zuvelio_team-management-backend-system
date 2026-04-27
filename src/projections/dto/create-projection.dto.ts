import {
  IsString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Min,
  IsDateString,
  IsArray,
} from 'class-validator';

export class CreateProjectionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  requiredSkills?: string[];

  @IsInt()
  @IsNotEmpty()
  @Min(1)
  allocatedMinutes: number;

  @IsInt()
  @IsNotEmpty()
  employeeId: number;

  @IsDateString()
  @IsOptional()
  deadline?: string;
}
