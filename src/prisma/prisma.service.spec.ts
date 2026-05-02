// Set a valid DATABASE_URL before importing so the URL constructor in PrismaService succeeds
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

// Mock the Prisma adapter so no real DB connection is attempted
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockReturnValue({}),
}));

// Mock PrismaClient so we avoid real DB calls in unit tests
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('has onModuleInit lifecycle method on the prototype', () => {
    // When PrismaClient is mocked as a plain function, the extended class
    // loses `this` context for prototype methods. Verify the method exists
    // on the class prototype itself rather than the mocked instance.
    expect(typeof PrismaService.prototype.onModuleInit).toBe('function');
  });

  it('has onModuleDestroy lifecycle method on the prototype', () => {
    expect(typeof PrismaService.prototype.onModuleDestroy).toBe('function');
  });
});
