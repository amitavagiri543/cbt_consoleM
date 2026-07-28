import { and, eq, gt } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../../database/db.js";
import { redis } from "../../database/redis.js";
import {
    candidates,
    deviceRegistrations,
    examBatchCandidates,
    examBatches,
    institutions,
    sessionTokens,
    users,
} from "../../database/schemas/index.js";
import {
    generateTokenPair,
    hashPassword,
    verifyPassword,
    verifyToken,
    type TokenPayload,
} from "../../services/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const candidateLoginSchema = z.object({
  admitCardNumber: z.string().min(1),
  dateOfBirth: z
    .string()
    .regex(/^\d{8}$/, "Date of birth must be in DDMMYYYY format"),
  deviceId: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const body = parsed.data;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, body.email.toLowerCase()))
        .limit(1);

      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      if (!user.isActive) {
        return reply.code(403).send({ error: "Account disabled" });
      }

      // Optional device binding
      if (body.deviceId) {
        const [device] = await db
          .select()
          .from(deviceRegistrations)
          .where(eq(deviceRegistrations.deviceId, body.deviceId))
          .limit(1);

        if (!device) {
          return reply.code(403).send({ error: "Device not registered" });
        }

        if (
          device.status === "suspended" ||
          device.status === "decommissioned"
        ) {
          return reply.code(403).send({ error: "Device suspended" });
        }

        // Use the device registration UUID (not the string device_id) for session_tokens
        (body as { _deviceUuid?: string })._deviceUuid = device.id;
      }

      const tokens = generateTokenPair({
        sub: user.id,
        role: user.role,
        deviceId: body.deviceId,
      });

      const accessJti = verifyToken(tokens.accessToken).jti;
      const refreshJti = verifyToken(tokens.refreshToken).jti;

      await db.transaction(async (tx) => {
        const deviceUuid =
          (body as { _deviceUuid?: string })._deviceUuid ?? null;
        await tx.insert(sessionTokens).values([
          {
            userId: user.id,
            tokenJti: accessJti,
            tokenType: "access",
            deviceId: deviceUuid,
            expiresAt: tokens.accessExpiresAt,
          },
          {
            userId: user.id,
            tokenJti: refreshJti,
            tokenType: "refresh",
            deviceId: deviceUuid,
            expiresAt: tokens.refreshExpiresAt,
          },
        ]);

        await tx
          .update(users)
          .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
          .where(eq(users.id, user.id));
      });

      // Response format per API_SPECIFICATION.md Section 3.1
      const expiresInSeconds = Math.floor(
        (tokens.accessExpiresAt.getTime() - Date.now()) / 1000,
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: expiresInSeconds,
        // Keep accessExpiresAt/refreshExpiresAt for admin panel backward compatibility
        accessExpiresAt: tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      };
    },
  );

  app.post("/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const body = parsed.data;

    let payload: TokenPayload;
    try {
      payload = verifyToken(body.refreshToken);
    } catch {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }

    const [tokenRow] = await db
      .select()
      .from(sessionTokens)
      .where(
        and(
          eq(sessionTokens.tokenJti, payload.jti),
          eq(sessionTokens.tokenType, "refresh"),
          eq(sessionTokens.isRevoked, false),
          gt(sessionTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!tokenRow) {
      return reply
        .code(401)
        .send({ error: "Refresh token revoked or expired" });
    }

    // Revoke old refresh token
    await db
      .update(sessionTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(sessionTokens.id, tokenRow.id));

    const tokens = generateTokenPair({
      sub: payload.sub,
      role: payload.role,
      deviceId: payload.deviceId,
      examBatchId: payload.examBatchId,
      attemptId: payload.attemptId,
    });

    const accessJti = verifyToken(tokens.accessToken).jti;
    const refreshJti = verifyToken(tokens.refreshToken).jti;

    await db.insert(sessionTokens).values([
      {
        userId: payload.sub,
        tokenJti: accessJti,
        tokenType: "access",
        deviceId: tokenRow.deviceId,
        attemptId: tokenRow.attemptId,
        expiresAt: tokens.accessExpiresAt,
      },
      {
        userId: payload.sub,
        tokenJti: refreshJti,
        tokenType: "refresh",
        deviceId: tokenRow.deviceId,
        attemptId: tokenRow.attemptId,
        expiresAt: tokens.refreshExpiresAt,
      },
    ]);

    // Response format per API_SPECIFICATION.md Section 3.2
    const expiresInSeconds = Math.floor(
      (tokens.accessExpiresAt.getTime() - Date.now()) / 1000,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: expiresInSeconds,
      // Keep for admin panel backward compatibility
      accessExpiresAt: tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
    };
  });

  app.post("/logout", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing access token" });
    }

    const accessToken = authHeader.slice(7);
    let payload: TokenPayload;
    try {
      payload = verifyToken(accessToken);
    } catch {
      return reply.code(401).send({ error: "Invalid access token" });
    }

    await db
      .update(sessionTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(sessionTokens.tokenJti, payload.jti));

    // Clear Redis session keys so this user can log in fresh elsewhere
    // without the old persistent JTI blocking the new session.
    await redis.del(`session:active_jti:${payload.sub}`);
    await redis.del(`session:lock:${payload.sub}`);
    await redis.del(`session:fingerprint:${payload.sub}`);

    return { message: "Logged out" };
  });

  // ─── POST /auth/candidate-login ───────────────────────────────
  app.post(
    "/candidate-login",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = candidateLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const body = parsed.data;

      // Look up candidate by admit card number
      const [candidate] = await db
        .select({
          id: candidates.id,
          userId: candidates.userId,
          dateOfBirth: candidates.dateOfBirth,
          isActive: candidates.isActive,
          fullName: users.fullName,
          admitCardNumber: candidates.admitCardNumber,
        })
        .from(candidates)
        .innerJoin(users, eq(users.id, candidates.userId))
        .where(eq(candidates.admitCardNumber, body.admitCardNumber))
        .limit(1);

      if (!candidate) {
        return reply.code(401).send({ error: "Invalid admit card number" });
      }

      if (!candidate.isActive) {
        return reply.code(403).send({ error: "Candidate account disabled" });
      }

      // Verify DOB (stored as DDMMYYYY string)
      if (candidate.dateOfBirth !== body.dateOfBirth) {
        return reply.code(401).send({ error: "Date of birth does not match" });
      }

      // Check if candidate is assigned to any active exam batch
      const assignments = await db
        .select({
          examBatchId: examBatchCandidates.examBatchId,
          status: examBatches.status,
        })
        .from(examBatchCandidates)
        .innerJoin(
          examBatches,
          eq(examBatches.id, examBatchCandidates.examBatchId),
        )
        .where(eq(examBatchCandidates.candidateId, candidate.id));

      const activeBatches = assignments.filter((a) => a.status === "active");

      if (activeBatches.length === 0) {
        return reply.code(403).send({
          error: "No active exams assigned. Please contact your administrator.",
        });
      }

      // Revoke all previous active tokens for this candidate (single session enforcement)
      await db
        .update(sessionTokens)
        .set({ isRevoked: true, revokedAt: new Date() })
        .where(
          and(
            eq(sessionTokens.userId, candidate.userId),
            eq(sessionTokens.isRevoked, false),
          ),
        );

      // Auto-register device from request metadata
      let registeredDeviceId: string | null = null;
      const clientIp = request.ip;
      const userAgent = request.headers["user-agent"] ?? "unknown";
      const deviceFp = body.deviceFingerprint ?? body.deviceId ?? null;

      if (deviceFp) {
        // Upsert device: create if not exists, update lastSeenAt if exists
        const [existingDevice] = await db
          .select({ id: deviceRegistrations.id })
          .from(deviceRegistrations)
          .where(eq(deviceRegistrations.deviceId, deviceFp))
          .limit(1);

        if (existingDevice) {
          registeredDeviceId = existingDevice.id;
          await db
            .update(deviceRegistrations)
            .set({
              lastSeenAt: new Date(),
              ipAddress: clientIp,
              updatedAt: new Date(),
            })
            .where(eq(deviceRegistrations.id, existingDevice.id));
        } else {
          const [newDevice] = await db
            .insert(deviceRegistrations)
            .values({
              deviceId: deviceFp,
              deviceName: userAgent.slice(0, 100),
              macAddress: "00:00:00:00:00:00",
              hardwareHash: deviceFp,
              ipAddress: clientIp,
              status: "active",
              registeredBy: candidate.userId,
              lastSeenAt: new Date(),
            })
            .returning({ id: deviceRegistrations.id });
          registeredDeviceId = newDevice.id;
        }
      }

      // Generate tokens with candidate role
      const tokens = generateTokenPair({
        sub: candidate.userId,
        role: "candidate",
        deviceId: registeredDeviceId ?? body.deviceId,
      });

      const accessJti = verifyToken(tokens.accessToken).jti;
      const refreshJti = verifyToken(tokens.refreshToken).jti;

      await db.insert(sessionTokens).values([
        {
          userId: candidate.userId,
          tokenJti: accessJti,
          tokenType: "access",
          expiresAt: tokens.accessExpiresAt,
        },
        {
          userId: candidate.userId,
          tokenJti: refreshJti,
          tokenType: "refresh",
          expiresAt: tokens.refreshExpiresAt,
        },
      ]);

      await db
        .update(users)
        .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
        .where(eq(users.id, candidate.userId));

      // Acquire Redis session lock — single session enforcement
      // TTL = 900s (15 min, matches access token expiry). SSE connection
      // presence refreshes it (the SSE endpoint checks the session lock).
      const lockKey = `session:lock:${candidate.userId}`;
      await redis.set(lockKey, accessJti, "EX", 900);

      // Persistent key — tracks the currently active JTI for this user.
      // Used by the auth middleware to reject old sessions even after the
      // session lock expires. TTL = 7 days (matches refresh token expiry)
      // so orphaned keys are cleaned up if the candidate never logs out.
      await redis.set(
        `session:active_jti:${candidate.userId}`,
        accessJti,
        "EX",
        604_800,
      );

      // Store device fingerprint in Redis for verification on SSE connect
      if (body.deviceFingerprint) {
        await redis.set(
          `session:fingerprint:${candidate.userId}`,
          body.deviceFingerprint,
          "EX",
          900,
        );
      }

      const expiresInSeconds = Math.floor(
        (tokens.accessExpiresAt.getTime() - Date.now()) / 1000,
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: expiresInSeconds,
        accessExpiresAt: tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
        user: {
          id: candidate.userId,
          fullName: candidate.fullName,
          admitCardNumber: candidate.admitCardNumber ?? null,
          role: "candidate",
          activeExamBatchIds: activeBatches.map((a) => a.examBatchId),
        },
      };
    },
  );

  // ─── POST /auth/change-password ───────────────────────────────
  app.post("/change-password", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing access token" });
    }

    let payload: TokenPayload;
    try {
      payload = verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ error: "Invalid access token" });
    }

    const changePasswordSchema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(100),
    });

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }

    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return { message: "Password changed successfully" };
  });

  // ─── GET /auth/me ─────────────────────────────────────────────
  app.get("/me", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing access token" });
    }

    let payload: TokenPayload;
    try {
      payload = verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ error: "Invalid access token" });
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        phone: users.phone,
        isActive: users.isActive,
        institutionId: users.institutionId,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    let institution: { id: string; name: string } | null = null;
    if (user.institutionId) {
      const [inst] = await db
        .select({ id: institutions.id, name: institutions.name })
        .from(institutions)
        .where(eq(institutions.id, user.institutionId))
        .limit(1);
      if (inst) institution = inst;
    }

    const permissions = getRolePermissions(user.role);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      phone: user.phone,
      isActive: user.isActive,
      institution,
      permissions,
    };
  });
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ["*"],
  exam_admin: [
    "users:read",
    "institutions:read",
    "batches:read",
    "subjects:read",
    "question-banks:read",
    "questions:read",
    "exams:read",
    "exams:write",
    "exam-batches:read",
    "exam-batches:write",
    "candidates:read",
    "candidates:write",
    "devices:read",
    "sessions:read",
    "sessions:write",
  ],
  proctor: [
    "exam-batches:read",
    "sessions:read",
    "sessions:write",
    "candidates:read",
    "devices:read",
  ],
  question_author: [
    "question-banks:read",
    "question-banks:write",
    "questions:read",
    "questions:write",
    "subjects:read",
  ],
  candidate: [
    "candidate:exams:read",
    "candidate:answers:write",
    "candidate:submit",
  ],
};

function getRolePermissions(role: string): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export default authRoutes;
