import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis.service.js';
import { PrismaService } from '../prisma.service.js';
import { AssignmentStatus, DriverStatus, OrderStatus } from '../../generated/prisma/client.js';
@Injectable()
export class DriverService {
  constructor(
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}
  async updateLocation(data: { driverId: string; lat: number; lng: number }) {
    const driverId = data.driverId;
    const lat = data.lat;
    const lng = data.lng;
    const channel = `driver:${driverId}`;
    await this.redisService.set(
      channel + ':latest',
      JSON.stringify({
        lat,
        lng,
        timeStamp: new Date(),
      }),
    );
    await this.redisService.publish(
      channel,
      JSON.stringify({
        lat,
        lng,
        timeStamp: new Date(),
      }),
    );
  }

  async startDelivery(orderId: string, driverId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        driverId,
        orderId,
        status: AssignmentStatus.ASSIGNED,
      },
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    await this.prisma.assignment.update({
      where: {
        id: assignment.id,
      },
      data: {
        status: AssignmentStatus.PICKED,
      },
    });

    await this.prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: OrderStatus.PICKED,
      },
    });

    return { message: 'Delivery Started' };
  }

  async completeDelivery(orderId: string, driverId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        driverId,
        orderId,
        status: AssignmentStatus.PICKED,
      },
    });

    if (!assignment) {
      throw new Error('No active delivery found');
    }

    await this.prisma.assignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.COMPLETED },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERED },
    });

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { status: DriverStatus.AVAILABLE },
    });

    return { message: 'Delivery completed' };
  }
}
