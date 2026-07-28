import { db } from "../src/database/db.js";
import { candidates, users } from "../src/database/schemas/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      admitCard: candidates.admitCardNumber,
      dob: candidates.dateOfBirth,
      name: users.fullName,
      userId: users.id,
    })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(users.isActive, true));

  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
