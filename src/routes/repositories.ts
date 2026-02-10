import { Router } from "express";
import { prisma } from "../services/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { z } from "zod";

export const repositoryRoutes = Router();

const createRepoSchema = z.object({
  name: z.string().min(1),
  fullName: z.string().min(1),
  webhookSecret: z.string().optional(),
  rules: z.string().optional(),
});

// GET /api/repositories — list all repositories
repositoryRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    const repositories = await prisma.repository.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { pullRequests: true },
        },
      },
    });
    res.json(repositories);
  })
);

// POST /api/repositories — create a repository
repositoryRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0].message);
    }

    const existing = await prisma.repository.findUnique({
      where: { fullName: parsed.data.fullName },
    });

    if (existing) {
      throw new AppError(409, "Repository already registered");
    }

    const repository = await prisma.repository.create({
      data: parsed.data,
    });

    res.status(201).json(repository);
  })
);

// GET /api/repositories/:id
repositoryRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const repository = await prisma.repository.findUnique({
      where: { id: req.params.id },
      include: {
        pullRequests: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!repository) {
      throw new AppError(404, "Repository not found");
    }

    res.json(repository);
  })
);

// DELETE /api/repositories/:id
repositoryRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.repository.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  })
);
