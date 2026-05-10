import { Module } from '@nestjs/common';
import { AssignmentService } from '../assignment/assignment.service.js';
import { OrderService } from './order.service.js';
import { PrismaService } from '../prisma.service.js';
import { OrderController } from './order.controller.js';

@Module({
  controllers: [OrderController],
  providers: [AssignmentService, OrderService, PrismaService],
})
export class OrderModule {}
