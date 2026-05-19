import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProjectionOperationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  allocatedMinutes?: number;

  @IsInt()
  @IsOptional()
  order?: number;
}

export class UpdateProjectionOperationDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  allocatedMinutes?: number;

  @IsInt()
  @IsOptional()
  order?: number;
}

export class BulkCreateOperationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProjectionOperationDto)
  operations: CreateProjectionOperationDto[];
}
