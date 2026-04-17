import { IsNotEmpty, IsString, IsInt, IsOptional, IsIn } from 'class-validator';

export class CreateTaskDto {
    @IsString()
    @IsNotEmpty()
    cabin: string;

    @IsString()
    @IsNotEmpty()
    taskDetail: string;

    @IsString()
    @IsIn(['TODAY', 'TOMORROW', 'WITHIN_3_DAYS', 'WITHIN_7_DAYS'])
    completeBy: string;

    @IsInt()
    assignedToId: number;

    @IsOptional()
    @IsString()
    note?: string;
}
