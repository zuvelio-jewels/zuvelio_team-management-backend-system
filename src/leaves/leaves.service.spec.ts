import { Test, TestingModule } from '@nestjs/testing';
import { LeavesService } from './leaves.service';
import { PrismaService } from '../prisma/prisma.service';

const mockLeave = {
  id: 1,
  userId: 1,
  type: 'SICK',
  fromDate: new Date('2026-05-01'),
  toDate: new Date('2026-05-02'),
  status: 'PENDING',
};

const mockPrisma = {
  leave: {
    findMany: jest.fn().mockResolvedValue([mockLeave]),
    create: jest.fn().mockResolvedValue(mockLeave),
    update: jest.fn().mockResolvedValue({ ...mockLeave, status: 'APPROVED' }),
  },
};

describe('LeavesService', () => {
  let service: LeavesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getMyLeaves filters leaves by userId', async () => {
    const result = await service.getMyLeaves(1);
    expect(result).toEqual([mockLeave]);
    expect(mockPrisma.leave.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    );
  });

  it('create saves a new leave with PENDING status', async () => {
    const data = { type: 'SICK', fromDate: '2026-05-01', toDate: '2026-05-02' };
    const result = await service.create(1, data);
    expect(result.status).toBe('PENDING');
    expect(mockPrisma.leave.create).toHaveBeenCalledTimes(1);
  });

  it('update can approve a leave', async () => {
    const result = await service.update(1, { status: 'APPROVED' });
    expect(result.status).toBe('APPROVED');
    expect(mockPrisma.leave.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });
});
