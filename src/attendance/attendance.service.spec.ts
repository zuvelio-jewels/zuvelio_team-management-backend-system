import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const now = new Date();
const mockRecord = { id: 1, userId: 1, checkIn: now, checkOut: null, date: now };

const mockPrisma = {
  user: {
    findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Alice' }),
  },
  attendance: {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue(mockRecord),
    update: jest.fn().mockResolvedValue({ ...mockRecord, checkOut: now }),
    findMany: jest.fn().mockResolvedValue([mockRecord]),
  },
};

const mockConfig = { get: jest.fn().mockReturnValue(undefined) };

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkIn', () => {
    it('throws BadRequestException when already checked in today', async () => {
      mockPrisma.attendance.findFirst.mockResolvedValue(mockRecord);
      await expect(service.checkIn(1)).rejects.toThrow(BadRequestException);
    });

    it('creates attendance record when not yet checked in', async () => {
      mockPrisma.attendance.findFirst.mockResolvedValue(null);
      const result = await service.checkIn(1);
      expect(mockPrisma.attendance.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRecord);
    });
  });

  describe('checkOut', () => {
    it('throws BadRequestException when no check-in record exists', async () => {
      mockPrisma.attendance.findFirst.mockResolvedValue(null);
      await expect(service.checkOut(1)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already checked out', async () => {
      mockPrisma.attendance.findFirst.mockResolvedValue({ ...mockRecord, checkOut: now });
      await expect(service.checkOut(1)).rejects.toThrow(BadRequestException);
    });

    it('updates record with checkOut time', async () => {
      mockPrisma.attendance.findFirst.mockResolvedValue(mockRecord);
      const result = await service.checkOut(1);
      expect(mockPrisma.attendance.update).toHaveBeenCalledTimes(1);
      expect(result.checkOut).toBeDefined();
    });
  });
});
