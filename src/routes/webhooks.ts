import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../services/prisma";
import { ReviewService } from "../services/ReviewService";
import { asyncHandler } from "../middleware/errorHandler";
import type { GitHubWebhookPayload } from "../shared";

export const webhookRoutes = Router();

function verifySignature(secret: string, rawBody: Buffer, signature: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /webhooks/github — receive GitHub PR events
webhookRoutes.post(
  "/github",
  asyncHandler(async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;

    // Only process pull_request events
    if (event !== "pull_request") {
      res.json({ message: `Ignored event: ${event}` });
      return;
    }

    const payload = req.body as GitHubWebhookPayload;
    const { action, pull_request: pr, repository: repo } = payload;

    // Only process opened/synchronize/reopened actions
    if (!["opened", "synchronize", "reopened"].includes(action)) {
      res.json({ message: `Ignored action: ${action}` });
      return;
    }

    // Find registered repository
    const registeredRepo = await prisma.repository.findUnique({
      where: { fullName: repo.full_name },
    });

    if (!registeredRepo) {
      res.json({ message: `Repository ${repo.full_name} not registered` });
      return;
    }

    // Verify webhook signature
    if (registeredRepo.webhookSecret && signature) {
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody || !verifySignature(registeredRepo.webhookSecret, rawBody, signature)) {
        console.warn(`Invalid webhook signature for ${repo.full_name}`);
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    // Find the GitHub access token for this repo's owner
    const ghConnection = await prisma.gitHubConnection.findFirst({
      where: { userId: registeredRepo.userId },
    });

    if (!ghConnection) {
      console.error(`No GitHub connection for user ${registeredRepo.userId}`);
      res.status(500).json({ error: "No GitHub connection for repository owner" });
      return;
    }

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

    console.log(`📥 PR #${pr.number} (${action}) on ${repo.full_name} — triggering review`);

    // Trigger AI review (async, don't block webhook response)
    ReviewService.triggerReview(pullRequest.id, {
      repoFullName: repo.full_name,
      prNumber: pr.number,
      accessToken: ghConnection.accessToken,
      rules: registeredRepo.rules,
    }).catch((err) => {
      console.error(`Review trigger failed for PR #${pr.number}:`, err);
    });

    res.status(201).json({
      message: "Review triggered",
      pullRequestId: pullRequest.id,
    });
  })
);
