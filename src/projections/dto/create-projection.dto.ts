import {
  IsString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateProjectionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsNotEmpty()
  @Min(1)
  allocatedMinutes: number;

  @IsInt()
  @IsNotEmpty()
  employeeId: number;
}
