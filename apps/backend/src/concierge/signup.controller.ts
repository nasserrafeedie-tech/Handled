import { Controller, Post, Body } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ConciergeService } from './concierge.service';

const EmailSignupBody = z.object({
  email: z.string().email(),
  businessName: z.string().min(1).max(120).optional(),
});

/**
 * Email sign-up — the non-SMS way into Handled.
 *
 * Email opt-in is not A2P-regulated, so a plain web form is compliant: the
 * visitor gives an email, we create an email-channel customer and start the
 * same onboarding interview over email. This is what lets Handled onboard and
 * serve customers with no phone number and no carrier approval — and it's the
 * "decline messaging and still use the service" path the SMS reviewer required.
 */
@Controller('signup')
export class SignupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concierge: ConciergeService,
  ) {}

  @Post('email')
  async emailSignup(@Body() body: unknown): Promise<{ ok: boolean }> {
    const parsed = EmailSignupBody.safeParse(body);
    // Resubmitting the same email never errors at the visitor — same idempotent
    // stance as the SMS lead path. A bad payload just no-ops.
    if (!parsed.success) return { ok: true };

    const email = parsed.data.email.trim().toLowerCase();
    const existing = await this.prisma.customer.findUnique({ where: { email } });
    if (existing) return { ok: true };

    const customer = await this.prisma.customer.create({
      data: {
        email,
        preferredChannel: 'email',
        businessName: parsed.data.businessName,
        // Same children the SMS path creates, or onboarding has nowhere to write.
        conversation: { create: {} },
        brandProfile: { create: {} },
      },
    });

    // Welcome + first onboarding question, sent over email (beginOnboarding →
    // notify → reply routes to the email provider for an email customer).
    await this.concierge.beginOnboarding(customer.id).catch(() => undefined);
    return { ok: true };
  }
}
