import { Router } from "express";
import { prisma } from "../services/prisma";
import { ReviewService } from "../services/ReviewService";
import { asyncHandler } from "../middleware/errorHandler";
import type { GitHubWebhookPayload } from "../shared";

export const webhookRoutes = Router();

// POST /webhooks/github — receive GitHub PR events
webhookRoutes.post(
  "/github",
  asyncHandler(async (req, res) => {
    const event = req.headers["x-github-event"] as string;

    // Only process pull_request events
    if (event !== "pull_request") {
      res.json({ message: `Ignored event: ${event}` });
      return;
    }

    const payload = req.body as GitHubWebhookPayload;
    const { action, pull_request: pr, repository: repo } = payload;

    // Only process opened/synchronize actions
    if (!["opened", "synchronize", "reopened"].includes(action)) {
      res.json({ message: `Ignored action: ${action}` });
      return;
    }

    // Find or skip if repository not registered
    const registeredRepo = await prisma.repository.findUnique({
      where: { fullName: repo.full_name },
    });

    if (!registeredRepo) {
      res.json({ message: `Repository ${repo.full_name} not registered` });
      return;
    }

    // TODO: Verify webhook signature using registeredRepo.webhookSecret

    // Upsert pull request
    const pullRequest = await prisma.pullRequest.upsert({
      where: {
        repoId_number: {
          repoId: registeredRepo.id,
          number: pr.number,
        },
      },
      create: {
        repoId: registeredRepo.id,
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
        url: pr.html_url,
        status: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
      },
      update: {
        title: pr.title,
        status: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
      },
    });

    // Trigger AI review
    const reviewId = await ReviewService.triggerReview(pullRequest.id);

    res.status(201).json({
      message: "Review triggered",
      pullRequestId: pullRequest.id,
      reviewId,
    });
  })
);
