import { Exclude } from 'class-transformer';

export class UserMinimalDto {
  id: number;
  name: string;

  @Exclude()
  email?: string;

  @Exclude()
  role?: string;
}

export class TaskResponseDto {
  id: number;
  taskDetail: string;
  description?: string;
  priority: string;
  personStatus: string;
  qcCheck: string;
  cabin: string;
  completeby: Date;
  deadline: Date;
  documents?: any[];
  note?: string;
  remark?: string;
  alert?: string;
  createdAt: Date;
  updatedAt: Date;

  assignedTo: UserMinimalDto;
  allottedFrom: UserMinimalDto;

  @Exclude()
  taskDetail_?: string;

  @Exclude()
  updatedBy?: Date;

  @Exclude()
  allottedFromId?: number;

  @Exclude()
  assignedToId?: number;
}

export class TaskNoteResponseDto {
  id: number;
  note: string;
  createdAt: Date;
  author: UserMinimalDto;
}
