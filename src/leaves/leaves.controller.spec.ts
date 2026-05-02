import { Test, TestingModule } from '@nestjs/testing';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';

const mockLeave = { id: 1, userId: 1, type: 'SICK', status: 'PENDING' };

const mockLeavesService = {
  getMyLeaves: jest.fn().mockResolvedValue([mockLeave]),
  create: jest.fn().mockResolvedValue(mockLeave),
  update: jest.fn().mockResolvedValue({ ...mockLeave, status: 'APPROVED' }),
};

describe('LeavesController', () => {
  let controller: LeavesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeavesController],
      providers: [{ provide: LeavesService, useValue: mockLeavesService }],
    }).compile();

    controller = module.get<LeavesController>(LeavesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll returns leaves for the current user', async () => {
    const req = { user: { id: 1 } };
    const result = await controller.findAll(req);
    expect(mockLeavesService.getMyLeaves).toHaveBeenCalledWith(1);
    expect(result).toEqual([mockLeave]);
  });

  it('create submits a leave request for the current user', async () => {
    const req = { user: { id: 1 } };
    const body = { type: 'SICK', fromDate: '2026-05-01', toDate: '2026-05-02' };
    const result = await controller.create(req, body);
    expect(mockLeavesService.create).toHaveBeenCalledWith(1, body);
    expect(result.status).toBe('PENDING');
  });

  it('update patches a leave record', async () => {
    const result = await controller.update('1', { status: 'APPROVED' });
    expect(mockLeavesService.update).toHaveBeenCalledWith(1, { status: 'APPROVED' });
    expect(result.status).toBe('APPROVED');
  });
});
