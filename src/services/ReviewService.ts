import { prisma } from "./prisma";
import type {
  ReviewStatus,
  CommentCategory,
  CommentSeverity,
} from "../shared";

interface SimulatedComment {
  filePath: string;
  line: number;
  body: string;
  category: CommentCategory;
  severity: CommentSeverity;
}

/**
 * ReviewService — placeholder that simulates AI code review.
 * In production, this will call OpenAI / Anthropic APIs to analyze diffs.
 */
export class ReviewService {
  /**
   * Trigger a review for a pull request.
   * Creates a Review record and simulates AI analysis.
   */
  static async triggerReview(prId: string): Promise<string> {
    // Create a pending review
    const review = await prisma.review.create({
      data: {
        prId,
        status: "pending" satisfies ReviewStatus,
        startedAt: new Date(),
      },
    });

    // Simulate async review processing
    this.processReview(review.id).catch((err) => {
      console.error(`Review ${review.id} failed:`, err);
    });

    return review.id;
  }

  /**
   * Simulate the AI review process.
   * In production: fetch diff → send to AI → parse response → store comments.
   */
  private static async processReview(reviewId: string): Promise<void> {
    // Mark as running
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "running" satisfies ReviewStatus },
    });

    // Simulate processing delay (1-3 seconds)
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.random() * 2000)
    );

    try {
      // Generate mock comments
      const mockComments = this.generateMockComments();

      // Store comments
      await prisma.reviewComment.createMany({
        data: mockComments.map((comment) => ({
          reviewId,
          ...comment,
        })),
      });

      // Mark as done
      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: "done" satisfies ReviewStatus,
          completedAt: new Date(),
          summary: `Found ${mockComments.length} issues across ${new Set(mockComments.map((c) => c.filePath)).size} files.`,
          tokensUsed: Math.floor(500 + Math.random() * 2000),
        },
      });
    } catch (error) {
      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: "error" satisfies ReviewStatus,
          completedAt: new Date(),
          summary: `Review failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      });
    }
  }

  /**
   * Generate mock review comments for development/demo purposes.
   */
  private static generateMockComments(): SimulatedComment[] {
    const sampleComments: SimulatedComment[] = [
      {
        filePath: "src/utils/auth.ts",
        line: 15,
        body: "Consider using bcrypt with a higher cost factor (at least 12) for password hashing.",
        category: "security",
        severity: "warning",
      },
      {
        filePath: "src/api/handlers.ts",
        line: 42,
        body: "This database query inside a loop could cause N+1 performance issues. Consider using a batch query.",
        category: "performance",
        severity: "error",
      },
      {
        filePath: "src/components/Dashboard.tsx",
        line: 8,
        body: "Unused import: `useCallback` is imported but never used.",
        category: "style",
        severity: "info",
      },
      {
        filePath: "src/api/handlers.ts",
        line: 67,
        body: "Potential null reference: `user.profile` may be undefined when the user hasn't completed onboarding.",
        category: "bug",
        severity: "error",
      },
      {
        filePath: "src/utils/helpers.ts",
        line: 23,
        body: "Consider extracting this logic into a custom hook for better reusability across components.",
        category: "best-practice",
        severity: "info",
      },
    ];

    // Return a random subset (2-5 comments)
    const count = 2 + Math.floor(Math.random() * 4);
    return sampleComments.slice(0, count);
  }
}
