import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CreateOrderDto } from './dto/CreateOrder.dto.js';
import { AssignmentService } from '../assignment/assignment.service.js';
@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
    private assignmentService: AssignmentService,
  ) {}
  async create(dto: CreateOrderDto, userId: string) {
    const order = await this.prisma.order.create({
      data: {
        userId: userId,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        deliveryLat: dto.deliveryLat,
        deliveryLng: dto.deliveryLng,
      },
    });

    await this.assignmentService.assignDriver(order.id);

    return order;
  }
}
