import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type ExternalAttendanceItem = {
  Empcode: string;
  Name: string;
  DateString: string;
  Status: string;
  INTime: string;
  OUTTime: string;
};

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getAll(userId: number) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    if (!currentUser) {
      return [];
    }

    const records = await this.fetchExternalAttendance();
    return records
      .filter(
        (record) =>
          this.normalizeName(record.Name) ===
          this.normalizeName(currentUser.name),
      )
      .map((record, index) => this.mapExternalRecord(record, index + 1));
  }

  async checkIn(userId: number) {
    const now = new Date();
    const { start, end } = this.getTodayRange(now);

    const existing = await this.prisma.attendance.findFirst({
      where: {
        userId,
        date: { gte: start, lte: end },
      },
      orderBy: { id: 'desc' },
    });

    if (existing?.checkIn && !existing.checkOut) {
      throw new BadRequestException('You are already checked in');
    }

    if (existing?.checkIn && existing.checkOut) {
      throw new BadRequestException('Attendance already completed for today');
    }

    if (existing) {
      return this.prisma.attendance.update({
        where: { id: existing.id },
        data: { checkIn: now, checkOut: null },
      });
    }

    return this.prisma.attendance.create({
      data: {
        userId,
        date: now,
        checkIn: now,
      },
    });
  }

  async checkOut(userId: number) {
    const now = new Date();
    const { start, end } = this.getTodayRange(now);

    const existing = await this.prisma.attendance.findFirst({
      where: {
        userId,
        date: { gte: start, lte: end },
      },
      orderBy: { id: 'desc' },
    });

    if (!existing?.checkIn) {
      throw new BadRequestException('You must check in first');
    }

    if (existing.checkOut) {
      throw new BadRequestException('You are already checked out');
    }

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: { checkOut: now },
    });
  }

  async getAvailability(userIds?: number[]) {
    const userWhere = userIds?.length
      ? { isActive: true, id: { in: userIds } }
      : { isActive: true };

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });

    if (users.length === 0) {
      return [];
    }

    const externalRecords = await this.fetchExternalAttendance();
    const todayKey = this.formatExternalDate(new Date());
    const latestByName = new Map<string, ExternalAttendanceItem>();

    for (const record of externalRecords) {
      if (this.cleanDateString(record.DateString) !== todayKey) {
        continue;
      }

      const normalizedName = this.normalizeName(record.Name);
      if (!latestByName.has(normalizedName)) {
        latestByName.set(normalizedName, record);
      }
    }

    return users.map((user) => {
      const record = latestByName.get(this.normalizeName(user.name));
      const normalized = record ? this.normalizePunchTimes(record) : null;
      const attendanceStatus = this.getAvailabilityStatus(record, normalized);
      const dateIso = record ? this.toIsoDateTime(record.DateString) : null;

      return {
        ...user,
        attendanceStatus,
        available: attendanceStatus === 'AVAILABLE',
        attendanceId: record
          ? `${this.cleanDateString(record.DateString)}|${this.normalizeEmpcode(record.Empcode)}`
          : null,
        empcode: record ? this.normalizeEmpcode(record.Empcode) : null,
        sourceStatus: record?.Status ?? null,
        date: dateIso,
        checkIn: normalized ? this.combineDateTime(dateIso, normalized.checkIn) : null,
        checkOut: normalized ? this.combineDateTime(dateIso, normalized.checkOut) : null,
      };
    });
  }

  private async fetchExternalAttendance(): Promise<ExternalAttendanceItem[]> {
    const authHeader = this.configService.get<string>(
      'ETIMEOFFICE_AUTH_HEADER',
      'Basic enV2ZWxpbzp6dXZlbGlvOlp1dmVsaW9AMDAwMDp0cnVl',
    );
    const baseUrl = this.configService.get<string>(
      'ETIMEOFFICE_API_URL',
      'https://api.etimeoffice.com/api/DownloadInOutPunchData',
    );
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - 3);

    const url = `${baseUrl}?Empcode=ALL&FromDate=${this.formatExternalDate(fromDate)}&ToDate=${this.formatExternalDate(today)}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[Attendance API] Status ${response.status}: ${errorText}`,
        );

        if (response.status === 401) {
          throw new InternalServerErrorException(
            'Attendance API authentication failed (401 Unauthorized). Please verify ETIMEOFFICE_AUTH_HEADER in .env is valid.',
          );
        }

        throw new InternalServerErrorException(
          `Attendance API request failed with status ${response.status}`,
        );
      }

      const json = await response.json();
      if (json?.Error !== false || !Array.isArray(json?.InOutPunchData)) {
        console.error('[Attendance API] Invalid payload:', json);
        throw new InternalServerErrorException(
          'Attendance API returned an invalid payload',
        );
      }

      return json.InOutPunchData as ExternalAttendanceItem[];
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      console.error('[Attendance API] Fetch error:', error);
      throw new InternalServerErrorException(
        `Failed to fetch attendance data: ${error.message}`,
      );
    }
  }

  private mapExternalRecord(record: ExternalAttendanceItem, id: number) {
    const normalized = this.normalizePunchTimes(record);
    const dateString = this.toIsoDateTime(record.DateString);

    // Combine date with time to create full ISO datetime strings
    const checkInDateTime = this.combineDateTime(dateString, normalized.checkIn);
    const checkOutDateTime = this.combineDateTime(dateString, normalized.checkOut);

    return {
      id,
      userId: null,
      empcode: this.normalizeEmpcode(record.Empcode),
      name: record.Name,
      status: record.Status,
      date: dateString,
      checkIn: checkInDateTime,
      checkOut: checkOutDateTime,
    };
  }

  private normalizePunchTimes(record: ExternalAttendanceItem) {
    if (record.Status === 'WO') {
      return { checkIn: 'WO', checkOut: 'WO' };
    }

    if (record.Status === 'A') {
      return { checkIn: '00:00', checkOut: '00:00' };
    }

    return {
      checkIn: record.INTime === '--:--' ? '00:00' : record.INTime,
      checkOut: record.OUTTime === '--:--' ? '00:00' : record.OUTTime,
    };
  }

  private getAvailabilityStatus(
    record: ExternalAttendanceItem | undefined,
    normalized: { checkIn: string; checkOut: string } | null,
  ): 'ABSENT' | 'AVAILABLE' | 'CHECKED_OUT' {
    if (!record || !normalized) {
      return 'ABSENT';
    }

    if (
      record.Status === 'A' ||
      record.Status === 'WO' ||
      normalized.checkIn === '00:00'
    ) {
      return 'ABSENT';
    }

    if (normalized.checkOut !== '00:00') {
      return 'CHECKED_OUT';
    }

    return 'AVAILABLE';
  }

  private normalizeEmpcode(value: string) {
    return String(value).replace(/^0+/, '').trim();
  }

  private cleanDateString(value: string) {
    return String(value).replace(/-/g, '/').trim();
  }

  private normalizeName(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private formatExternalDate(date: Date) {
    const day = `${date.getDate()}`.padStart(2, '0');
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private toIsoDateTime(dateString: string) {
    const cleaned = this.cleanDateString(dateString);
    const [day, month, year] = cleaned.split('/').map(Number);

    if (!day || !month || !year) {
      return null;
    }

    return new Date(year, month - 1, day).toISOString();
  }

  private combineDateTime(dateIso: string | null, timeString: string): string | null {
    if (!dateIso) return null;
    if (timeString === 'WO' || timeString === 'A' || timeString === '00:00') {
      return null;
    }

    try {
      const date = new Date(dateIso);
      const [hours, minutes] = timeString.split(':').map(Number);

      if (isNaN(hours) || isNaN(minutes)) {
        return null;
      }

      date.setHours(hours, minutes, 0, 0);
      return date.toISOString();
    } catch (e) {
      return null;
    }
  }

  private getTodayRange(now: Date) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }
}
