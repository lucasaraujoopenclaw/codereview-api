import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { repositoryRoutes } from "./routes/repositories";
import { pullRequestRoutes } from "./routes/pullRequests";
import { reviewRoutes } from "./routes/reviews";
import { webhookRoutes } from "./routes/webhooks";
import { statsRoutes } from "./routes/stats";
import { authRoutes } from "./routes/auth";
import { githubAuthRoutes } from "./routes/githubAuth";
import { requireAuth } from "./middleware/auth";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/auth", authRoutes);
app.use(githubAuthRoutes);

app.use("/webhooks", webhookRoutes);

// Protect all /api/* routes
app.use("/api", requireAuth);

app.use("/api/repositories", repositoryRoutes);
app.use("/api/pull-requests", pullRequestRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/stats", statsRoutes);

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, () => {
  console.log(`🚀 CodeReview Hub API running on http://localhost:${PORT}`);
});

export default app;
