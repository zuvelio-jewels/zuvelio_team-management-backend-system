import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ApproveUserDto {
  @IsEnum(Role)
  role: Role;
}
