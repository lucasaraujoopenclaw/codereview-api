import { prisma } from "./prisma";
import OpenAI from "openai";
import type { ReviewStatus, CommentCategory, CommentSeverity } from "../shared";

interface ReviewContext {
  prId: string;
  repoFullName: string;
  prNumber: number;
  accessToken: string;
  rules: string | null;
}

interface AIComment {
  filePath: string;
  line: number;
  body: string;
  category: CommentCategory;
  severity: CommentSeverity;
}

interface DiffFile {
  filename: string;
  patch: string;
  status: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function resolveOpenAIApiKeyForReview(prId: string): Promise<string | undefined> {
  // Prefer per-user stored key (if configured). Fallback to server key.
  const pr = await prisma.pullRequest.findUnique({
    where: { id: prId },
    include: {
      repository: {
        include: {
          user: {
            select: {
              openaiApiKeyEnc: true,
              openaiApiKeyIv: true,
              openaiApiKeyTag: true,
            },
          },
        },
      },
    },
  });

  const u = pr?.repository?.user;
  if (u?.openaiApiKeyEnc && u?.openaiApiKeyIv && u?.openaiApiKeyTag) {
    const { decryptString } = await import("./crypto");
    return decryptString({ enc: u.openaiApiKeyEnc, iv: u.openaiApiKeyIv, tag: u.openaiApiKeyTag });
  }

  return process.env.OPENAI_API_KEY;
}

async function githubFetch(url: string, accessToken: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text.substring(0, 200)}`);
  }

  return response;
}

export class ReviewService {
  /**
   * Trigger a full AI review: fetch diff → analyze → post comments on GitHub
   */
  static async triggerReview(prId: string, ctx: Omit<ReviewContext, "prId">): Promise<string> {
    const review = await prisma.review.create({
      data: {
        prId,
        status: "pending" satisfies ReviewStatus,
        startedAt: new Date(),
      },
    });

    // Run async — don't block webhook response
    this.processReview(review.id, { ...ctx, prId }).catch((err) => {
      console.error(`❌ Review ${review.id} failed:`, err);
    });

    return review.id;
  }

  private static async processReview(reviewId: string, ctx: ReviewContext): Promise<void> {
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "running" satisfies ReviewStatus },
    });

    try {
      // 1. Fetch PR diff files from GitHub
      const files = await this.fetchDiff(ctx);

      if (files.length === 0) {
        await prisma.review.update({
          where: { id: reviewId },
          data: {
            status: "done" satisfies ReviewStatus,
            completedAt: new Date(),
            summary: "No reviewable changes found.",
            tokensUsed: 0,
          },
        });
        return;
      }

      // 2. Analyze with AI
      const { comments, summary, tokensUsed } = await this.analyzeWithAI(files, ctx);

      // 3. Store comments in DB
      if (comments.length > 0) {
        await prisma.reviewComment.createMany({
          data: comments.map((c) => ({ reviewId, ...c })),
        });
      }

      // 4. Post review on GitHub PR
      await this.postGitHubReview(ctx, comments, summary);

      // 5. Mark as done
      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: "done" satisfies ReviewStatus,
          completedAt: new Date(),
          summary,
          tokensUsed,
        },
      });

      console.log(
        `✅ Review done for ${ctx.repoFullName}#${ctx.prNumber}: ${comments.length} comments, ${tokensUsed} tokens`
      );
    } catch (error) {
      console.error(`❌ Review processing error:`, error);
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
   * Fetch PR diff files from GitHub API
   */
  private static async fetchDiff(ctx: ReviewContext): Promise<DiffFile[]> {
    const response = await githubFetch(
      `https://api.github.com/repos/${ctx.repoFullName}/pulls/${ctx.prNumber}/files?per_page=100`,
      ctx.accessToken
    );

    const files: any[] = await response.json();

    // Filter to reviewable files with patches (skip binary, large files, lockfiles)
    const skipPatterns = [
      /package-lock\.json$/,
      /yarn\.lock$/,
      /pnpm-lock\.yaml$/,
      /\.lock$/,
      /\.min\.(js|css)$/,
      /dist\//,
      /build\//,
      /\.map$/,
    ];

    return files
      .filter((f) => {
        if (!f.patch) return false; // Binary or too large
        if (f.patch.length > 10000) return false; // Skip huge patches
        if (skipPatterns.some((p) => p.test(f.filename))) return false;
        return true;
      })
      .map((f) => ({
        filename: f.filename,
        patch: f.patch,
        status: f.status,
      }));
  }

  /**
   * Send diff to OpenAI for analysis
   */
  private static async analyzeWithAI(
    files: DiffFile[],
    ctx: ReviewContext
  ): Promise<{ comments: AIComment[]; summary: string; tokensUsed: number }> {
    // Build diff context (cap at ~60k chars to stay within token limits)
    let diffText = "";
    const includedFiles: string[] = [];
    for (const file of files) {
      const fileBlock = `\n--- ${file.filename} (${file.status}) ---\n${file.patch}\n`;
      if (diffText.length + fileBlock.length > 60000) break;
      diffText += fileBlock;
      includedFiles.push(file.filename);
    }

    const customRules = ctx.rules
      ? `\n\nThe repository owner has these custom review rules:\n${ctx.rules}`
      : "";

    const systemPrompt = `You are QualityGate, an expert AI code reviewer. Analyze the following pull request diff and provide actionable feedback.

Focus on:
- **Security**: SQL injection, XSS, auth issues, exposed secrets, insecure patterns
- **Bugs**: Null references, type errors, logic flaws, off-by-one errors, race conditions
- **Performance**: N+1 queries, memory leaks, unnecessary re-renders, slow algorithms
- **Best practices**: Error handling, SOLID principles, DRY violations, missing validation
- **Style**: Only mention significant style issues (not formatting nitpicks)
${customRules}

Rules:
- Be concise and specific. Reference the exact line and explain WHY it's an issue.
- Suggest a fix when possible.
- Only report real issues — avoid false positives and nitpicks.
- Category must be one of: security, performance, style, bug, best-practice
- Severity must be one of: info, warning, error
- The "line" field must be a line number that exists in the diff (a line starting with + in the patch).

Respond ONLY with valid JSON in this exact format:
{
  "summary": "Brief overall summary of the PR quality (1-2 sentences)",
  "comments": [
    {
      "filePath": "src/example.ts",
      "line": 42,
      "body": "Clear description of the issue and suggested fix",
      "category": "bug",
      "severity": "error"
    }
  ]
}

If the code looks good and you have no issues to report, return:
{ "summary": "Code looks good. No significant issues found.", "comments": [] }`;

    const apiKey = await resolveOpenAIApiKeyForReview(ctx.prId);
    const client = apiKey ? new OpenAI({ apiKey }) : openai;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review this pull request diff for ${ctx.repoFullName}#${ctx.prNumber}:\n${diffText}`,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    const tokensUsed =
      (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

    if (!content) {
      return { comments: [], summary: "AI returned empty response.", tokensUsed };
    }

    try {
      const parsed = JSON.parse(content);
      const comments: AIComment[] = (parsed.comments || [])
        .filter(
          (c: any) =>
            c.filePath &&
            typeof c.line === "number" &&
            c.body &&
            includedFiles.includes(c.filePath)
        )
        .map((c: any) => ({
          filePath: c.filePath,
          line: c.line,
          body: c.body,
          category: (["security", "performance", "style", "bug", "best-practice"].includes(c.category)
            ? c.category
            : "best-practice") as CommentCategory,
          severity: (["info", "warning", "error"].includes(c.severity)
            ? c.severity
            : "info") as CommentSeverity,
        }));

      return {
        comments,
        summary: parsed.summary || `Found ${comments.length} issues.`,
        tokensUsed,
      };
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      return {
        comments: [],
        summary: "AI response could not be parsed.",
        tokensUsed,
      };
    }
  }

  /**
   * Post the review as a GitHub PR review with inline comments
   */
  private static async postGitHubReview(
    ctx: ReviewContext,
    comments: AIComment[],
    summary: string
  ): Promise<void> {
    const severityEmoji: Record<string, string> = {
      error: "🔴",
      warning: "🟡",
      info: "🔵",
    };

    const categoryLabel: Record<string, string> = {
      security: "🔒 Security",
      performance: "⚡ Performance",
      style: "🎨 Style",
      bug: "🐛 Bug",
      "best-practice": "✅ Best Practice",
    };

    // Build review body
    let reviewBody = `## 🤖 QualityGate Review\n\n${summary}`;

    if (comments.length > 0) {
      reviewBody += `\n\n**${comments.length} issue${comments.length > 1 ? "s" : ""} found**`;

      // Count by severity
      const counts: Record<string, number> = {};
      for (const c of comments) {
        counts[c.severity] = (counts[c.severity] || 0) + 1;
      }
      const parts = [];
      if (counts.error) parts.push(`🔴 ${counts.error} error${counts.error > 1 ? "s" : ""}`);
      if (counts.warning) parts.push(`🟡 ${counts.warning} warning${counts.warning > 1 ? "s" : ""}`);
      if (counts.info) parts.push(`🔵 ${counts.info} info`);
      if (parts.length) reviewBody += ` — ${parts.join(", ")}`;
    } else {
      reviewBody += "\n\n✅ No issues found — looks good!";
    }

    // Build inline comments for GitHub
    const ghComments = comments.map((c) => ({
      path: c.filePath,
      line: c.line,
      body: `${severityEmoji[c.severity] || "ℹ️"} **${categoryLabel[c.category] || c.category}**\n\n${c.body}`,
    }));

    // Post as a PR review
    try {
      await githubFetch(
        `https://api.github.com/repos/${ctx.repoFullName}/pulls/${ctx.prNumber}/reviews`,
        ctx.accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: reviewBody,
            event: comments.some((c) => c.severity === "error") ? "REQUEST_CHANGES" : "COMMENT",
            comments: ghComments,
          }),
        }
      );

      console.log(`📝 Review posted on ${ctx.repoFullName}#${ctx.prNumber}`);
    } catch (error) {
      // If inline comments fail (e.g. line mismatch), post just the body
      console.warn(`⚠️ Inline comments failed, posting summary only:`, error);

      // Build fallback body with comments as list
      let fallbackBody = reviewBody;
      if (comments.length > 0) {
        fallbackBody += "\n\n---\n### Details\n";
        for (const c of comments) {
          fallbackBody += `\n${severityEmoji[c.severity] || "ℹ️"} **${categoryLabel[c.category]}** — \`${c.filePath}:${c.line}\`\n${c.body}\n`;
        }
      }

      await githubFetch(
        `https://api.github.com/repos/${ctx.repoFullName}/pulls/${ctx.prNumber}/reviews`,
        ctx.accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: fallbackBody,
            event: "COMMENT",
            comments: [],
          }),
        }
      );
    }
  }
}
