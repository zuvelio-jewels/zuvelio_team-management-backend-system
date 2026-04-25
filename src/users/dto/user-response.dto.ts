import { Exclude } from 'class-transformer';

export class UserResponseDto {
  id: number;
  name: string;
  email: string;
  role: string;

  @Exclude()
  password?: string;

  @Exclude()
  refreshToken?: string;

  @Exclude()
  isEmailVerified?: boolean;

  @Exclude()
  failedLoginAttempts?: number;

  @Exclude()
  lockedUntil?: Date;

  @Exclude()
  createdAt?: Date;

  @Exclude()
  updatedAt?: Date;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;

  @Exclude()
  password?: string;
}
