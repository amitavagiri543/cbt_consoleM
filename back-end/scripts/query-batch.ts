import { db } from "../src/database/db.js";
import {
  candidates,
  users,
  examBatches,
  examBatchCandidates,
  institutions,
} from "../src/database/schemas/index.js";
import { eq } from "drizzle-orm";

async function main() {
  // Get active batches
  const batches = await db
    .select({
      id: examBatches.id,
      status: examBatches.status,
      examId: examBatches.examId,
    })
    .from(examBatches)
    .where(eq(examBatches.status, "active"));

  console.log("Active batches:", JSON.stringify(batches, null, 2));

  // Get institution
  const insts = await db.select().from(institutions).limit(1);
  console.log("Institution:", JSON.stringify(insts, null, 2));

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
