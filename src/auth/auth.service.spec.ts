import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-token'),
  verify: jest.fn(),
};

const mockConfig = { get: jest.fn().mockReturnValue('test-secret') };

const mockMailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: MailerService, useValue: mockMailer },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@b.com' });
      await expect(
        service.register({ name: 'Test', email: 'a@b.com', password: 'pass' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user when email is new', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        name: 'Test',
        email: 'new@b.com',
        role: 'EMPLOYEE',
        createdAt: new Date(),
      });
      const result = await service.register({
        name: 'Test',
        email: 'new@b.com',
        password: 'pass',
      });
      expect(result.message).toContain('Registration successful');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'no@b.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when account not approved', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        isApproved: false,
        isActive: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await expect(
        service.login({ email: 'pending@b.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
