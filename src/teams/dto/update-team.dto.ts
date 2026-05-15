import { IsString, IsOptional, IsInt, IsArray } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  managerId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  memberIds?: number[];
}
