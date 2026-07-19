import { Controller, Get } from '@nestjs/common';

/**
 * Lightweight liveness endpoints. Hosting platforms (Render, Railway, etc.)
 * ping /health to know the service booted; the root path is a friendly note
 * for anyone who opens the backend URL in a browser.
 */
@Controller()
export class HealthController {
  @Get('health')
  health(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get()
  root(): { service: string; status: string } {
    return { service: 'aissm-backend', status: 'ok' };
  }
}
