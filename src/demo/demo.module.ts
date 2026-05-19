import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [DemoController],
  providers: [DemoService, PrismaService],
})
export class DemoModule {}
