import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis.service.js';
import { UpdateLocationDto } from './dto/updateLocation.dto.js';

@Injectable()
export class DriverService {
  constructor(private readonly redisService: RedisService) {}
  async updateLocation(dto: UpdateLocationDto) {
    const { driverId, lat, lng } = dto;
    const locationKey = `driver:${driverId}:location`;
    await this.redisService.set(
      locationKey,
      JSON.stringify({ lat, lng, timeStamp: Date.now() }),
    );
    const ordersKey = `driverId:${driverId}:orders`;
    const orderIds = await this.redisService.smembers(ordersKey);
    if (!orderIds.length) {
      return { message: 'No active Users' };
    }
    const payload = JSON.stringify({ driverId, lat, lng });
    for (const orderId of orderIds) {
      const channel = `order:${orderId}`;
      await this.redisService.publish(channel, payload);
    }

    return {
      message: 'Location Updated',
      orderNotified: orderIds.length,
    };
  }
}
