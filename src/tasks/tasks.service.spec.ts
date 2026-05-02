import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';

const mockTask = {
  id: 1,
  title: 'Test task',
  personStatus: 'IN_PROGRESS',
  deadline: new Date(Date.now() + 86400000), // tomorrow
  updatedBy: null,
  qcCheck: null,
};

const mockPrisma = {
  task: {
    findMany: jest.fn().mockResolvedValue([mockTask]),
    findUnique: jest.fn().mockResolvedValue(mockTask),
    create: jest.fn().mockResolvedValue(mockTask),
    update: jest.fn().mockResolvedValue(mockTask),
    delete: jest.fn().mockResolvedValue(mockTask),
  },
  taskNote: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 1, note: 'note' }),
  },
};

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeAlert', () => {
    it('returns RE_WORK when qcCheck is ISSUE', () => {
      const result = service.computeAlert({
        personStatus: 'IN_PROGRESS',
        deadline: new Date(),
        updatedBy: null,
        qcCheck: 'ISSUE',
      });
      expect(result).toBe('RE_WORK');
    });

    it('returns COMPLETE_IN_TIME for DONE task within deadline', () => {
      const deadline = new Date(Date.now() + 60000);
      const updatedBy = new Date(Date.now() - 60000);
      const result = service.computeAlert({
        personStatus: 'DONE',
        deadline,
        updatedBy,
        qcCheck: null,
      });
      expect(result).toBe('COMPLETE_IN_TIME');
    });

    it('returns UNDER_PROCESS_IN_TIME for IN_PROGRESS task before deadline', () => {
      const result = service.computeAlert({
        personStatus: 'IN_PROGRESS',
        deadline: new Date(Date.now() + 86400000),
        updatedBy: null,
        qcCheck: null,
      });
      expect(result).toBe('UNDER_PROCESS_IN_TIME');
    });

    it('returns UNDER_PROCESS_TIMEOUT for IN_PROGRESS task past deadline', () => {
      const result = service.computeAlert({
        personStatus: 'IN_PROGRESS',
        deadline: new Date(Date.now() - 86400000),
        updatedBy: null,
        qcCheck: null,
      });
      expect(result).toBe('UNDER_PROCESS_TIMEOUT');
    });

    it('returns STUCK_IN_TIME for STUCK task before deadline', () => {
      const result = service.computeAlert({
        personStatus: 'STUCK',
        deadline: new Date(Date.now() + 86400000),
        updatedBy: null,
        qcCheck: null,
      });
      expect(result).toBe('STUCK_IN_TIME');
    });

    it('returns STUCK_WITH_TIMEOUT for STUCK task past deadline', () => {
      const result = service.computeAlert({
        personStatus: 'STUCK',
        deadline: new Date(Date.now() - 86400000),
        updatedBy: null,
        qcCheck: null,
      });
      expect(result).toBe('STUCK_WITH_TIMEOUT');
    });
  });
});
