import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { OrderModule } from './order/order.module.js';
import { ConfigModule } from '@nestjs/config';
import { DriverController } from './driver/driver.controller.js';
import { DriverService } from './driver/driver.service.js';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { TrackingGateway } from './tracking/tracking.gateway.js';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health/health.controller.js';
import Joi from 'joi';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().optional().default('redis://localhost:6379'),
        JWT_SECRET: Joi.string().required(),
        CORS_ORIGINS: Joi.string().required(),
        PORT: Joi.number().optional().default(3000),
      }),
    }),
    OrderModule,
    ScheduleModule.forRoot(),
    AuthModule,
  ],
  controllers: [AppController, DriverController, HealthController],
  providers: [
    AppService,
    DriverService,
    PrismaService,
    RedisService,
    TrackingGateway,
  ],
})
export class AppModule {}
