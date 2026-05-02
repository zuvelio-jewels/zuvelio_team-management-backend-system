import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

const now = new Date();
const mockRecord = { id: 1, userId: 1, checkIn: now, checkOut: null, date: now };

const mockAttendanceService = {
  getAll: jest.fn().mockResolvedValue([mockRecord]),
  getAllRecords: jest.fn().mockResolvedValue([mockRecord]),
  checkIn: jest.fn().mockResolvedValue(mockRecord),
  checkOut: jest.fn().mockResolvedValue({ ...mockRecord, checkOut: now }),
  getAvailability: jest.fn().mockResolvedValue([]),
};

describe('AttendanceController', () => {
  let controller: AttendanceController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [{ provide: AttendanceService, useValue: mockAttendanceService }],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll calls service with userId from request', async () => {
    const req = { user: { id: 1 } };
    const result = await controller.findAll(req);
    expect(mockAttendanceService.getAll).toHaveBeenCalledWith(1);
    expect(result).toEqual([mockRecord]);
  });

  it('checkIn calls service with userId from request', async () => {
    const req = { user: { id: 1 } };
    const result = await controller.checkIn(req);
    expect(mockAttendanceService.checkIn).toHaveBeenCalledWith(1);
    expect(result).toEqual(mockRecord);
  });

  it('checkOut calls service with userId from request', async () => {
    const req = { user: { id: 1 } };
    const result = await controller.checkOut(req);
    expect(mockAttendanceService.checkOut).toHaveBeenCalledWith(1);
    expect(result.checkOut).toBeDefined();
  });

  it('getAvailability parses comma-separated userIds', async () => {
    await controller.getAvailability('1,2,3');
    expect(mockAttendanceService.getAvailability).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('getAvailability passes undefined when no userIds given', async () => {
    await controller.getAvailability(undefined);
    expect(mockAttendanceService.getAvailability).toHaveBeenCalledWith(undefined);
  });
});
