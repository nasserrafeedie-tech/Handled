import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  // Twilio posts application/x-www-form-urlencoded webhooks.
  app.use(urlencoded({ extended: false }));
  app.use(json());

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('bootstrap').log(`SMM backend listening on :${port}`);
}

void bootstrap();
