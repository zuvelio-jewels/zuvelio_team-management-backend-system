import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUsers = [
  { id: 1, name: 'Alice', email: 'alice@test.com', role: 'EMPLOYEE', isAssignable: true, isProjectAssignable: false, isApproved: true },
  { id: 2, name: 'Bob',   email: 'bob@test.com',   role: 'MANAGER',  isAssignable: true, isProjectAssignable: true,  isApproved: true },
];

const mockPrisma = {
  user: {
    findMany: jest.fn().mockResolvedValue(mockUsers),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll returns all active users', async () => {
    const result = await service.findAll();
    expect(result).toEqual(mockUsers);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('findAssignable returns only assignable users', async () => {
    mockPrisma.user.findMany.mockResolvedValue([mockUsers[0]]);
    const result = await service.findAssignable();
    expect(result).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, isAssignable: true } }),
    );
  });

  it('findOne returns null for unknown id', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await service.findOne(999);
    expect(result).toBeNull();
  });

  it('findOne returns user when found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUsers[0]);
    const result = await service.findOne(1);
    expect(result).toEqual(mockUsers[0]);
  });
});
