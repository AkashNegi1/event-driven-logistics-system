import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis.service.js';
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}
  @Get()
  async check() {
    let dbStatus = 'ok';
    let redisStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }
    try {
      const ping = await this.redis.get('health:ping');
      if (!ping) await this.redis.set('health:ping', 'ok');
    } catch {
      redisStatus = 'error';
    }
    return {
      status: dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
      database: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
    };
  }
}
