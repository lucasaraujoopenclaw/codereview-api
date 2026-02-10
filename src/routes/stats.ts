import { Router } from "express";
import { prisma } from "../services/prisma";
import { asyncHandler } from "../middleware/errorHandler";
import type { StatsResponse } from "../shared";

export const statsRoutes = Router();

// GET /api/stats — aggregated metrics
statsRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalRepositories,
      totalPullRequests,
      totalReviews,
      reviewsToday,
      categoryStats,
      severityStats,
    ] = await Promise.all([
      prisma.repository.count(),
      prisma.pullRequest.count(),
      prisma.review.count(),
      prisma.review.count({
        where: {
          startedAt: { gte: today },
        },
      }),
      prisma.reviewComment.groupBy({
        by: ["category"],
        _count: { id: true },
      }),
      prisma.reviewComment.groupBy({
        by: ["severity"],
        _count: { id: true },
      }),
    ]);

    const issuesByCategory = {
      security: 0,
      performance: 0,
      style: 0,
      bug: 0,
      "best-practice": 0,
    };

    for (const stat of categoryStats) {
      const key = stat.category as keyof typeof issuesByCategory;
      if (key in issuesByCategory) {
        issuesByCategory[key] = stat._count.id;
      }
    }

    const issuesBySeverity = {
      info: 0,
      warning: 0,
      error: 0,
    };

    for (const stat of severityStats) {
      const key = stat.severity as keyof typeof issuesBySeverity;
      if (key in issuesBySeverity) {
        issuesBySeverity[key] = stat._count.id;
      }
    }

    const stats: StatsResponse = {
      totalRepositories,
      totalPullRequests,
      totalReviews,
      reviewsToday,
      issuesByCategory,
      issuesBySeverity,
    };

    res.json(stats);
  })
);
