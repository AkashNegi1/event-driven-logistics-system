import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma.service.js';
import { TrackingService } from './tracking.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { TrackingSimulatorService } from './tracking-simulator.service.js';
import { TrackingResponseDto } from './dto/tracking-response.dto.js';

@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly configService: ConfigService,
    private readonly trackingService: TrackingService,
    private readonly trackingGateway: TrackingGateway,
    private readonly simulatorService: TrackingSimulatorService,
    private readonly prisma: PrismaService,
  ) {}

  private assertSimulatorEnabled() {
    if (
      this.configService.get<string>('ENABLE_TRACKING_SIMULATOR') !== 'true'
    ) {
      throw new ForbiddenException('Tracking simulator is disabled');
    }
  }

  private async assertDemoOrder(orderId: string) {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    if (env !== 'production') return;

    const demoUser = await this.prisma.user.findFirst({
      where: { email: 'akash@example.com' },
    });
    if (!demoUser) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (!order || order.userId !== demoUser.id) {
      throw new ForbiddenException(
        'This endpoint is only available for demo orders in production',
      );
    }
  }

  @Get(':orderId')
  @UseGuards(AuthGuard('jwt'))
  async getTracking(
    @Param('orderId') orderId: string,
  ): Promise<TrackingResponseDto> {
    const data = await this.trackingService.getTrackingData(orderId);
    if (!data) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    return data;
  }

  @Post(':orderId/mock-location')
  async mockLocation(
    @Param('orderId') orderId: string,
    @Body()
    body: { lat: number; lng: number; speed?: number; heading?: number },
  ) {
    this.assertSimulatorEnabled();
    await this.assertDemoOrder(orderId);

    let driverId: string;
    try {
      const result = await this.trackingService.broadcastMockLocation(
        orderId,
        body.lat,
        body.lng,
        body.speed ?? 0,
        body.heading ?? 0,
      );
      driverId = result.driverId;
    } catch (err: any) {
      throw new BadRequestException(
        err.message ?? 'No active driver assignment for this order',
      );
    }

    this.trackingGateway.emitToOrderRoom(orderId, 'locationUpdate', {
      driverId,
      lat: body.lat,
      lng: body.lng,
      speed: body.speed ?? 0,
      heading: body.heading ?? 0,
      timestamp: Date.now(),
    });

    return { message: 'Mock location broadcasted', driverId };
  }

  @Post(':orderId/simulator/start')
  async startSimulator(
    @Param('orderId') orderId: string,
    @Body()
    body: { intervalMs?: number; speedMultiplier?: number; loop?: boolean },
  ) {
    this.assertSimulatorEnabled();
    await this.assertDemoOrder(orderId);

    try {
      await this.simulatorService.start(orderId, {
        intervalMs: body.intervalMs,
        speedMultiplier: body.speedMultiplier,
        loop: body.loop,
      });
      return { message: 'Simulator started', orderId };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Post(':orderId/simulator/stop')
  async stopSimulator(@Param('orderId') orderId: string) {
    this.assertSimulatorEnabled();
    await this.assertDemoOrder(orderId);

    const stopped = this.simulatorService.stop(orderId);
    return {
      message: stopped ? 'Simulator stopped' : 'No active simulator',
      orderId,
    };
  }
}
