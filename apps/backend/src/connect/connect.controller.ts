import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Platform } from '@smm/contracts';
import { ConnectService } from './connect.service';

const StartBody = z.object({
  customerId: z.string().min(1),
  platform: Platform,
});

const ReconcileBody = z.object({
  customerId: z.string().min(1),
});

/**
 * Public connect endpoints. The marketing site's Connect page POSTs here to get
 * a hosted authorization link, and calls back after the owner returns to sync
 * what got connected. Everything degrades to a safe demo when offline.
 */
@Controller('connect')
export class ConnectController {
  constructor(private readonly connect: ConnectService) {}

  /** Start authorizing one platform → returns a URL to redirect the browser. */
  @Post('start')
  async start(@Body() body: unknown) {
    const { customerId, platform } = StartBody.parse(body);
    return this.connect.startAuth({ customerId, platform });
  }

  /** Sync connected accounts after the owner returns from authorizing. */
  @Post('reconcile')
  async reconcile(@Body() body: unknown) {
    const { customerId } = ReconcileBody.parse(body);
    const accounts = await this.connect.reconcile(customerId);
    return { accounts };
  }

  /** Read-only status: which platforms this customer has connected. */
  @Get('status')
  async status(@Query('customer') customer?: string) {
    if (!customer) return { accounts: [] };
    const accounts = await this.connect.listConnected(customer);
    return { accounts };
  }
}
