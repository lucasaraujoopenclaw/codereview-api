# CodeReview API

Backend API for the CodeReview Hub — an AI-powered code review platform.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express.js
- **Database:** SQLite (via Prisma ORM)
- **Validation:** Zod

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

## Scripts

| Script              | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Start dev server with hot reload   |
| `npm run build`     | Compile TypeScript to JavaScript   |
| `npm start`         | Run compiled production server     |
| `npm run lint`      | Type-check without emitting        |
| `npm run prisma:generate` | Generate Prisma client        |
| `npm run prisma:migrate`  | Run database migrations       |

## API Endpoints

| Method | Path                       | Description               |
| ------ | -------------------------- | ------------------------- |
| GET    | `/health`                  | Health check              |
| POST   | `/webhooks/github`         | GitHub webhook receiver   |
| GET    | `/api/repositories`        | List repositories         |
| POST   | `/api/repositories`        | Register a repository     |
| GET    | `/api/repositories/:id`    | Get repository details    |
| DELETE | `/api/repositories/:id`    | Remove a repository       |
| GET    | `/api/pull-requests`       | List pull requests        |
| GET    | `/api/pull-requests/:id`   | Get PR details + reviews  |
| GET    | `/api/reviews/:id`         | Get review details        |
| GET    | `/api/stats`               | Aggregated metrics        |

## Docker

```bash
docker build -t codereview-api .
docker run -p 3001:3001 codereview-api
```

## License

Private
