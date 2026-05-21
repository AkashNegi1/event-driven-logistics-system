import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { randomBytes } from 'node:crypto';
import {
  OrderStatus,
  PaymentStatus,
  DriverStatus,
  DriverRole,
  AssignmentStatus,
  AssignmentType,
} from '../../generated/prisma/client.js';

export interface DemoOrderDto {
  label: string;
  description: string;
  orderId: string;
  status: string;
  pickup: { label: string; lat: number; lng: number };
  destination: { label: string; lat: number; lng: number };
}

export interface CustomDemoOrderInput {
  pickup: { label?: string; lat: number; lng: number };
  destination: { label?: string; lat: number; lng: number };
  customerName?: string;
  packageType?: string;
}

function makeShipmentId(orderId: string): string {
  const short = orderId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `SHP-${short}`;
}

export const DEMO_ORDERS = [
  {
    key: 'local-delhi',
    label: 'Local Delhi Delivery',
    description: 'Short live city delivery demo',
    pickup: { label: 'Chanakyapuri, New Delhi', lat: 28.61, lng: 77.2 },
    destination: { label: 'Connaught Place, New Delhi', lat: 28.63, lng: 77.22 },
  },
  {
    key: 'delhi-chandigarh',
    label: 'Delhi to Chandigarh Freight',
    description: 'Long route overview demo',
    pickup: { label: 'New Delhi', lat: 28.61, lng: 77.2 },
    destination: { label: 'Chandigarh', lat: 30.7486, lng: 76.6411 },
  },
];

@Injectable()
export class DemoService {
  constructor(private prisma: PrismaService) {}

  async getDemoOrders(): Promise<DemoOrderDto[]> {
    const results: DemoOrderDto[] = [];
    for (const demo of DEMO_ORDERS) {
      const order = await this.findDemoOrder(demo);
      if (order) {
        const shipmentStatus = this.mapOrderStatus(order.status);
        results.push({
          label: demo.label,
          description: demo.description,
          orderId: order.id,
          status: shipmentStatus,
          pickup: demo.pickup,
          destination: demo.destination,
        });
      }
    }
    return results;
  }

  async createOrGetDemoOrder(key: string): Promise<{ orderId: string; status: string }> {
    const demo = DEMO_ORDERS.find((d) => d.key === key);
    if (!demo) {
      throw new NotFoundException(`Demo order '${key}' not found. Available: ${DEMO_ORDERS.map((d) => d.key).join(', ')}`);
    }

    const existing = await this.findDemoOrder(demo);
    if (existing) {
      return { orderId: existing.id, status: this.mapOrderStatus(existing.status) };
    }

    const demoUser = await this.prisma.user.findFirst({ where: { email: 'akash@example.com' } });
    if (!demoUser) {
      throw new NotFoundException('Demo user not found. Run seed first.');
    }

    const order = await this.prisma.order.create({
      data: {
        userId: demoUser.id,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentStatus: PaymentStatus.PAID,
        pickupLat: demo.pickup.lat,
        pickupLng: demo.pickup.lng,
        deliveryLat: demo.destination.lat,
        deliveryLng: demo.destination.lng,
      },
    });

    await this.assignDemoDriver(order.id);

    return { orderId: order.id, status: this.mapOrderStatus(order.status) };
  }

  private async findDemoOrder(demo: (typeof DEMO_ORDERS)[number]) {
    const tolerance = 0.01;
    return this.prisma.order.findFirst({
      where: {
        pickupLat: { gte: demo.pickup.lat - tolerance, lte: demo.pickup.lat + tolerance },
        pickupLng: { gte: demo.pickup.lng - tolerance, lte: demo.pickup.lng + tolerance },
        deliveryLat: { gte: demo.destination.lat - tolerance, lte: demo.destination.lat + tolerance },
        deliveryLng: { gte: demo.destination.lng - tolerance, lte: demo.destination.lng + tolerance },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assignDemoDriver(orderId: string) {
    const existing = await this.prisma.assignment.findFirst({
      where: { orderId, status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.PICKED] } },
    });
    if (existing) return;

    const demoDriver = await this.prisma.driver.findFirst({ where: { email: 'driver1@example.com' } });
    if (!demoDriver) return;

    await this.prisma.assignment.create({
      data: { orderId, driverId: demoDriver.id, type: AssignmentType.DELIVERY, status: AssignmentStatus.ASSIGNED },
    });

    if (demoDriver.status === DriverStatus.AVAILABLE) {
      await this.prisma.driver.update({ where: { id: demoDriver.id }, data: { status: DriverStatus.ASSIGNED } });
    }

    const avgSpeedKmh = 30;
    const distanceKm = this.haversine(
      demoDriver.lat ?? 28.6139,
      demoDriver.lng ?? 77.209,
      (await this.prisma.order.findUnique({ where: { id: orderId } }))?.pickupLat ?? 28.61,
      (await this.prisma.order.findUnique({ where: { id: orderId } }))?.pickupLng ?? 77.2,
    );
    const eta = new Date(Date.now() + (distanceKm / avgSpeedKmh) * 3600000);
    await this.prisma.order.update({ where: { id: orderId }, data: { eta } });
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private mapOrderStatus(status: string): string {
    const map: Record<string, string> = {
      CREATED: 'PENDING',
      PACKED: 'PENDING',
      PICKED: 'PICKED_UP',
      OUT_FOR_DELIVERY: 'IN_TRANSIT',
      DELIVERED: 'DELIVERED',
      FAILED: 'FAILED',
    };
    return map[status] ?? 'PENDING';
  }

  async getDemoTrackingData(orderId: string) {
    const demoUser = await this.prisma.user.findFirst({ where: { email: 'akash@example.com' } });
    if (!demoUser) {
      throw new NotFoundException('Demo user not found. Run seed first.');
    }

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

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.userId !== demoUser.id) {
      throw new ForbiddenException('This order is not a demo order');
    }

    const assignment = order.assignments[0] ?? null;
    const driver = assignment?.driver ?? null;
    const latestEvent = order.trackingEvents[0] ?? null;

    let currentLocation: { lat: number; lng: number; speed: number; heading: number; timestamp: number } | null = null;
    if (latestEvent) {
      currentLocation = {
        lat: latestEvent.lat,
        lng: latestEvent.lng,
        speed: 0,
        heading: 0,
        timestamp: latestEvent.timestamp.getTime(),
      };
    }

    const vehicleId = driver ? `TRK-${driver.name.substring(0, 4).toUpperCase()}` : 'TRK-0000';

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
      status: this.mapOrderStatus(order.status),
      driver: driver ? { id: driver.id, name: driver.name, vehicleId } : null,
      pickup: {
        label: `Pickup (${order.pickupLat.toFixed(4)}, ${order.pickupLng.toFixed(4)})`,
        lat: order.pickupLat,
        lng: order.pickupLng,
      },
      destination: {
        label: `Destination (${order.deliveryLat.toFixed(4)}, ${order.deliveryLng.toFixed(4)})`,
        lat: order.deliveryLat,
        lng: order.deliveryLng,
      },
      currentLocation,
      eta,
    };
  }

  async createCustomDemoOrder(input: CustomDemoOrderInput) {
    await this.cleanupExpiredCustomDemoOrders();

    const demoUser = await this.prisma.user.findFirst({ where: { email: 'akash@example.com' } });
    if (!demoUser) {
      throw new NotFoundException('Demo user not found. Run seed first.');
    }

    const suffix = randomBytes(4).toString('hex');

    const driver = await this.prisma.driver.create({
      data: {
        name: `Demo Driver ${suffix}`,
        email: `demo-driver-${suffix}@demo.local`,
        password: 'hashedpassword',
        status: DriverStatus.ASSIGNED,
        role: DriverRole.DELIVERY,
        lat: input.pickup.lat,
        lng: input.pickup.lng,
      },
    });

    const order = await this.prisma.order.create({
      data: {
        userId: demoUser.id,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentStatus: PaymentStatus.PAID,
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        deliveryLat: input.destination.lat,
        deliveryLng: input.destination.lng,
      },
    });

    await this.prisma.assignment.create({
      data: {
        orderId: order.id,
        driverId: driver.id,
        type: AssignmentType.DELIVERY,
        status: AssignmentStatus.ASSIGNED,
      },
    });

    const avgSpeedKmh = 30;
    const distanceKm = this.haversine(
      input.pickup.lat,
      input.pickup.lng,
      input.destination.lat,
      input.destination.lng,
    );
    const eta = new Date(Date.now() + (distanceKm / avgSpeedKmh) * 3600000);
    await this.prisma.order.update({ where: { id: order.id }, data: { eta } });

    return {
      orderId: order.id,
      status: this.mapOrderStatus(order.status),
      pickup: {
        label: input.pickup.label ?? `Pickup (${input.pickup.lat.toFixed(4)}, ${input.pickup.lng.toFixed(4)})`,
        lat: input.pickup.lat,
        lng: input.pickup.lng,
      },
      destination: {
        label: input.destination.label ?? `Destination (${input.destination.lat.toFixed(4)}, ${input.destination.lng.toFixed(4)})`,
        lat: input.destination.lat,
        lng: input.destination.lng,
      },
      driverId: driver.id,
      driverName: driver.name,
    };
  }

  async cleanupExpiredCustomDemoOrders() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const demoDrivers = await this.prisma.driver.findMany({
      where: {
        email: { endsWith: '@demo.local' },
        NOT: { email: 'driver1@example.com' },
        createdAt: { lt: cutoff },
      },
      include: {
        assignments: {
          include: { order: true },
        },
      },
    });

    for (const driver of demoDrivers) {
      if (driver.email === 'demo-driver-1@demo.local') continue;

      for (const assignment of driver.assignments) {
        const order = assignment.order;

        const isSharedDemo = DEMO_ORDERS.some(
          (d) =>
            Math.abs(order.pickupLat - d.pickup.lat) < 0.01 &&
            Math.abs(order.pickupLng - d.pickup.lng) < 0.01 &&
            Math.abs(order.deliveryLat - d.destination.lat) < 0.01 &&
            Math.abs(order.deliveryLng - d.destination.lng) < 0.01,
        );
        if (isSharedDemo) continue;

        await this.prisma.trackingEvent.deleteMany({ where: { orderId: order.id } });
        await this.prisma.assignment.deleteMany({ where: { orderId: order.id } });
        await this.prisma.order.delete({ where: { id: order.id } });
      }

      await this.prisma.driver.delete({ where: { id: driver.id } });
    }
  }
}
