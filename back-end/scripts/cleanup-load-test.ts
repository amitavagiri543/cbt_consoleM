/**
 * Cleanup: Remove any leftover LOAD*** test candidates from the DB.
 */
import { inArray, like } from "drizzle-orm";
import { db } from "../src/database/db.js";
import {
    attempts,
    candidates,
    deviceRegistrations,
    examBatchCandidates,
    sessionTokens,
    users,
} from "../src/database/schemas/index.js";

async function main() {
  // Find test users by email pattern
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "loadtest%@test.local"));

  if (testUsers.length === 0) {
    console.log("No test candidates found.");
    process.exit(0);
  }

  const userIds = testUsers.map((u) => u.id);
  console.log(`Found ${userIds.length} test users to clean up.`);

  // Find candidates
  const testCandidates = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(inArray(candidates.userId, userIds));

  const candidateIds = testCandidates.map((c) => c.id);

  if (candidateIds.length > 0) {
    await db
      .delete(attempts)
      .where(inArray(attempts.candidateId, candidateIds));
    await db
      .delete(examBatchCandidates)
      .where(inArray(examBatchCandidates.candidateId, candidateIds));
    await db.delete(candidates).where(inArray(candidates.id, candidateIds));
  }

  // Delete session tokens (FK constraint)
  await db.delete(sessionTokens).where(inArray(sessionTokens.userId, userIds));
  // Delete device registrations (FK constraint)
  await db
    .delete(deviceRegistrations)
    .where(inArray(deviceRegistrations.registeredBy, userIds));

  await db.delete(users).where(inArray(users.id, userIds));
  console.log(`Cleaned up ${userIds.length} test users.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
