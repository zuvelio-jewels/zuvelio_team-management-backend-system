import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

const mockTask = { id: 1, title: 'Test task', personStatus: 'IN_PROGRESS' };

const mockTasksService = {
  create: jest.fn().mockResolvedValue(mockTask),
  findAll: jest.fn().mockResolvedValue([mockTask]),
  getSummary: jest.fn().mockResolvedValue({ total: 1 }),
  findOne: jest.fn().mockResolvedValue(mockTask),
  findNoteHistory: jest.fn().mockResolvedValue([]),
  createNote: jest.fn().mockResolvedValue({ id: 1 }),
  update: jest.fn().mockResolvedValue({ ...mockTask, title: 'Updated' }),
  remove: jest.fn().mockResolvedValue(mockTask),
};

describe('TasksController', () => {
  let controller: TasksController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: mockTasksService }],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll returns task list', async () => {
    const result = await controller.findAll();
    expect(result).toEqual([mockTask]);
  });

  it('findOne returns a single task', async () => {
    const result = await controller.findOne(1);
    expect(result).toEqual(mockTask);
    expect(mockTasksService.findOne).toHaveBeenCalledWith(1);
  });

  it('create calls service with dto and user id', async () => {
    const dto = { title: 'New', assignedToId: 1, completeBy: 'TODAY' } as any;
    const req = { user: { id: 5 } };
    const result = await controller.create(dto, req);
    expect(mockTasksService.create).toHaveBeenCalledWith(dto, 5);
    expect(result).toEqual(mockTask);
  });

  it('update calls service', async () => {
    const dto = { title: 'Updated' } as any;
    const req = { user: { id: 5 } };
    const result = await controller.update(1, dto, req);
    expect(result.title).toBe('Updated');
  });

  it('remove calls service', async () => {
    await controller.remove(1);
    expect(mockTasksService.remove).toHaveBeenCalledWith(1);
  });
});
