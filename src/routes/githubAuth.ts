import { Router } from "express";
import { requireAuth } from "../middleware/auth";

export const githubAuthRoutes = Router();

// GET /auth/github — redirect to GitHub OAuth (placeholder)
githubAuthRoutes.get("/auth/github", (_req, res) => {
  res.status(501).json({
    error: "Not implemented",
    message: "GitHub OAuth flow not yet implemented",
  });
});

// GET /auth/github/callback — handle GitHub OAuth callback (placeholder)
githubAuthRoutes.get("/auth/github/callback", (_req, res) => {
  res.status(501).json({
    error: "Not implemented",
    message: "GitHub OAuth callback not yet implemented",
  });
});

// GET /api/github/repos — list repos for the authenticated user (placeholder)
githubAuthRoutes.get("/api/github/repos", requireAuth, (_req, res) => {
  res.status(501).json({
    error: "Not implemented",
    message: "GitHub repository listing not yet implemented",
  });
});
