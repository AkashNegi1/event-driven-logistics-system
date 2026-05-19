import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { DemoService } from './demo.service.js';
import type { CustomDemoOrderInput } from './demo.service.js';

@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get('orders')
  async listDemoOrders() {
    return this.demoService.getDemoOrders();
  }

  @Post('order')
  async createDemoOrder(@Body() body: { key: string }) {
    const key = body?.key ?? 'local-delhi';
    return this.demoService.createOrGetDemoOrder(key);
  }

  @Get('tracking/:orderId')
  async getDemoTracking(@Param('orderId') orderId: string) {
    return this.demoService.getDemoTrackingData(orderId);
  }

  @Post('order/create')
  async createCustomDemoOrder(@Body() body: CustomDemoOrderInput) {
    return this.demoService.createCustomDemoOrder(body);
  }
}
