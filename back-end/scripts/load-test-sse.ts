/**
 * Load Test: 100 SSE Candidate Connections
 *
 * This script:
 * 1. Creates 100 test candidates in the DB (assigned to an active exam batch)
 * 2. Logs in each candidate via the API
 * 3. Opens an SSE connection for each candidate simultaneously
 * 4. Monitors keep-alive pings and connection health
 * 5. Reports stats: connection count, keep-alive latency, memory usage
 * 6. Cleans up test candidates after the test
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
const BATCH_ID = "16b4b7df-c75a-47c0-ab1c-4d65bc3f44dd"; // Math Aptitude Test (active)
const NUM_CANDIDATES = 100;
const TEST_PREFIX = "LOAD";
const DOB = "01012000";

interface TestCandidate {
  admitCard: string;
  userId: string;
  candidateId: string;
  token: string | null;
  sseResponse: Response | null;
  keepAliveCount: number;
  eventCount: number;
  connectedAt: number;
  lastPingAt: number;
  errors: string[];
}

// ─── Step 1: Create test candidates ─────────────────────────────────
async function createTestCandidates(): Promise<TestCandidate[]> {
  console.log(`\n[1/5] Creating ${NUM_CANDIDATES} test candidates...`);
  const testCandidates: TestCandidate[] = [];
  const institutionId = "3b61e033-9e16-4355-b299-94300c0c13c9";

  for (let i = 1; i <= NUM_CANDIDATES; i++) {
    const admitCard = `${TEST_PREFIX}${String(i).padStart(3, "0")}`;
    const userId = randomUUID();
    const candidateId = randomUUID();

    // Insert user
    await db.insert(users).values({
      id: userId,
      email: `loadtest${i}@test.local`,
      passwordHash: "$2b$10$placeholder",
      fullName: `Load Test Candidate ${i}`,
      role: "candidate",
      phone: `90000${String(i).padStart(5, "0")}`,
      isActive: true,
      institutionId,
    });

    // Insert candidate
    await db.insert(candidates).values({
      id: candidateId,
      userId,
      institutionId,
      admitCardNumber: admitCard,
      dateOfBirth: DOB,
    });

    // Assign to exam batch
    await db.insert(examBatchCandidates).values({
      examBatchId: BATCH_ID,
      candidateId,
    });

    testCandidates.push({
      admitCard,
      userId,
      candidateId,
      token: null,
      sseResponse: null,
      keepAliveCount: 0,
      eventCount: 0,
      connectedAt: 0,
      lastPingAt: 0,
      errors: [],
    });

    if (i % 20 === 0) console.log(`  Created ${i}/${NUM_CANDIDATES}...`);
  }

  console.log(`  ✓ Created ${NUM_CANDIDATES} candidates`);
  return testCandidates;
}

// ─── Step 2: Login all candidates ───────────────────────────────────
async function loginCandidates(testCandidates: TestCandidate[]): Promise<void> {
  console.log(`\n[2/5] Logging in ${NUM_CANDIDATES} candidates...`);
  let success = 0;
  let failed = 0;

  // Login in batches of 10 to avoid overwhelming the rate limiter
  const BATCH_SIZE = 10;
  for (let i = 0; i < testCandidates.length; i += BATCH_SIZE) {
    const batch = testCandidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (tc) => {
        const res = await fetch(`${API_BASE}/auth/candidate-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admitCardNumber: tc.admitCard,
            dateOfBirth: DOB,
            deviceFingerprint: `loadtest-device-${tc.admitCard}`,
          }),
        });
        if (!res.ok) {
          throw new Error(
            `Login failed for ${tc.admitCard}: ${res.status} ${await res.text()}`,
          );
        }
        const body = (await res.json()) as {
          success?: boolean;
          data?: { accessToken: string };
          accessToken?: string;
        };
        tc.token = body.data?.accessToken ?? body.accessToken ?? null;
        if (!tc.token) throw new Error("No accessToken in response");
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") success++;
      else {
        failed++;
        if (batch[results.indexOf(r)]) {
          batch[results.indexOf(r)].errors.push(String(r.reason));
        }
      }
    }

    console.log(
      `  Logged in ${Math.min(i + BATCH_SIZE, testCandidates.length)}/${NUM_CANDIDATES} (success: ${success}, failed: ${failed})`,
    );
    // Small delay between batches to respect rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`  ✓ Login complete: ${success} success, ${failed} failed`);
}

// ─── Step 3: Start exam for each candidate ──────────────────────────
async function startExams(testCandidates: TestCandidate[]): Promise<void> {
  console.log(`\n[3/5] Starting exams for candidates with tokens...`);
  let success = 0;
  let skipped = 0;

  const BATCH_SIZE = 10;
  for (let i = 0; i < testCandidates.length; i += BATCH_SIZE) {
    const batch = testCandidates.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (tc) => {
        if (!tc.token) {
          skipped++;
          return;
        }
        try {
          const res = await fetch(
            `${API_BASE}/candidate/exams/${BATCH_ID}/start`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tc.token}`,
              },
              body: JSON.stringify({
                deviceId: `loadtest-device-${tc.admitCard}`,
              }),
            },
          );
          if (res.ok) {
            success++;
          }
        } catch (e) {
          tc.errors.push(`startExam: ${String(e)}`);
        }
      }),
    );

    if (
      (i + BATCH_SIZE) % 20 === 0 ||
      i + BATCH_SIZE >= testCandidates.length
    ) {
      console.log(
        `  Started ${Math.min(i + BATCH_SIZE, testCandidates.length)}/${NUM_CANDIDATES}...`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `  ✓ Exam start: ${success} started, ${skipped} skipped (no token)`,
  );
}

// ─── Step 4: Open SSE connections ───────────────────────────────────
async function openSSEConnections(
  testCandidates: TestCandidate[],
): Promise<void> {
  console.log(
    `\n[4/5] Opening SSE connections for ${NUM_CANDIDATES} candidates...`,
  );

  let connected = 0;
  let failed = 0;

  // Open all SSE connections simultaneously (in batches of 25)
  const BATCH_SIZE = 25;
  for (let i = 0; i < testCandidates.length; i += BATCH_SIZE) {
    const batch = testCandidates.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (tc) => {
        if (!tc.token) {
          failed++;
          return;
        }
        try {
          const url = `${SSE_BASE}/candidate?token=${encodeURIComponent(tc.token)}`;
          const res = await fetch(url, {
            headers: { Accept: "text/event-stream" },
          });

          if (!res.ok || !res.body) {
            tc.errors.push(`SSE connect: ${res.status}`);
            failed++;
            return;
          }

          tc.sseResponse = res;
          tc.connectedAt = Date.now();

          // Read the stream in the background
          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                // Count keep-alive comments and events
                if (text.includes(": keep-alive")) {
                  tc.keepAliveCount++;
                  tc.lastPingAt = Date.now();
                }
                if (text.startsWith("event: ")) {
                  tc.eventCount++;
                }
              }
            } catch (e) {
              tc.errors.push(`SSE read: ${String(e)}`);
            }
          })();

          connected++;
        } catch (e) {
          tc.errors.push(`SSE fetch: ${String(e)}`);
          failed++;
        }
      }),
    );

    console.log(
      `  Connected ${Math.min(i + BATCH_SIZE, testCandidates.length)}/${NUM_CANDIDATES}...`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`  ✓ SSE: ${connected} connected, ${failed} failed`);
}

// ─── Step 5: Monitor and report ─────────────────────────────────────
async function monitor(
  testCandidates: TestCandidate[],
  durationSecs: number,
): Promise<void> {
  console.log(`\n[5/5] Monitoring for ${durationSecs}s...`);
  console.log(
    "  (watching for keep-alive pings every 15s, checking connection health)\n",
  );

  const startTime = Date.now();
  let lastReport = 0;

  while (Date.now() - startTime < durationSecs * 1000) {
    await new Promise((r) => setTimeout(r, 1000));
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    // Report every 10 seconds
    if (elapsed - lastReport >= 10) {
      lastReport = elapsed;

      const stillConnected = testCandidates.filter(
        (tc) => tc.sseResponse && !tc.errors.length,
      );
      const withKeepAlive = testCandidates.filter(
        (tc) => tc.keepAliveCount > 0,
      );
      const totalKeepAlives = testCandidates.reduce(
        (s, tc) => s + tc.keepAliveCount,
        0,
      );
      const totalEvents = testCandidates.reduce(
        (s, tc) => s + tc.eventCount,
        0,
      );
      const errorCount = testCandidates.filter(
        (tc) => tc.errors.length > 0,
      ).length;

      // Check Redis keys
      const memUsage = process.memoryUsage();

      // Sample 10 candidates to check Redis keys
      const sample = testCandidates.slice(0, 10).map((tc) => tc.userId);
      let sessionLockCount = 0;
      let activeJtiCount = 0;
      const pipeline = redis.pipeline();
      for (const uid of sample) {
        pipeline.exists(`session:lock:${uid}`);
        pipeline.exists(`session:active_jti:${uid}`);
      }
      const results = await pipeline.exec();
      if (results) {
        for (let j = 0; j < results.length; j += 2) {
          if (results[j][1]) sessionLockCount++;
          if (results[j + 1][1]) activeJtiCount++;
        }
      }

      // Count attempt:active keys (note: redis.keys() doesn't add keyPrefix)
      const attemptKeys = await redis.keys("cbe:attempt:active:*");
      const attemptActiveCount = attemptKeys.length;

      console.log(
        `  [${elapsed}s] connected=${stillConnected.length}/${NUM_CANDIDATES}  ` +
          `keepAliveClients=${withKeepAlive.length}  totalKeepAlives=${totalKeepAlives}  ` +
          `events=${totalEvents}  errors=${errorCount}  ` +
          `heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}MB  ` +
          `redis[lock=${sessionLockCount}/10 jti=${activeJtiCount}/10 attemptActive=${attemptActiveCount}]`,
      );
    }
  }

  // Final report
  console.log("\n════════ FINAL REPORT ════════");
  const connected = testCandidates.filter((tc) => tc.sseResponse);
  const withKeepAlive = testCandidates.filter((tc) => tc.keepAliveCount > 0);
  const withErrors = testCandidates.filter((tc) => tc.errors.length > 0);
  const totalKeepAlives = testCandidates.reduce(
    (s, tc) => s + tc.keepAliveCount,
    0,
  );
  const totalEvents = testCandidates.reduce((s, tc) => s + tc.eventCount, 0);

  console.log(`  Candidates created:     ${NUM_CANDIDATES}`);
  console.log(
    `  SSE connected:          ${connected.length}/${NUM_CANDIDATES}`,
  );
  console.log(
    `  Received keep-alive:    ${withKeepAlive.length}/${NUM_CANDIDATES}`,
  );
  console.log(`  Total keep-alive pings: ${totalKeepAlives}`);
  console.log(`  Total SSE events:       ${totalEvents}`);
  console.log(`  Errors:                 ${withErrors.length}`);

  if (withErrors.length > 0 && withErrors.length <= 5) {
    console.log("\n  Error details:");
    for (const tc of withErrors) {
      console.log(`    ${tc.admitCard}: ${tc.errors.join(", ")}`);
    }
  }

  // Keep-alive distribution
  if (withKeepAlive.length > 0) {
    const kaCounts = withKeepAlive
      .map((tc) => tc.keepAliveCount)
      .sort((a, b) => a - b);
    console.log(`\n  Keep-alive distribution:`);
    console.log(
      `    min: ${kaCounts[0]}, max: ${kaCounts[kaCounts.length - 1]}, median: ${kaCounts[Math.floor(kaCounts.length / 2)]}`,
    );
  }
  console.log("══════════════════════════════\n");
}

// ─── Cleanup ────────────────────────────────────────────────────────
async function cleanup(testCandidates: TestCandidate[]): Promise<void> {
  console.log(
    "\n[Cleanup] Closing SSE connections and removing test candidates...",
  );

  // Close SSE connections
  for (const tc of testCandidates) {
    try {
      if (tc.sseResponse?.body) {
        await tc.sseResponse.body.cancel();
      }
    } catch {}
  }

  // Delete test candidates from DB
  const userIds = testCandidates.map((tc) => tc.userId);
  const candidateIds = testCandidates.map((tc) => tc.candidateId);

  // Delete attempts
  await db.delete(attempts).where(inArray(attempts.candidateId, candidateIds));
  // Delete exam batch assignments
  await db
    .delete(examBatchCandidates)
    .where(inArray(examBatchCandidates.candidateId, candidateIds));
  // Delete candidates
  await db.delete(candidates).where(inArray(candidates.id, candidateIds));
  // Delete session tokens (FK constraint)
  await db.delete(sessionTokens).where(inArray(sessionTokens.userId, userIds));
  // Delete device registrations (FK constraint)
  await db
    .delete(deviceRegistrations)
    .where(inArray(deviceRegistrations.registeredBy, userIds));
  // Delete users
  await db.delete(users).where(inArray(users.id, userIds));

  console.log(`  ✓ Cleaned up ${testCandidates.length} test candidates`);
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  SSE Load Test — 100 Candidate Connections               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Target: ${NUM_CANDIDATES} candidates`);
  console.log(`  Batch:  ${BATCH_ID}`);
  console.log(`  API:    ${API_BASE}`);
  console.log(`  SSE:    ${SSE_BASE}`);

  const testCandidates = await createTestCandidates();

  try {
    await loginCandidates(testCandidates);
    await startExams(testCandidates);
    await openSSEConnections(testCandidates);

    // Monitor for 60 seconds (4 keep-alive cycles)
    await monitor(testCandidates, 60);
  } finally {
    await cleanup(testCandidates);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
