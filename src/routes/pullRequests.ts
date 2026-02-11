import { Router } from "express";
import { prisma } from "../services/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";

export const pullRequestRoutes = Router();

// GET /api/pull-requests — list with filters
pullRequestRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const {
      repoId,
      status,
      author,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {
      repository: { userId },
    };
    if (repoId) where.repoId = repoId;
    if (status) where.status = status;
    if (author) where.author = { contains: author };

    const [data, total] = await Promise.all([
      prisma.pullRequest.findMany({
        where,
        include: {
          repository: { select: { name: true, fullName: true } },
          reviews: {
            select: { id: true, status: true },
            orderBy: { startedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.pullRequest.count({ where }),
    ]);

    res.json({
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  })
);

// GET /api/pull-requests/:id — detail with reviews and comments
pullRequestRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const pullRequest = await prisma.pullRequest.findFirst({
      where: {
        id: req.params.id,
        repository: { userId },
      },
      include: {
        repository: true,
        reviews: {
          include: {
            comments: {
              orderBy: [{ filePath: "asc" }, { line: "asc" }],
            },
          },
          orderBy: { startedAt: "desc" },
        },
      },
    });

    if (!pullRequest) {
      throw new AppError(404, "Pull request not found");
    }

    res.json(pullRequest);
  })
);
