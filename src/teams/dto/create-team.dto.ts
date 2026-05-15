import { IsString, IsNotEmpty, IsOptional, IsInt, IsArray } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsInt()
  managerId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  memberIds?: number[];
}
