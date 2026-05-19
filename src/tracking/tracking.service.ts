import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis.service.js';
import {
  DriverStatus,
  AssignmentStatus,
} from '../../generated/prisma/client.js';
import { TrackingResponseDto } from './dto/tracking-response.dto.js';

type DriverLocation = {
  lat: number;
  lng: number;
  timeStamp: number;
};

function mapOrderStatus(status: string): TrackingResponseDto['status'] {
  switch (status) {
    case 'CREATED':
    case 'PACKED':
      return 'PENDING';
    case 'PICKED':
      return 'PICKED_UP';
    case 'OUT_FOR_DELIVERY':
      return 'IN_TRANSIT';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function formatCoordLabel(label: string, lat: number, lng: number): string {
  return `${label} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}

function makeShipmentId(orderId: string): string {
  const short = orderId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `SHP-${short}`;
}

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getTrackingData(orderId: string): Promise<TrackingResponseDto | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        assignments: {
          include: { driver: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        trackingEvents: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (!order) return null;

    const assignment = order.assignments[0] ?? null;
    const driver = assignment?.driver ?? null;
    const latestEvent = order.trackingEvents[0] ?? null;

    let currentLocation: TrackingResponseDto['currentLocation'] = null;

    if (driver) {
      const redisKey = `driver:${driver.id}:latest`;
      const redisRaw = await this.redis.get(redisKey);
      if (redisRaw) {
        try {
          const parsed = JSON.parse(redisRaw) as DriverLocation;
          currentLocation = {
            lat: parsed.lat,
            lng: parsed.lng,
            speed: 0,
            heading: 0,
            timestamp: parsed.timeStamp,
          };
        } catch {
          // fall through to DB fallback
        }
      }
    }

    if (!currentLocation && latestEvent) {
      currentLocation = {
        lat: latestEvent.lat,
        lng: latestEvent.lng,
        speed: 0,
        heading: 0,
        timestamp: latestEvent.timestamp.getTime(),
      };
    }

    const vehicleId = driver
      ? `TRK-${driver.name.substring(0, 4).toUpperCase()}`
      : 'TRK-0000';

    let eta: string | null = null;
    if (order.eta) {
      const diffMs = order.eta.getTime() - Date.now();
      if (diffMs > 0) {
        const mins = Math.ceil(diffMs / 60000);
        eta = `${mins} min`;
      } else {
        eta = 'Now';
      }
    }

    return {
      orderId: order.id,
      shipmentId: makeShipmentId(order.id),
      status: mapOrderStatus(order.status),
      driver: driver ? { id: driver.id, name: driver.name, vehicleId } : null,
      pickup: {
        label: formatCoordLabel('Pickup', order.pickupLat, order.pickupLng),
        lat: order.pickupLat,
        lng: order.pickupLng,
      },
      destination: {
        label: formatCoordLabel(
          'Destination',
          order.deliveryLat,
          order.deliveryLng,
        ),
        lat: order.deliveryLat,
        lng: order.deliveryLng,
      },
      currentLocation,
      eta,
    };
  }

  async broadcastMockLocation(
    orderId: string,
    lat: number,
    lng: number,
    speed: number,
    heading: number,
  ): Promise<{ driverId: string }> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { orderId, status: AssignmentStatus.ASSIGNED },
    });

    if (!assignment) {
      throw new Error('No active driver assignment for this order');
    }

    const driverId = assignment.driverId;
    const channel = `driver:${driverId}`;
    const now = new Date();

    await this.redis.set(
      channel + ':latest',
      JSON.stringify({ lat, lng, timeStamp: now }),
    );

    await this.redis.publish(
      channel,
      JSON.stringify({
        driverId,
        lat,
        lng,
        speed,
        heading,
        timestamp: now.getTime(),
      }),
    );

    console.log(
      `[mock] broadcasted location for driver ${driverId}: ${lat}, ${lng}`,
    );

    return { driverId };
  }

  private readonly logger = new Logger(TrackingService.name);

  @Cron('*/15 * * * * *') // every 15 sec
  async persistLocations() {
    if (process.env.DEBUG_TRACKING_PERSISTENCE === 'true') {
      this.logger.log('Persisting tracking data...');
    }

    const drivers = await this.prisma.driver.findMany({
      where: {
        status: DriverStatus.ASSIGNED,
      },
    });

    let persisted = 0;

    for (const driver of drivers) {
      const data = await this.redis.get(driver.id);

      if (!data) continue;

      let parsed: DriverLocation;
      try {
        parsed = JSON.parse(data) as DriverLocation;
      } catch {
        return;
      }

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

      persisted++;
    }

    if (persisted > 0) {
      this.logger.log(`Persisted ${persisted} tracking event(s)`);
    }
  }
}
