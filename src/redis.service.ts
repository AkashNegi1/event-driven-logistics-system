import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private publisher: Redis;
  private subscriber: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.publisher = new Redis(`${redisUrl}`);
    this.subscriber = new Redis(`${redisUrl}`);
  }
  async onModuleDestroy() {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
  async set(key: string, value: string): Promise<any> {
    return this.publisher.set(key, value);
  }

  async setex(key: string, seconds: number, value: string): Promise<any> {
    return this.publisher.setex(key, seconds, value);
  }

  async del(...keys: string[]): Promise<number> {
    return this.publisher.del(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.publisher.keys(pattern);
  }

  async get(key: string) {
    return this.publisher.get(key);
  }

  async sadd(key: string, value: string) {
    return this.publisher.sadd(key, value);
  }

  async smembers(key: string) {
    return this.publisher.smembers(key);
  }

  async srem(key: string, value: string) {
    return this.publisher.srem(key, value);
  }

  async publish(channel: string, message: string) {
    return this.publisher.publish(channel, message);
  }

  subscribe(channel: string, callback: (message: string) => void) {
    this.subscriber.subscribe(channel);

    this.subscriber.on('message', (ch, msg) => {
      if (ch == channel) {
        callback(msg);
      }
    });
  }

  async unsubscribe(channel: string) {
    await this.subscriber.unsubscribe(channel);
  }
}
