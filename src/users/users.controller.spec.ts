import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockUsers = [
  { id: 1, name: 'Alice', email: 'alice@test.com', role: 'EMPLOYEE' },
  { id: 2, name: 'Bob', email: 'bob@test.com', role: 'MANAGER' },
];

const mockUsersService = {
  findAll: jest.fn().mockResolvedValue(mockUsers),
  findAssignable: jest.fn().mockResolvedValue([mockUsers[0]]),
  findProjectAssignable: jest.fn().mockResolvedValue([mockUsers[1]]),
  findPendingApproval: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(mockUsers[0]),
  setAssignable: jest.fn(),
  setProjectAssignable: jest.fn(),
  approveUser: jest.fn(),
  deleteUser: jest.fn(),
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll returns all users', async () => {
    const result = await controller.findAll();
    expect(result).toEqual(mockUsers);
    expect(mockUsersService.findAll).toHaveBeenCalledTimes(1);
  });

  it('findOne returns a single user', async () => {
    const result = await controller.findOne(1);
    expect(result).toEqual(mockUsers[0]);
    expect(mockUsersService.findOne).toHaveBeenCalledWith(1);
  });

  it('findAssignable returns assignable users', async () => {
    const result = await controller.findAssignable();
    expect(result).toHaveLength(1);
  });
});
