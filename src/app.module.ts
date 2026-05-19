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
import { TrackingService } from './tracking/tracking.service.js';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { DemoModule } from './demo/demo.module.js';
import { HealthController } from './health/health.controller.js';
import { TrackingController } from './tracking/tracking.controller.js';
import { TrackingSimulatorService } from './tracking/tracking-simulator.service.js';
import { OsrmRouteService } from './tracking/osrm-route.service.js';
import { MapController } from './map/map.controller.js';
import { MapService } from './map/map.service.js';
import { OverpassService } from './map/overpass.service.js';
import { OsmController } from './map/osm.controller.js';
import { OsmDatabaseService } from './map/osm-database.service.js';
import Joi from 'joi';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().optional().default('development'),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().optional().default('redis://localhost:6379'),
        OSM_DATABASE_URL: Joi.string()
          .optional()
          .default('postgresql://osm:osm@localhost:5433/osm_india'),
        JWT_SECRET: Joi.string().required(),
        CORS_ORIGINS: Joi.string().optional().default(''),
        PORT: Joi.number().optional().default(3000),
        ENABLE_TRACKING_SIMULATOR: Joi.string().optional().default('false'),
        OSRM_URL: Joi.string()
          .optional()
          .default('https://router.project-osrm.org'),
      }),
    }),
    OrderModule,
    ScheduleModule.forRoot(),
    AuthModule,
    DemoModule,
  ],
  controllers: [
    AppController,
    DriverController,
    HealthController,
    TrackingController,
    MapController,
    OsmController,
  ],
  providers: [
    AppService,
    DriverService,
    PrismaService,
    RedisService,
    TrackingGateway,
    TrackingService,
    TrackingSimulatorService,
    OsrmRouteService,
    MapService,
    OverpassService,
    OsmDatabaseService,
  ],
})
export class AppModule {}
