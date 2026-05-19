import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service.js';
import { RedisService } from '../redis.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { OsrmRouteService } from './osrm-route.service.js';
import { AssignmentStatus } from '../../generated/prisma/client.js';

interface SimulatorOptions {
  intervalMs: number;
  speedMultiplier: number;
  loop: boolean;
}

interface RoutePoint {
  lat: number;
  lng: number;
}

function headingBetween(from: RoutePoint, to: RoutePoint): number {
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  const rad = Math.atan2(dLng, dLat);
  return (rad * 180) / Math.PI;
}

@Injectable()
export class TrackingSimulatorService {
  private readonly logger = new Logger(TrackingSimulatorService.name);
  private activeSimulators = new Map<string, NodeJS.Timeout>();
  private routeCache = new Map<string, RoutePoint[]>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly trackingGateway: TrackingGateway,
    private readonly osrmRouteService: OsrmRouteService,
  ) {}

  private isEnabled(): boolean {
    const val = this.configService.get<string>('ENABLE_TRACKING_SIMULATOR');
    return val === 'true';
  }

  async start(
    orderId: string,
    options: Partial<SimulatorOptions>,
  ): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('Tracking simulator is disabled');
    }

    if (this.activeSimulators.has(orderId)) {
      this.stop(orderId);
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: { orderId, status: AssignmentStatus.ASSIGNED },
      include: {
        order: {
          select: {
            pickupLat: true,
            pickupLng: true,
            deliveryLat: true,
            deliveryLng: true,
          },
        },
        driver: { select: { id: true } },
      },
    });

    if (!assignment || !assignment.driver) {
      throw new Error('No active driver assignment for this order');
    }

    const driverId = assignment.driver.id;
    const pickup = {
      lat: assignment.order.pickupLat,
      lng: assignment.order.pickupLng,
    };
    const destination = {
      lat: assignment.order.deliveryLat,
      lng: assignment.order.deliveryLng,
    };

    const cached = this.routeCache.get(orderId);
    let route: RoutePoint[];
    if (cached) {
      route = cached;
    } else {
      const result = await this.osrmRouteService.getRoutePoints(
        pickup,
        destination,
      );
      route = result.points;
      this.logger.log({
        msg: '[simulator] route loaded',
        orderId,
        points: route.length,
        source: result.source,
      });
      this.routeCache.set(orderId, route);
    }

    const intervalMs = options.intervalMs ?? 1000;
    const speedMultiplier = options.speedMultiplier ?? 1;
    const loop = options.loop ?? true;
    const stepMs = Math.max(100, intervalMs / speedMultiplier);
    const stepSize = Math.max(1, Math.round(speedMultiplier));

    let index = 0;
    const totalSteps = route.length;

    const tick = () => {
      const pt = route[index];
      const speed = Math.round(35 + Math.random() * 15);
      const nextIdx = Math.min(index + stepSize, totalSteps - 1);
      const heading = headingBetween(route[index], route[nextIdx]);

      const payload = {
        driverId,
        lat: pt.lat,
        lng: pt.lng,
        speed,
        heading,
        timestamp: Date.now(),
      };

      const channel = `driver:${driverId}`;
      this.redis.publish(channel, JSON.stringify(payload)).catch(() => {});
      this.trackingGateway.emitToOrderRoom(orderId, 'locationUpdate', payload);
      this.redis
        .set(
          channel + ':latest',
          JSON.stringify({ lat: pt.lat, lng: pt.lng, timeStamp: new Date() }),
        )
        .catch(() => {});

      index += stepSize;

      if (index >= totalSteps) {
        if (loop) {
          index = 0;
        } else {
          const finalPt = route[route.length - 1];
          this.trackingGateway.emitToOrderRoom(orderId, 'locationUpdate', {
            driverId,
            lat: finalPt.lat,
            lng: finalPt.lng,
            speed: 0,
            heading: 0,
            timestamp: Date.now(),
          });
          this.trackingGateway.emitToOrderRoom(
            orderId,
            'shipmentStatusUpdate',
            {
              orderId,
              status: 'DELIVERED',
              message: 'Shipment delivered',
            },
          );
          // TODO: persist DELIVERED status to database
          this.stop(orderId);
          return;
        }
      }
    };

    const timer = setInterval(tick, Math.round(stepMs));
    this.activeSimulators.set(orderId, timer);
  }

  stop(orderId: string): boolean {
    const timer = this.activeSimulators.get(orderId);
    if (timer) {
      clearInterval(timer);
      this.activeSimulators.delete(orderId);
      return true;
    }
    return false;
  }

  isRunning(orderId: string): boolean {
    return this.activeSimulators.has(orderId);
  }
}
