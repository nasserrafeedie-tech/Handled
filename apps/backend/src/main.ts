import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, urlencoded, static as serveStatic } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { isWorkerRole } from './common/service-role';

async function bootstrap() {
  // The worker service runs the SAME build with no HTTP server — it exists only
  // to consume the heavy-video queue (SERVICE_ROLE=worker). createApplicationContext
  // wires up every module (so the ReelWorker's onModuleInit starts its consumer)
  // without opening a port. The process stays alive on the Redis/BullMQ handles.
  if (isWorkerRole()) {
    const ctx = await NestFactory.createApplicationContext(AppModule);
    ctx.enableShutdownHooks();
    new Logger('bootstrap').log('SMM worker started (SERVICE_ROLE=worker)');
    return;
  }

  // Allowlisted CORS, not `cors: true`. The blanket setting reflected ANY
  // origin and allowed credentials, so a malicious page in the operator's
  // browser could drive authenticated /admin/* calls. Browsers are only allowed
  // from our own front-ends; server-to-server webhooks (Twilio, Stripe) don't
  // send an Origin and are unaffected. Override with CORS_ORIGINS (comma-sep).
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    process.env.PUBLIC_SITE_URL ??
    'https://texthandled.com'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // Twilio posts application/x-www-form-urlencoded webhooks.
  app.use(urlencoded({ extended: false }));
  // Keep the raw bytes: Stripe signs the exact payload, and a re-serialized
  // JSON body will never verify.
  app.use(
    json({
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // Offline media store, served read-only so reel/graphic preview links in
  // texts actually open. In production this becomes the R2 public bucket.
  const mediaDir = process.env.MEDIA_DIR ?? join(__dirname, '..', 'media');
  app.use('/media', serveStatic(mediaDir, { fallthrough: false, index: false }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('bootstrap').log(`SMM backend listening on :${port}`);
}

void bootstrap();
