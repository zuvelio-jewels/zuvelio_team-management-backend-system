import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateProfileDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    @MaxLength(50)
    name: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;
}
