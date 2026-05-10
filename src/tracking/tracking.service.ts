import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis.service.js';
import { DriverStatus } from '../../generated/prisma/client.js';
type DriverLocation = {
  lat: number;
  lng: number;
  timeStamp: number;
};
@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Cron('*/15 * * * * *') // every 15 sec
  async persistLocations() {
    console.log('⏳ Persisting tracking data...');

    // get all active drivers
    const drivers = await this.prisma.driver.findMany({
      where: {
        status: DriverStatus.ASSIGNED,
      },
    });

    for (const driver of drivers) {
      const data = await this.redis.get(driver.id);

      if (!data) continue;

      let parsed: DriverLocation;
      try {
        parsed = JSON.parse(data) as DriverLocation;
      } catch {
        return;
      }

      // find active assignment
      const assignment = await this.prisma.assignment.findFirst({
        where: {
          driverId: driver.id,
          status: DriverStatus.ASSIGNED,
        },
      });

      if (!assignment) continue;

      await this.prisma.trackingEvent.create({
        data: {
          orderId: assignment.orderId,
          driverId: driver.id,
          lat: parsed.lat,
          lng: parsed.lng,
        },
      });
    }
  }
}
