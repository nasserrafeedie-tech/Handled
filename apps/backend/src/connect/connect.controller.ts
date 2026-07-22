import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
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
  private readonly log = new Logger(ConnectController.name);

  constructor(private readonly connect: ConnectService) {}

  /** Start authorizing one platform → returns a URL to redirect the browser. */
  @Post('start')
  async start(@Body() body: unknown) {
    const { customerId, platform } = StartBody.parse(body);
    try {
      return await this.connect.startAuth({ customerId, platform });
    } catch (err) {
      // This used to fall through as a bare 500. The owner saw "something went
      // wrong" and so did we — the real reason (an unenabled platform, a key
      // with a stray newline, a rejected redirect) was only ever a line in the
      // hosting logs, and diagnosing it meant going and reading them. The
      // upstream reason is now on the response, because the person clicking
      // Connect is the one who has to act on it.
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`connect/start ${platform} for ${customerId} failed: ${reason}`);
      throw new BadGatewayException({
        error: 'connect_failed',
        platform,
        // Trimmed, and it is our own integration talking to our own vendor —
        // no customer data and no credentials pass through here.
        reason: reason.slice(0, 400),
      });
    }
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
