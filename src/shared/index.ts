// ============================================================
// CodeReview Hub — Shared Types
// ============================================================

// --- Enums ---

export type ReviewStatus = "pending" | "running" | "done" | "error";

export type CommentCategory =
  | "security"
  | "performance"
  | "style"
  | "bug"
  | "best-practice";

export type CommentSeverity = "info" | "warning" | "error";

export type PullRequestStatus = "open" | "closed" | "merged";

// --- Models ---

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  webhookSecret: string | null;
  rules: string | null;
  createdAt: string;
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  url: string;
  status: PullRequestStatus;
  createdAt: string;
  repository?: Repository;
  reviews?: Review[];
}

export interface Review {
  id: string;
  prId: string;
  status: ReviewStatus;
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  tokensUsed: number | null;
  pullRequest?: PullRequest;
  comments?: ReviewComment[];
}

export interface ReviewComment {
  id: string;
  reviewId: string;
  filePath: string;
  line: number;
  body: string;
  category: CommentCategory;
  severity: CommentSeverity;
}

// --- API Request/Response types ---

export interface CreateRepositoryRequest {
  name: string;
  fullName: string;
  webhookSecret?: string;
  rules?: string;
}

export interface PullRequestFilters {
  repoId?: string;
  status?: PullRequestStatus;
  author?: string;
  page?: number;
  limit?: number;
}

export interface StatsResponse {
  totalRepositories: number;
  totalPullRequests: number;
  totalReviews: number;
  reviewsToday: number;
  issuesByCategory: Record<CommentCategory, number>;
  issuesBySeverity: Record<CommentSeverity, number>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// --- Webhook payload (simplified) ---

export interface GitHubWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
    };
    state: string;
    merged: boolean;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
}
