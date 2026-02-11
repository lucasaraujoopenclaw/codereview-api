import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../services/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";

export const authRoutes = Router();

const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

// POST /auth/google — authenticate with Google ID token
authRoutes.post(
  "/google",
  asyncHandler(async (req, res) => {
    const parsed = googleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid request body");
    }

    const { idToken } = parsed.data;

    // Validate Google ID token
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AppError(500, "GOOGLE_CLIENT_ID not configured");
    }

    const client = new OAuth2Client(clientId);
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
    } catch (err) {
      throw new AppError(401, "Invalid Google ID token");
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new AppError(401, "Invalid token payload");
    }

    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { googleId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId,
          email,
          name: name || null,
          avatarUrl: picture || null,
        },
      });
    } else {
      // Update user info if changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email,
          name: name || user.name,
          avatarUrl: picture || user.avatarUrl,
        },
      });
    }

    // Generate JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError(500, "JWT_SECRET not configured");
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  })
);
