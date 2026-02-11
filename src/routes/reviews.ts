import { Router } from "express";
import { prisma } from "../services/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";

export const reviewRoutes = Router();

// GET /api/reviews/:id — review detail
reviewRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const review = await prisma.review.findFirst({
      where: {
        id: req.params.id,
        pullRequest: {
          repository: {
            userId,
          },
        },
      },
      include: {
        pullRequest: {
          include: {
            repository: true,
          },
        },
        comments: {
          orderBy: [{ filePath: "asc" }, { line: "asc" }],
        },
      },
    });

    if (!review) {
      throw new AppError(404, "Review not found");
    }

    res.json(review);
  })
);
