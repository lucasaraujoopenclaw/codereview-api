import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "../services/prisma";
import crypto from "crypto";

export const githubAuthRoutes = Router();

// In-memory state store (for OAuth state validation)
// In production, consider using Redis or a database table with expiration
const stateStore = new Map<string, { userId: string; createdAt: number }>();

// Clean up expired states (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;
  for (const [state, data] of stateStore.entries()) {
    if (now - data.createdAt > TEN_MINUTES) {
      stateStore.delete(state);
    }
  }
}, 60 * 1000); // Run every minute

// Helper to call GitHub API
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
    const errorText = await response.text();
    console.error(`GitHub API error (${response.status}):`, errorText);
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response;
}

// GET /auth/github — redirect to GitHub OAuth
githubAuthRoutes.get("/auth/github", (req: Request, res: Response) => {
  const { GITHUB_CLIENT_ID, GITHUB_CALLBACK_URL } = process.env;

  if (!GITHUB_CLIENT_ID || !GITHUB_CALLBACK_URL) {
    throw new AppError(500, "GitHub OAuth not configured");
  }

  // Accept token via query param (browser redirect) or Authorization header
  const queryToken = req.query.token as string | undefined;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.substring(7)
    : undefined;
  const token = queryToken || headerToken;

  if (!token) {
    throw new AppError(401, "Missing authentication token");
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new AppError(500, "JWT_SECRET not configured");
  }

  let payload: { userId: string; email: string };
  try {
    payload = jwt.verify(token, jwtSecret) as { userId: string; email: string };
  } catch {
    throw new AppError(401, "Invalid token");
  }

  const userId = payload.userId;
  const state = crypto.randomUUID();

  // Store state with userId for validation in callback
  stateStore.set(state, { userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: "repo,read:user,user:email",
    state,
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  res.redirect(authUrl);
});

// GET /auth/github/callback — handle GitHub OAuth callback
githubAuthRoutes.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, FRONTEND_URL } = process.env;

  const frontendUrl = FRONTEND_URL || "https://qualitygate.space";

  try {
    // Validate inputs
    if (!code || typeof code !== "string") {
      return res.redirect(`${frontendUrl}/github/connected?error=missing_code`);
    }

    if (!state || typeof state !== "string") {
      return res.redirect(`${frontendUrl}/github/connected?error=missing_state`);
    }

    // Validate state
    const stateData = stateStore.get(state);
    if (!stateData) {
      return res.redirect(`${frontendUrl}/github/connected?error=invalid_state`);
    }

    const { userId } = stateData;
    stateStore.delete(state); // Use state only once

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return res.redirect(`${frontendUrl}/github/connected?error=server_config`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("GitHub token exchange failed:", tokenResponse.status);
      return res.redirect(`${frontendUrl}/github/connected?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("No access token received:", tokenData);
      return res.redirect(`${frontendUrl}/github/connected?error=no_access_token`);
    }

    // Fetch GitHub user data
    const userResponse = await githubFetch("https://api.github.com/user", accessToken);
    const githubUser = await userResponse.json();

    // Create or update GitHubConnection
    await prisma.gitHubConnection.upsert({
      where: { githubId: githubUser.id },
      create: {
        userId,
        githubId: githubUser.id,
        username: githubUser.login,
        accessToken,
      },
      update: {
        username: githubUser.login,
        accessToken,
        updatedAt: new Date(),
      },
    });

    res.redirect(`${frontendUrl}/github/connected?success=true`);
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    const errorMessage = error instanceof Error ? error.message : "unknown_error";
    res.redirect(`${frontendUrl}/github/connected?error=${encodeURIComponent(errorMessage)}`);
  }
});

// GET /api/github/status — check GitHub connection status
githubAuthRoutes.get("/api/github/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const connection = await prisma.gitHubConnection.findFirst({
    where: { userId },
  });

  if (!connection) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    username: connection.username,
    connectedAt: connection.createdAt.toISOString(),
  });
});

// GET /api/github/repos — list user's GitHub repositories
githubAuthRoutes.get("/api/github/repos", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const connection = await prisma.gitHubConnection.findFirst({
    where: { userId },
  });

  if (!connection) {
    throw new AppError(400, "GitHub not connected");
  }

  try {
    const repos: any[] = [];
    let page = 1;
    const perPage = 100;

    // Fetch all repos (with pagination)
    while (true) {
      const response = await githubFetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated&type=all`,
        connection.accessToken
      );

      const pageRepos = await response.json();
      if (pageRepos.length === 0) break;

      repos.push(...pageRepos);
      
      // Check if there are more pages via Link header
      const linkHeader = response.headers.get("Link");
      const hasNext = linkHeader?.includes('rel="next"');
      
      if (!hasNext || pageRepos.length < perPage) break;
      page++;
    }

    // Format response
    const formattedRepos = repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      html_url: repo.html_url,
      language: repo.language,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
    }));

    res.json(formattedRepos);
  } catch (error) {
    console.error("Error fetching GitHub repos:", error);
    throw new AppError(500, "Failed to fetch repositories from GitHub");
  }
});

// POST /api/github/repos/enable — enable a repository for code review
githubAuthRoutes.post("/api/github/repos/enable", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { repoFullName } = req.body;

  if (!repoFullName || typeof repoFullName !== "string") {
    throw new AppError(400, "repoFullName is required");
  }

  const connection = await prisma.gitHubConnection.findFirst({
    where: { userId },
  });

  if (!connection) {
    throw new AppError(400, "GitHub not connected");
  }

  try {
    // Verify repo exists on GitHub
    const repoResponse = await githubFetch(
      `https://api.github.com/repos/${repoFullName}`,
      connection.accessToken
    );
    const repoData = await repoResponse.json();

    // Create repository in database
    const repository = await prisma.repository.create({
      data: {
        userId,
        name: repoData.name,
        fullName: repoData.full_name,
      },
    });

    res.status(201).json(repository);
  } catch (error) {
    console.error("Error enabling repository:", error);
    if (error instanceof Error && error.message.includes("404")) {
      throw new AppError(404, "Repository not found on GitHub");
    }
    throw new AppError(500, "Failed to enable repository");
  }
});

// DELETE /api/github/repos/:id/disable — disable a repository
githubAuthRoutes.delete("/api/github/repos/:id/disable", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  // Verify repository belongs to user
  const repository = await prisma.repository.findFirst({
    where: { id, userId },
  });

  if (!repository) {
    throw new AppError(404, "Repository not found");
  }

  await prisma.repository.delete({
    where: { id },
  });

  res.status(204).send();
});

// DELETE /api/github/disconnect — disconnect GitHub account
githubAuthRoutes.delete("/api/github/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  await prisma.gitHubConnection.deleteMany({
    where: { userId },
  });

  res.status(204).send();
});
