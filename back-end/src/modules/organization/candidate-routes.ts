import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../../database/db.js";
import {
  batchCandidates,
  candidates,
  users,
} from "../../database/schemas/index.js";
import { requireRole } from "../../middleware/rbac.js";

/* ---------- Zod Schemas ---------- */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  batchId: z.string().uuid().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  institutionId: z.string().uuid().optional(),
});

const createCandidateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  dateOfBirth: z
    .string()
    .regex(/^\d{8}$/, "dateOfBirth must be in ddmmyyyy format"),
  batchId: z.string().uuid().optional().nullable(),
  institutionId: z.string().uuid().optional().nullable(),
  rollNumber: z.string().max(50).optional(),
  admitCardNumber: z.string().max(50).optional(),
  photoUrl: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
});

const updateCandidateSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  batchId: z.string().uuid().optional().nullable(),
  rollNumber: z.string().max(50).optional(),
  admitCardNumber: z.string().max(50).optional(),
  photoUrl: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{8}$/, "dateOfBirth must be in ddmmyyyy format")
    .optional(),
  isActive: z.boolean().optional(),
});

const bulkImportSchema = z.object({
  batchId: z.string().uuid().optional().nullable(),
  institutionId: z.string().uuid().optional().nullable(),
  candidates: z
    .array(
      z.object({
        email: z.string().email(),
        fullName: z.string().min(1).max(255),
        dateOfBirth: z
          .string()
          .regex(/^\d{8}$/, "dateOfBirth must be in ddmmyyyy format"),
        rollNumber: z.string().max(50).optional(),
        admitCardNumber: z.string().max(50).optional(),
        phone: z.string().max(20).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/* ---------- Route Plugin ---------- */

const candidateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("super_admin", "exam_admin"));

  /* ----- GET /candidates — list with pagination + filters ----- */
  app.get("/", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid query parameters" });

    const { page, pageSize, search, batchId, isActive, institutionId } =
      parsed.data;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (search && search.length >= 3) {
      conditions.push(
        or(
          ilike(
            sql`(${users.fullName} || ' ' || ${users.email})`,
            `%${search}%`,
          ),
          ilike(
            sql`(COALESCE(${candidates.rollNumber}, '') || ' ' || COALESCE(${candidates.admitCardNumber}, ''))`,
            `%${search}%`,
          ),
        ),
      );
    }
    if (batchId)
      conditions.push(
        inArray(
          candidates.id,
          db
            .select({ id: batchCandidates.candidateId })
            .from(batchCandidates)
            .where(eq(batchCandidates.batchId, batchId)),
        ),
      );
    if (isActive !== undefined)
      conditions.push(eq(candidates.isActive, isActive === "true"));
    if (institutionId)
      conditions.push(eq(candidates.institutionId, institutionId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: candidates.id,
          userId: candidates.userId,
          batchId: candidates.batchId,
          rollNumber: candidates.rollNumber,
          admitCardNumber: candidates.admitCardNumber,
          photoUrl: candidates.photoUrl,
          dateOfBirth: candidates.dateOfBirth,
          isActive: candidates.isActive,
          createdAt: candidates.createdAt,
          updatedAt: candidates.updatedAt,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          batchName: sql<
            string | null
          >`(SELECT string_agg(b.name, ', ') FROM batch_candidates bc JOIN batches b ON b.id = bc.batch_id WHERE bc.candidate_id = ${candidates.id})`,
        })
        .from(candidates)
        .innerJoin(users, eq(candidates.userId, users.id))
        .where(where)
        .orderBy(asc(candidates.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(candidates)
        .innerJoin(users, eq(candidates.userId, users.id))
        .where(where),
    ]);

    return reply.send({
      data: rows,
      total: countResult[0]?.count ?? 0,
      page,
      pageSize,
    });
  });

  /* ----- POST /candidates — create single candidate ----- */
  app.post("/", async (request, reply) => {
    const parsed = createCandidateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const {
      email,
      fullName,
      dateOfBirth,
      batchId,
      institutionId,
      rollNumber,
      admitCardNumber,
      photoUrl,
      phone,
    } = parsed.data;

    // Check for duplicate admit card number before inserting
    if (admitCardNumber) {
      const [existing] = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.admitCardNumber, admitCardNumber))
        .limit(1);
      if (existing)
        return reply.code(409).send({
          error: `Admit card number "${admitCardNumber}" is already assigned to another candidate`,
        });
    }

    // Password = DOB in ddmmyyyy format
    const { hash } = await import("@node-rs/argon2");
    const passwordHash = await hash(dateOfBirth);

    // Atomic insert with ON CONFLICT DO NOTHING — eliminates TOCTOU race condition
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          fullName,
          passwordHash,
          role: "candidate",
          phone: phone ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });

      if (!user) return null;

      const [candidate] = await tx
        .insert(candidates)
        .values({
          userId: user.id,
          batchId: batchId ?? null,
          institutionId: institutionId ?? null,
          rollNumber: rollNumber ?? null,
          admitCardNumber: admitCardNumber ?? null,
          photoUrl: photoUrl ?? null,
          dateOfBirth,
        })
        .returning();

      return candidate;
    });

    if (!result)
      return reply.code(409).send({ error: "Email already registered" });

    return reply.code(201).send(result);
  });

  /* ----- GET /candidates/:id — get details ----- */
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select({
        id: candidates.id,
        userId: candidates.userId,
        batchId: candidates.batchId,
        rollNumber: candidates.rollNumber,
        admitCardNumber: candidates.admitCardNumber,
        photoUrl: candidates.photoUrl,
        dateOfBirth: candidates.dateOfBirth,
        isActive: candidates.isActive,
        createdAt: candidates.createdAt,
        updatedAt: candidates.updatedAt,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        batchName: sql<
          string | null
        >`(SELECT string_agg(b.name, ', ') FROM batch_candidates bc JOIN batches b ON b.id = bc.batch_id WHERE bc.candidate_id = ${candidates.id})`,
      })
      .from(candidates)
      .innerJoin(users, eq(candidates.userId, users.id))
      .where(eq(candidates.id, id))
      .limit(1);

    if (!row) return reply.code(404).send({ error: "Candidate not found" });

    return reply.send(row);
  });

  /* ----- PUT /candidates/:id — update ----- */
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCandidateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const {
      fullName,
      batchId,
      rollNumber,
      admitCardNumber,
      photoUrl,
      phone,
      dateOfBirth,
      isActive,
    } = parsed.data;

    // Check for duplicate admit card number if it's being updated
    if (admitCardNumber !== undefined && admitCardNumber) {
      const [existing] = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(
          and(
            eq(candidates.admitCardNumber, admitCardNumber),
            sql`${candidates.id} != ${id}`,
          ),
        )
        .limit(1);
      if (existing)
        return reply.code(409).send({
          error: `Admit card number "${admitCardNumber}" is already assigned to another candidate`,
        });
    }

    // Single transaction: update candidate + user, then return joined result
    const row = await db.transaction(async (tx) => {
      // Update candidate
      const [updated] = await tx
        .update(candidates)
        .set({
          ...(batchId !== undefined ? { batchId: batchId ?? null } : {}),
          ...(rollNumber !== undefined ? { rollNumber } : {}),
          ...(admitCardNumber !== undefined ? { admitCardNumber } : {}),
          ...(photoUrl !== undefined ? { photoUrl } : {}),
          ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(candidates.id, id))
        .returning({ userId: candidates.userId });

      if (!updated) return null;

      // Update user fields if provided
      if (fullName !== undefined || phone !== undefined) {
        await tx
          .update(users)
          .set({
            ...(fullName !== undefined ? { fullName } : {}),
            ...(phone !== undefined ? { phone } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, updated.userId));
      }

      // Fetch joined view within same transaction (avoids separate query)
      const [result] = await tx
        .select({
          id: candidates.id,
          userId: candidates.userId,
          batchId: candidates.batchId,
          rollNumber: candidates.rollNumber,
          admitCardNumber: candidates.admitCardNumber,
          photoUrl: candidates.photoUrl,
          dateOfBirth: candidates.dateOfBirth,
          isActive: candidates.isActive,
          createdAt: candidates.createdAt,
          updatedAt: candidates.updatedAt,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          batchName: sql<
            string | null
          >`(SELECT string_agg(b.name, ', ') FROM batch_candidates bc JOIN batches b ON b.id = bc.batch_id WHERE bc.candidate_id = ${candidates.id})`,
        })
        .from(candidates)
        .innerJoin(users, eq(candidates.userId, users.id))
        .where(eq(candidates.id, id))
        .limit(1);

      return result;
    });

    if (!row) return reply.code(404).send({ error: "Candidate not found" });

    return reply.send(row);
  });

  /* ----- DELETE /candidates/:id — delete candidate with cascade ----- */
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await db.transaction(async (tx) => {
        // 1. Find the candidate to get userId
        const [candidate] = await tx
          .select({ userId: candidates.userId })
          .from(candidates)
          .where(eq(candidates.id, id))
          .limit(1);

        if (!candidate) throw new Error("Candidate not found");

        // 2. Delete attempt-dependent data for this candidate
        await tx.execute(
          sql`DELETE FROM answer_snapshots WHERE answer_id IN (SELECT a.id FROM answers a JOIN attempts at ON a.attempt_id = at.id WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM answers WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM event_logs WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM violation_reports WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM proctoring_events WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM scores WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM scorecards WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM certificates WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );
        await tx.execute(
          sql`DELETE FROM session_tokens WHERE attempt_id IN (SELECT at.id FROM attempts at WHERE at.candidate_id = ${id})`,
        );

        // 3. Delete attempts
        await tx.execute(sql`DELETE FROM attempts WHERE candidate_id = ${id}`);

        // 4. Delete exam_batch_candidates
        await tx.execute(
          sql`DELETE FROM exam_batch_candidates WHERE candidate_id = ${id}`,
        );

        // 5. Delete scorecards and certificates by candidate_id
        await tx.execute(
          sql`DELETE FROM scorecards WHERE candidate_id = ${id}`,
        );
        await tx.execute(
          sql`DELETE FROM certificates WHERE candidate_id = ${id}`,
        );

        // 6. Delete session_tokens and audit_logs for the user
        await tx.execute(
          sql`DELETE FROM session_tokens WHERE user_id = ${candidate.userId}`,
        );
        await tx.execute(
          sql`DELETE FROM audit_logs WHERE user_id = ${candidate.userId}`,
        );

        // 7. Delete the candidate
        await tx.delete(candidates).where(eq(candidates.id, id));

        // 8. Delete the user
        await tx.delete(users).where(eq(users.id, candidate.userId));
      });
    } catch (err) {
      if (err instanceof Error && err.message === "Candidate not found")
        return reply.code(404).send({ error: "Candidate not found" });
      throw err;
    }

    return reply.send({ message: "Candidate deleted successfully" });
  });

  /* ----- POST /candidates/bulk — bulk import ----- */
  app.post("/bulk", async (request, reply) => {
    const parsed = bulkImportSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const { batchId, institutionId, candidates: importRows } = parsed.data;

    // Deduplicate by email within the payload
    const seenEmails = new Set<string>();
    // Also check for duplicate admit card numbers within the payload
    const seenAdmitCards = new Set<string>();
    const duplicateAdmitCards: string[] = [];
    const uniqueRows = importRows.filter((r) => {
      const lower = r.email.toLowerCase();
      if (seenEmails.has(lower)) return false;
      seenEmails.add(lower);
      if (r.admitCardNumber) {
        if (seenAdmitCards.has(r.admitCardNumber)) {
          duplicateAdmitCards.push(r.admitCardNumber);
          return false;
        }
        seenAdmitCards.add(r.admitCardNumber);
      }
      return true;
    });

    if (duplicateAdmitCards.length > 0) {
      return reply.code(409).send({
        error: `Duplicate admit card numbers within the file: ${duplicateAdmitCards.join(", ")}`,
      });
    }

    // Check for admit card numbers that already exist in the database
    const admitCardNumbers = uniqueRows
      .map((r) => r.admitCardNumber)
      .filter((v): v is string => !!v);
    if (admitCardNumbers.length > 0) {
      const existingCandidates = await db
        .select({ admitCardNumber: candidates.admitCardNumber })
        .from(candidates)
        .where(inArray(candidates.admitCardNumber, admitCardNumbers));
      if (existingCandidates.length > 0) {
        const taken = existingCandidates
          .map((c) => c.admitCardNumber)
          .join(", ");
        return reply.code(409).send({
          error: `Admit card numbers already in use: ${taken}`,
        });
      }
    }

    // Hash each candidate's password (DOB) BEFORE transaction
    const { hash } = await import("@node-rs/argon2");
    const rowsWithHash = await Promise.all(
      uniqueRows.map(async (r) => ({
        ...r,
        passwordHash: await hash(r.dateOfBirth),
      })),
    );

    // Build lookup maps BEFORE transaction (avoid initialization order bugs)
    const emailToRow = new Map(
      uniqueRows.map((r) => [r.email.toLowerCase(), r]),
    );
    const emailToHash = new Map(
      rowsWithHash.map((r) => [r.email.toLowerCase(), r.passwordHash]),
    );

    // Atomic bulk insert with ON CONFLICT DO NOTHING — eliminates race conditions
    // No pre-check needed; PostgreSQL handles uniqueness atomically
    const result = await db.transaction(async (tx) => {
      // Batch insert users with ON CONFLICT DO NOTHING
      const createdUsers = await tx
        .insert(users)
        .values(
          uniqueRows.map((r) => ({
            email: r.email,
            fullName: r.fullName,
            passwordHash: emailToHash.get(r.email.toLowerCase())!,
            role: "candidate" as const,
            phone: r.phone ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: users.id, email: users.email });

      if (createdUsers.length === 0) {
        return { imported: 0, skipped: uniqueRows.length };
      }

      const candidateRows = createdUsers.map((u) => ({
        userId: u.id,
        batchId: batchId ?? null,
        institutionId: institutionId ?? null,
        rollNumber: emailToRow.get(u.email.toLowerCase())?.rollNumber ?? null,
        admitCardNumber:
          emailToRow.get(u.email.toLowerCase())?.admitCardNumber ?? null,
        dateOfBirth: emailToRow.get(u.email.toLowerCase())?.dateOfBirth ?? null,
      }));

      const createdCandidates = await tx
        .insert(candidates)
        .values(candidateRows)
        .returning({ id: candidates.id });

      return {
        imported: createdCandidates.length,
        skipped: uniqueRows.length - createdUsers.length,
      };
    });

    return reply.code(201).send({
      message: `${result.imported} candidate(s) imported`,
      imported: result.imported,
      skipped: result.skipped,
    });
  });

  /* ----- GET /candidates/template — download XLSX template ----- */
  app.get("/template", async (_request, reply) => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Candidates");

    ws.columns = [
      { header: "email", key: "email", width: 30 },
      { header: "fullName", key: "fullName", width: 25 },
      { header: "dateOfBirth", key: "dateOfBirth", width: 15 },
      { header: "rollNumber", key: "rollNumber", width: 15 },
      { header: "admitCardNumber", key: "admitCardNumber", width: 18 },
      { header: "phone", key: "phone", width: 15 },
    ];

    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    // No sample rows — user fills in their own data
    // dateOfBirth cells in column C should be entered as text to preserve leading zeros

    // Instructions sheet
    const instr = workbook.addWorksheet("Instructions");
    instr.getColumn(1).width = 25;
    instr.getColumn(2).width = 70;
    instr.addRow(["Field", "Description"]);
    instr.addRow(["email", "Valid email address (required). Must be unique."]);
    instr.addRow([
      "fullName",
      "Full name of the candidate (required, max 255 chars).",
    ]);
    instr.addRow([
      "dateOfBirth",
      "Date of birth in ddmmyyyy format, e.g. 05112000 for 5 Nov 2000 (required). Enter as text to preserve leading zeros.",
    ]);
    instr.addRow(["rollNumber", "Roll number (optional, max 50 chars)."]);
    instr.addRow([
      "admitCardNumber",
      "Admit card number (optional, max 50 chars).",
    ]);
    instr.addRow(["phone", "Phone number (optional, max 20 chars)."]);
    instr.addRow([]);
    instr.addRow(["Notes:"]);
    instr.addRow([
      "- dateOfBirth is used as the default password for the candidate.",
    ]);
    instr.addRow(["- Duplicate emails within the file will be skipped."]);
    instr.addRow([
      "- Already registered emails will be skipped (no overwrite).",
    ]);
    instr.addRow(["- Maximum 500 candidates per upload."]);
    instr.getRow(1).font = { bold: true };
    instr.getRow(9).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return reply
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "Content-Disposition",
        'attachment; filename="candidates_template.xlsx"',
      )
      .send(Buffer.from(buffer));
  });

  /* ----- POST /candidates/assign — assign candidates to a batch ----- */
  app.post("/assign", async (request, reply) => {
    const schema = z.object({
      batchId: z.string().uuid(),
      candidateIds: z.array(z.string().uuid()).min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid request body" });

    const { batchId: bId, candidateIds } = parsed.data;

    const inserted = await db
      .insert(batchCandidates)
      .values(candidateIds.map((cid) => ({ batchId: bId, candidateId: cid })))
      .onConflictDoNothing()
      .returning({ id: batchCandidates.id });

    return reply.code(201).send({
      message: `${inserted.length} candidate(s) assigned to batch`,
      assigned: inserted.length,
    });
  });

  /* ----- DELETE /candidates/remove-from-batch — remove candidate from batch ----- */
  app.delete("/remove-from-batch", async (request, reply) => {
    const schema = z.object({
      batchId: z.string().uuid(),
      candidateId: z.string().uuid(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid request body" });

    const { batchId: bId, candidateId } = parsed.data;

    await db
      .delete(batchCandidates)
      .where(
        and(
          eq(batchCandidates.batchId, bId),
          eq(batchCandidates.candidateId, candidateId),
        ),
      );

    return reply.send({ message: "Candidate removed from batch" });
  });
};

export default candidateRoutes;
