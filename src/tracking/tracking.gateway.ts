import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../redis.service.js';
import { PrismaService } from '../prisma.service.js';
import { AssignmentStatus } from '../../generated/prisma/client.js';
type LocationMessage = {
  driverId: string;
  lat: number;
  lng: number;
  timestamp: number;
};

interface TrackingSocketData {
  driverId?: string;
  orderId?: string;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
})
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;
  constructor(
    private redisService: RedisService,
    private prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private driverSubscriptions = new Map<string, boolean>();
  private driverOrdersMap = new Map<string, Set<string>>();

  afterInit(_server: Server) {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    const rawOrigins = this.configService.get<string>('CORS_ORIGINS', '');
    let origins: string[];
    if (rawOrigins && rawOrigins !== '*') {
      origins = rawOrigins.split(',').map((s) => s.trim());
    } else {
      origins = env === 'production'
        ? []
        : ['http://localhost:5173', 'http://127.0.0.1:5500'];
    }
    (this.server as any).opts.cors = {
      origin: origins.length > 0 ? origins : false,
      credentials: true,
    };
  }

  async handleConnection(client: Socket) {
    const orderId = client.handshake.query.orderId as string;
    if (!orderId) {
      client.disconnect();
      return;
    }

    client.join(orderId);

    console.log(`Client Connected for orderId: ${orderId}`);

    const data = client.data as TrackingSocketData;
    data.orderId = orderId;

    const assignment = await this.prismaService.assignment.findFirst({
      where: {
        orderId,
        status: AssignmentStatus.ASSIGNED,
      },
    });

    if (!assignment) {
      client.emit('trackingStatus', {
        orderId,
        status: 'WAITING_FOR_DRIVER',
        message: 'Waiting for driver assignment',
      });
      return;
    }

    const driverId = assignment.driverId;
    // 🔥 STEP: Send initial location (Redis → DB fallback)

    const redisData = await this.redisService.get(driverId);

    if (redisData) {
      try {
        const parsed = JSON.parse(redisData) as LocationMessage;

        client.emit('locationUpdate', parsed);
      } catch {
        // ignore bad data
      }
    } else {
      // 🧠 fallback from DB
      const last = await this.prismaService.trackingEvent.findFirst({
        where: { orderId },
        orderBy: { timestamp: 'desc' },
      });

      if (last) {
        client.emit('locationUpdate', {
          driverId,
          lat: last.lat,
          lng: last.lng,
          timestamp: last.timestamp,
        });
      }
    }
    data.driverId = driverId;
    data.orderId = orderId;

    if (!this.driverOrdersMap.has(driverId)) {
      this.driverOrdersMap.set(driverId, new Set());
    }

    this.driverOrdersMap.get(driverId)!.add(orderId);

    if (!this.driverSubscriptions.has(driverId)) {
      const channel = `driver:${driverId}`;
      this.redisService.subscribe(channel, (message: string) => {
        const data = JSON.parse(message) as LocationMessage;
        const orderIds = this.driverOrdersMap.get(driverId);

        if (!orderIds) return;

        for (const orderId of orderIds) {
          this.server.to(orderId).emit('locationUpdate', data);
        }
      });

      this.driverSubscriptions.set(driverId, true);
    }
  }

  async handleDisconnect(client: Socket) {
    const socketData = client.data as TrackingSocketData;

    const driverId = socketData.driverId;
    const orderId = socketData.orderId;

    console.log(`Client disconnected for orderId: ${orderId}`);

    if (!driverId || !orderId) return;

    const orderSet = this.driverOrdersMap.get(driverId);

    if (!orderSet) return;

    orderSet.delete(orderId);

    if (orderSet.size === 0) {
      console.log(`No more clients for driver ${driverId}, cleaning up...`);
      this.driverOrdersMap.delete(driverId);
      const channel = `driver:${driverId}`;
      await this.redisService.unsubscribe(channel);
      this.driverSubscriptions.delete(driverId);
    }
  }

  emitToOrderRoom(orderId: string, event: string, payload: any): void {
    this.server.to(orderId).emit(event, payload);
  }
}
