import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Driver } from '@prisma/client';
import {
  AssignmentStatus,
  DriverStatus,
  AssignmentType,
} from '../../generated/prisma/client.js';
@Injectable()
export class AssignmentService {
  constructor(private prisma: PrismaService) {}

  async assignDriver(orderId: string) {
    const existing = await this.prisma.assignment.findFirst({
      where: {
        orderId,
        status: {
          in: [AssignmentStatus.ASSIGNED, AssignmentStatus.PICKED],
        },
      },
    });

    if (existing) return; // already assigned

    const drivers = await this.prisma.driver.findMany({
      where: {
        status: DriverStatus.AVAILABLE,
      },
    });

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
      },
    });

    if (drivers.length === 0) return;
    if (!order) {
      throw new Error('Order not found');
    }

    function calculateDistance(
      lat1: number,
      lng1: number,
      lat2: number,
      lng2: number,
    ): number {
      const R = 6371;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    let nearestDriver: Driver | null = null;
    let minDistance = Infinity;

    for (const driver of drivers) {
      if (driver.lat === null || driver.lng === null) continue;
      const distance = calculateDistance(
        driver.lat,
        driver.lng,
        order?.pickupLat,
        order?.pickupLng,
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestDriver = driver;
      }
    }

    if (!nearestDriver) return;
    if (nearestDriver.status !== DriverStatus.AVAILABLE) return;
    await this.prisma.assignment.create({
      data: {
        orderId,
        driverId: nearestDriver.id,
        type: AssignmentType.PICKUP,
      },
    });

    await this.prisma.driver.update({
      where: {
        id: nearestDriver.id,
      },
      data: {
        status: DriverStatus.ASSIGNED,
      },
    });

    // Estimate ETA: distance (km) / avg speed (km/h) → hours → Date
    const avgSpeedKmh = 30; // city delivery speed
    const etaHours = minDistance / avgSpeedKmh;
    const eta = new Date(Date.now() + etaHours * 3600000);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { eta },
    });
    // await this.prisma.order.update({
    //   where: {
    //     id: orderId,
    //   },
    //   data: {
    //     status: 'OUT_FOR_DELIVERY',
    //   },
    // });
  }
}
