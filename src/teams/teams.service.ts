import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

const MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  empcode: true,
  role: true,
  profilePicture: true,
};

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.team.findMany({
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(dto: CreateTeamDto) {
    const existing = await this.prisma.team.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A team with this name already exists');

    return this.prisma.team.create({
      data: {
        name: dto.name,
        managerId: dto.managerId ?? null,
        members: dto.memberIds?.length
          ? { connect: dto.memberIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
    });
  }

  async update(id: number, dto: UpdateTeamDto) {
    await this.findOne(id);

    if (dto.name) {
      const existing = await this.prisma.team.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException('A team with this name already exists');
    }

    return this.prisma.team.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...('managerId' in dto && { managerId: dto.managerId ?? null }),
        ...(dto.memberIds !== undefined && {
          members: {
            set: dto.memberIds.map((uid) => ({ id: uid })),
          },
        }),
      },
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.team.delete({ where: { id } });
    return { message: 'Team deleted successfully' };
  }

  async addMember(teamId: number, userId: number) {
    await this.findOne(teamId);
    return this.prisma.team.update({
      where: { id: teamId },
      data: { members: { connect: { id: userId } } },
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
    });
  }

  async removeMember(teamId: number, userId: number) {
    await this.findOne(teamId);
    return this.prisma.team.update({
      where: { id: teamId },
      data: { members: { disconnect: { id: userId } } },
      include: {
        manager: { select: MEMBER_SELECT },
        members: { select: MEMBER_SELECT },
      },
    });
  }
}
