import { Controller, Post, Req, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderService } from './order.service.js';
import { CreateOrderDto } from './dto/CreateOrder.dto.js';

@UseGuards(AuthGuard('jwt'))
@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  async createOrder(
    @Body() dto: CreateOrderDto,
    @Req() req: { user: { id: string } },
  ) {
    const userId: string = req.user.id;

    return await this.orderService.create(dto, userId);
  }
}
