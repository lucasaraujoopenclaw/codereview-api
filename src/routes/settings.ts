import { Router } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { encryptString } from "../services/crypto";

export const settingsRoutes = Router();

const openaiSchema = z.object({
  apiKey: z.string().min(10),
});

// GET /api/settings/openai
settingsRoutes.get(
  "/openai",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        openaiApiKeyEnc: true,
        openaiApiKeyLast4: true,
      },
    });

    res.json({
      configured: Boolean(user?.openaiApiKeyEnc),
      last4: user?.openaiApiKeyLast4 ?? null,
    });
  })
);

// POST /api/settings/openai
settingsRoutes.post(
  "/openai",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const parsed = openaiSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0].message);
    }

    const apiKey = parsed.data.apiKey.trim();

    // Basic format guard (OpenAI keys commonly start with sk- or sk-proj-)
    if (!apiKey.startsWith("sk-")) {
      throw new AppError(400, "Chave da OpenAI inválida (esperado prefixo sk-)");
    }

    let encrypted;
    try {
      encrypted = encryptString(apiKey);
    } catch (err) {
      console.error("Encryption error:", err);
      throw new AppError(500, "Servidor não configurado para armazenar a chave (APP_ENCRYPTION_KEY)" );
    }

    const last4 = apiKey.slice(-4);

    await prisma.user.update({
      where: { id: userId },
      data: {
        openaiApiKeyEnc: encrypted.enc,
        openaiApiKeyIv: encrypted.iv,
        openaiApiKeyTag: encrypted.tag,
        openaiApiKeyLast4: last4,
      },
    });

    res.status(204).send();
  })
);

// DELETE /api/settings/openai
settingsRoutes.delete(
  "/openai",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    await prisma.user.update({
      where: { id: userId },
      data: {
        openaiApiKeyEnc: null,
        openaiApiKeyIv: null,
        openaiApiKeyTag: null,
        openaiApiKeyLast4: null,
      },
    });

    res.status(204).send();
  })
);
