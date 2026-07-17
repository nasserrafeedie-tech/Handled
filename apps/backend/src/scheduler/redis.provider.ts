import { Provider, Logger } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';

export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

export const RedisProvider: Provider = {
  provide: REDIS_CONNECTION,
  useFactory: (): Redis => {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const client = new IORedis(url, {
      // BullMQ requires this to be null on the shared connection.
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    client.on('error', (e) =>
      new Logger('Redis').error(`connection error: ${e.message}`),
    );
    return client;
  },
};
