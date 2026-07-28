import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { closePool, getPoolStats } from "./database/db.js";
import { closeRedis, redis } from "./database/redis.js";
import analyticsRoutes from "./modules/analytics/analytics-routes.js";
import authRoutes from "./modules/auth/routes.js";
import candidateExamRoutes from "./modules/candidate/candidate-exam-routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard-routes.js";
import examBatchRoutes from "./modules/exams/exam-batch-routes.js";
import examRoutes from "./modules/exams/exam-routes.js";
import monitoringRoutes from "./modules/monitoring/monitoring-routes.js";
import candidateRoutes from "./modules/organization/candidate-routes.js";
import devicePublicRoutes from "./modules/organization/device-public-routes.js";
import deviceRoutes from "./modules/organization/device-routes.js";
import {
    batchesRoutes,
    institutionsRoutes,
} from "./modules/organization/org-routes.js";
import importExportRoutes from "./modules/question-bank/import-export-routes.js";
import questionsRoutes from "./modules/question-bank/questions-routes.js";
import { subjectsRoutes } from "./modules/question-bank/subjects-routes.js";
import resultsRoutes from "./modules/results/results-routes.js";
import sebRoutes from "./modules/seb/seb-routes.js";
import sessionRoutes from "./modules/sessions/session-routes.js";
import usersRoutes from "./modules/users/routes.js";
import { verifyToken } from "./services/auth.js";
import {
    startDisconnectWatcher,
    stopDisconnectWatcher,
} from "./services/disconnect-watcher.js";
import {
    startTimerScheduler,
    stopTimerScheduler,
} from "./services/timer-scheduler.js";
import sseRoutes from "./sse/sse-routes.js";
import websocketPlugin from "./websocket/server.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.passwordHash",
        "*.password",
        "*.passwordHash",
        "*.token",
      ],
      remove: true,
    },
  },
});

app.register(cors, {
  origin: env.NODE_ENV === "development" ? true : false,
});
app.register(helmet);
app.register(compress, {
  global: false, // Don't compress globally — SSE must not be buffered
  encodings: ["gzip", "deflate"],
  threshold: 1024,
});
app.register(rateLimit, {
  max: 1000,
  timeWindow: "1 minute",
  // Exclude SSE endpoints from rate limiting — they're long-lived connections
  keyGenerator: (request) => {
    if (
      request.url.startsWith("/sse/") ||
      request.url.startsWith("/api/sse/")
    ) {
      return `sse:${request.ip}`;
    }
    return request.ip;
  },
});
app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Allow empty JSON bodies for POST routes that don't require a body (e.g. /resume, /submit)
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    const str = typeof body === "string" ? body : body.toString();
    if (str.trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(str));
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)), undefined);
    }
  },
);

if (env.NODE_ENV === "development") {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "CBE Console API",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}

app.get("/health", async () => ({
  status: "ok",
  env: env.NODE_ENV,
  pool: getPoolStats(),
}));

app.get("/api", async () => ({
  message: "CBE Console API",
  version: "0.1.0",
}));

// Also register health at /api/v1/health for spec compliance (envelope wrapped)
app.get("/api/v1/health", async () => ({
  success: true,
  data: { status: "ok", env: env.NODE_ENV },
}));

// Public device routes — no auth required (LAN client discovery, self-registration, heartbeat)
await app.register(devicePublicRoutes, { prefix: "/api/v1/devices" });
await app.register(devicePublicRoutes, { prefix: "/api/devices" });

// Register /api/v1/* routes with response envelope (API_SPECIFICATION.md Section 2.5)
await app.register(
  async (v1Scope) => {
    // Apply response envelope to ALL routes in this scope
    v1Scope.addHook("onSend", async (_request, reply, payload) => {
      const ct = reply.getHeader("content-type");
      if (typeof ct === "string" && !ct.includes("json")) return payload;
      if (typeof payload !== "string" || payload.length === 0) return payload;

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return payload;
      }

      if (typeof parsed === "object" && parsed !== null && "success" in parsed)
        return payload;

      const statusCode = reply.statusCode;
      if (statusCode >= 200 && statusCode < 400) {
        return JSON.stringify({ success: true, data: parsed });
      } else {
        let errorCode = "INTERNAL_ERROR";
        let errorMessage = "An unexpected error occurred";
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed
        ) {
          const errObj = parsed as Record<string, unknown>;
          if (typeof errObj.error === "string") {
            errorMessage = errObj.error;
            const msg = errorMessage.toLowerCase();
            if (statusCode === 401)
              errorCode = msg.includes("expired")
                ? "TOKEN_EXPIRED"
                : "UNAUTHORIZED";
            else if (statusCode === 403)
              errorCode = msg.includes("device")
                ? "DEVICE_NOT_REGISTERED"
                : "FORBIDDEN";
            else if (statusCode === 404) errorCode = "NOT_FOUND";
            else if (statusCode === 409)
              errorCode = msg.includes("submitted")
                ? "ATTEMPT_ALREADY_SUBMITTED"
                : "CONFLICT";
            else if (statusCode === 423)
              errorCode = msg.includes("lock")
                ? "LOCKED_OUT"
                : "EXAM_NOT_ACTIVE";
            else if (statusCode === 429) errorCode = "RATE_LIMITED";
            else if (statusCode === 400) errorCode = "VALIDATION_ERROR";
          }
        }
        return JSON.stringify({
          success: false,
          error: { code: errorCode, message: errorMessage },
        });
      }
    });

    await v1Scope.register(authRoutes, { prefix: "/auth" });

    await v1Scope.register(async (protectedScope) => {
      protectedScope.addHook("onRequest", async (request, reply) => {
        // Allow public access to SEB config download (SEB needs it before login)
        if (request.url.match(/\/seb\/[^/]+\/config\.seb$/)) {
          return;
        }
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return reply.code(401).send({ error: "Missing access token" });
        }
        try {
          request.user = verifyToken(authHeader.slice(7));
        } catch {
          return reply.code(401).send({ error: "Invalid access token" });
        }
        // Single-session enforcement for candidates: check the persistent
        // active-JTI key (7-day TTL). If a newer login has overwritten it,
        // this (old) token is rejected on ALL requests. Unlike the session
        // lock (which has a 900s TTL and can expire), this key persists
        // until the next login or explicit logout — so the old session
        // stays killed.
        if (request.user.role === "candidate") {
          const activeJti = await redis.get(
            `session:active_jti:${request.user.sub}`,
          );
          if (activeJti && activeJti !== request.user.jti) {
            return reply.code(401).send({
              error: "Session taken over by another login",
              code: "SESSION_TAKEN_OVER",
            });
          }
        }
      });
      await protectedScope.register(usersRoutes, { prefix: "/users" });
      await protectedScope.register(institutionsRoutes, {
        prefix: "/institutions",
      });
      await protectedScope.register(batchesRoutes, { prefix: "/batches" });
      await protectedScope.register(subjectsRoutes, { prefix: "/subjects" });
      await protectedScope.register(questionsRoutes, { prefix: "/questions" });
      await protectedScope.register(importExportRoutes, {
        prefix: "/questions",
      });
      await protectedScope.register(examRoutes, { prefix: "/exams" });
      await protectedScope.register(examBatchRoutes, {
        prefix: "/exam-batches",
      });
      await protectedScope.register(candidateRoutes, { prefix: "/candidates" });
      await protectedScope.register(deviceRoutes, { prefix: "/devices" });
      await protectedScope.register(sessionRoutes, { prefix: "/sessions" });
      await protectedScope.register(candidateExamRoutes, {
        prefix: "/candidate/exams",
      });
      await protectedScope.register(sebRoutes, { prefix: "/seb" });
    });
  },
  { prefix: "/api/v1" },
);

// Keep old /api/ routes for backward compatibility with admin panel during migration
await app.register(authRoutes, { prefix: "/api/auth" });

await app.register(async (protectedScope) => {
  protectedScope.addHook("onRequest", async (request, reply) => {
    // Allow public access to SEB config download (SEB needs it before login)
    if (request.url.match(/\/seb\/[^/]+\/config\.seb$/)) {
      return;
    }
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing access token" });
    }
    try {
      request.user = verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({ error: "Invalid access token" });
    }
    // Single-session enforcement for candidates (same as /api/v1 scope)
    if (request.user.role === "candidate") {
      const activeJti = await redis.get(
        `session:active_jti:${request.user.sub}`,
      );
      if (activeJti && activeJti !== request.user.jti) {
        return reply.code(401).send({
          error: "Session taken over by another login",
          code: "SESSION_TAKEN_OVER",
        });
      }
    }
  });
  await protectedScope.register(usersRoutes, { prefix: "/api/users" });
  await protectedScope.register(institutionsRoutes, {
    prefix: "/api/institutions",
  });
  await protectedScope.register(batchesRoutes, { prefix: "/api/batches" });
  await protectedScope.register(subjectsRoutes, { prefix: "/api/subjects" });
  await protectedScope.register(questionsRoutes, { prefix: "/api/questions" });
  await protectedScope.register(importExportRoutes, {
    prefix: "/api/questions",
  });
  await protectedScope.register(examRoutes, { prefix: "/api/exams" });
  await protectedScope.register(examBatchRoutes, {
    prefix: "/api/exam-batches",
  });
  await protectedScope.register(candidateRoutes, {
    prefix: "/api/candidates",
  });
  await protectedScope.register(deviceRoutes, {
    prefix: "/api/devices",
  });
  await protectedScope.register(sessionRoutes, {
    prefix: "/api/sessions",
  });
  await protectedScope.register(resultsRoutes, {
    prefix: "/api/results",
  });
  await protectedScope.register(monitoringRoutes, {
    prefix: "/api/monitoring",
  });
  await protectedScope.register(analyticsRoutes, {
    prefix: "/api/analytics",
  });
  await protectedScope.register(dashboardRoutes, {
    prefix: "/api/dashboard",
  });
  await protectedScope.register(candidateExamRoutes, {
    prefix: "/api/candidate/exams",
  });
  await protectedScope.register(sebRoutes, { prefix: "/api/seb" });
});

await app.register(websocketPlugin);
// SSE routes — auth handled internally (token via query param).
// Registered at /sse (direct) and /api/sse (proxied via vite /api proxy).
await app.register(sseRoutes, { prefix: "/sse" });
await app.register(sseRoutes, { prefix: "/api/sse" });

app.addHook("onClose", async () => {
  stopTimerScheduler();
  stopDisconnectWatcher();
  await closeRedis();
  await closePool();
});

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`);

    // Start server-authoritative timer scheduler (M2.10)
    startTimerScheduler();
    app.log.info(
      "Timer scheduler started — Redis ZSET promoter (1s) + DB fallback (60s)",
    );

    // Start disconnect watcher for auto-pause on client disconnect
    await startDisconnectWatcher();
    app.log.info(
      "Disconnect watcher started — Redis keyspace + fallback poller",
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received. Closing server...`);
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
