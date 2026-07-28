/**
 * Single candidate SSE test — verify attempt:active key is set.
 */
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../src/database/db.js";
import { redis } from "../src/database/redis.js";
import {
    attempts,
    candidates,
    deviceRegistrations,
    examBatchCandidates,
    sessionTokens,
    users,
} from "../src/database/schemas/index.js";

const API_BASE = "http://localhost:3000/api/v1";
const SSE_BASE = "http://localhost:3000/api/sse";
const BATCH_ID = "16b4b7df-c75a-47c0-ab1c-4d65bc3f44dd";

async function main() {
  // Create 1 test candidate
  const userId = randomUUID();
  const candidateId = randomUUID();
  const admitCard = "SINGLE001";

  await db.insert(users).values({
    id: userId,
    email: "single001@test.local",
    passwordHash: "$2b$10$placeholder",
    fullName: "Single Test",
    role: "candidate",
    phone: "90000001",
    isActive: true,
    institutionId: "3b61e033-9e16-4355-b299-94300c0c13c9",
  });
  await db.insert(candidates).values({
    id: candidateId,
    userId,
    institutionId: "3b61e033-9e16-4355-b299-94300c0c13c9",
    admitCardNumber: admitCard,
    dateOfBirth: "01012000",
  });
  await db.insert(examBatchCandidates).values({
    examBatchId: BATCH_ID,
    candidateId,
  });

  console.log("Created candidate:", admitCard);

  // Login
  const loginRes = await fetch(`${API_BASE}/auth/candidate-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      admitCardNumber: admitCard,
      dateOfBirth: "01012000",
      deviceFingerprint: "single-test-device",
    }),
  });
  const loginBody = (await loginRes.json()) as any;
  const token = loginBody.data?.accessToken;
  console.log("Login:", loginRes.status, token ? "OK" : "FAILED");

  // Start exam
  const startRes = await fetch(
    `${API_BASE}/candidate/exams/${BATCH_ID}/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deviceId: "single-test-device" }),
    },
  );
  const startBody = (await startRes.json()) as any;
  const attemptId = startBody.data?.attemptId ?? startBody.attemptId;
  console.log("Start exam:", startRes.status, "attemptId:", attemptId);

  // Check Redis keys immediately after start
  const activeKey = await redis.get(`attempt:active:${attemptId}`);
  console.log("attempt:active key after /start:", activeKey);

  const lockKey = await redis.get(`session:lock:${userId}`);
  console.log("session:lock key:", lockKey);

  const jtiKey = await redis.get(`session:active_jti:${userId}`);
  console.log("session:active_jti key:", jtiKey);

  // Open SSE
  const sseUrl = `${SSE_BASE}/candidate?token=${encodeURIComponent(token)}`;
  const sseRes = await fetch(sseUrl, {
    headers: { Accept: "text/event-stream" },
  });
  console.log("SSE:", sseRes.status);

  // Wait 2s for SSE to process
  await new Promise((r) => setTimeout(r, 2000));

  // Check Redis keys after SSE connect
  const activeKeyAfterSSE = await redis.get(`attempt:active:${attemptId}`);
  console.log("attempt:active key after SSE:", activeKeyAfterSSE);

  // Read SSE for 5 seconds
  const reader = sseRes.body!.getReader();
  const decoder = new TextDecoder();
  let events = 0;
  let keepAlives = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < 20000) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 5000),
      ),
    ]);
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.includes("keep-alive")) keepAlives++;
    if (text.startsWith("event: ")) events++;
    console.log("SSE data:", text.trim().slice(0, 100));
  }

  console.log(
    `\nSSE stats: ${events} events, ${keepAlives} keep-alives in 20s`,
  );

  // Final Redis check
  const activeKeyFinal = await redis.get(`attempt:active:${attemptId}`);
  console.log("attempt:active key final:", activeKeyFinal);

  // Cleanup
  await sseRes.body!.cancel();
  await db.delete(attempts).where(inArray(attempts.candidateId, [candidateId]));
  await db
    .delete(examBatchCandidates)
    .where(inArray(examBatchCandidates.candidateId, [candidateId]));
  await db.delete(candidates).where(inArray(candidates.id, [candidateId]));
  await db.delete(sessionTokens).where(inArray(sessionTokens.userId, [userId]));
  await db
    .delete(deviceRegistrations)
    .where(inArray(deviceRegistrations.registeredBy, [userId]));
  await db.delete(users).where(inArray(users.id, [userId]));
  console.log("Cleaned up.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
