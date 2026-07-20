import { Controller, Get, Headers, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Operator's eyes — NOT a customer dashboard (§2: customers never get one).
 * One JSON endpoint behind ADMIN_TOKEN so Nasser can see leads, customers,
 * and failures without querying Postgres by hand. Fails closed: no token
 * configured → the route effectively doesn't exist.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview(@Headers('x-admin-token') token: string | undefined) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const [leads, customers, recentPosts, failedPosts, archetypes] = await Promise.all([
      this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { brandProfile: { select: { businessType: true, onboardingComplete: true, contentStrategy: true } } },
      }),
      this.prisma.post.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, customerId: true, platform: true, status: true, approvalState: true, caption: true, scheduledTime: true, createdAt: true },
      }),
      this.prisma.post.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: { id: true, customerId: true, failureReason: true, updatedAt: true },
      }),
      // The playbook, so new archetypes the engine researched are reviewable
      // (engine Flow 2 step 6) and stale ones are visible.
      this.prisma.playbookArchetype.findMany({
        orderBy: [{ usageCount: 'desc' }, { slug: 'asc' }],
        select: {
          slug: true,
          title: true,
          status: true,
          confidence: true,
          usageCount: true,
          researchedAt: true,
        },
      }),
    ]);

    return {
      counts: {
        leads: await this.prisma.lead.count(),
        customers: await this.prisma.customer.count(),
        activeCustomers: await this.prisma.customer.count({ where: { status: 'active' } }),
        failedPosts: failedPosts.length,
      },
      leads,
      customers: customers.map((c) => ({
        id: c.id, phone: c.phone, businessName: c.businessName,
        plan: c.planTier, status: c.status, trust: c.trustLevel,
        business: c.brandProfile?.businessType ?? null,
        onboarded: c.brandProfile?.onboardingComplete ?? false,
        referralCode: c.referralCode, referredBy: c.referredByCode,
        strategy: c.brandProfile?.contentStrategy ?? null,
        archetype: c.archetypeSlug,
        created: c.createdAt,
      })),
      recentPosts, failedPosts, archetypes,
    };
  }
}
