import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  getProfile: jest.fn(),
  refreshTokens: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('register delegates to authService.register', async () => {
    const dto = { name: 'Test', email: 'a@b.com', password: 'pass' };
    mockAuthService.register.mockResolvedValue({ message: 'Registration successful!' });
    const result = await controller.register(dto as any);
    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    expect(result.message).toContain('Registration successful');
  });

  it('login delegates to authService.login', async () => {
    const dto = { email: 'a@b.com', password: 'pass' };
    mockAuthService.login.mockResolvedValue({ accessToken: 'tok' });
    const result = await controller.login(dto as any);
    expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    expect(result.accessToken).toBe('tok');
  });

  it('logout delegates to authService.logout with user id', async () => {
    mockAuthService.logout.mockResolvedValue({ success: true });
    await controller.logout(42);
    expect(mockAuthService.logout).toHaveBeenCalledWith(42);
  });

  it('getProfile delegates to authService.getProfile', async () => {
    mockAuthService.getProfile.mockResolvedValue({ id: 1, name: 'Test' });
    const result = await controller.getProfile(1);
    expect(mockAuthService.getProfile).toHaveBeenCalledWith(1);
    expect(result.name).toBe('Test');
  });
});
