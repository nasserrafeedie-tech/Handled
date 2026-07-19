import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, urlencoded, static as serveStatic } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  // Twilio posts application/x-www-form-urlencoded webhooks.
  app.use(urlencoded({ extended: false }));
  app.use(json());

  // Offline media store, served read-only so reel/graphic preview links in
  // texts actually open. In production this becomes the R2 public bucket.
  const mediaDir = process.env.MEDIA_DIR ?? join(__dirname, '..', 'media');
  app.use('/media', serveStatic(mediaDir, { fallthrough: false, index: false }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('bootstrap').log(`SMM backend listening on :${port}`);
}

void bootstrap();
