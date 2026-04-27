import { IsInt, IsNotEmpty } from 'class-validator';

export class StartTimeLogDto {
  @IsInt()
  @IsNotEmpty()
  projectionId: number;
}
