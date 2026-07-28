import { and, desc, eq, inArray } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { db } from "../../database/db.js";
import { redis } from "../../database/redis.js";
import {
    attempts,
    candidates,
    deviceRegistrations,
    examBatchCandidates,
    examBatches,
    examQuestions,
    examSections,
    exams,
    institutions,
    questionOptions,
    questions,
    users,
} from "../../database/schemas/index.js";
import { requireRole } from "../../middleware/rbac.js";
import { verifySebBek } from "../../middleware/seb-verify.js";
import {
    cancelAutoSubmit,
    scheduleAutoSubmit,
} from "../../services/timer-scheduler.js";
import { seededShuffle } from "../../utils/shuffle.js";

/**
 * When an exam has no formal examSections (e.g. questions were imported
 * via Excel tabs which set sectionName on the questions table), derive
 * pseudo-sections from the distinct sectionName values in the subject's
 * questions. Returns sections in the same shape as examSections rows.
 */
async function getSectionNameBasedSections(
  examId: string,
  subjectId: string | null,
) {
  if (!subjectId) return [];
  const subjQuestions = await db
    .select({
      id: questions.id,
      sectionName: questions.sectionName,
      type: questions.type,
      contentJson: questions.contentJson,
      mediaUrlsJson: questions.mediaUrlsJson,
    })
    .from(questions)
    .where(eq(questions.subjectId, subjectId))
    .orderBy(desc(questions.createdAt));

  const sectionMap = new Map<string, typeof subjQuestions>();
  for (const q of subjQuestions) {
    const name = q.sectionName ?? "Unassigned";
    const arr = sectionMap.get(name) ?? [];
    arr.push(q);
    sectionMap.set(name, arr);
  }

  return [...sectionMap.entries()].map(([name, qs], idx) => ({
    id: `sectionname:${name}`,
    examId,
    name,
    sectionOrder: idx + 1,
    durationMinutes: null,
    questionCount: qs.length,
    totalMarks: String(qs.length),
    shuffleQuestions: false,
    shuffleOptions: false,
    navigationMode: null,
    instructionsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _questions: qs,
  }));
}

/**
 * When an exam has formal examSections but the questions within them have
 * distinct sectionName values (e.g. imported via Excel tabs), regroup the
 * sections by sectionName so the candidate sees the proper section-wise breakdown.
 * Returns the regrouped sections or null if no regrouping is needed.
 */
async function regroupSectionsBySectionName(
  examId: string,
  formalSections: any[],
): Promise<any[] | null> {
  if (formalSections.length === 0) return null;

  const sectionIds = formalSections.map((s) => s.id);
  const examQs = await db
    .select({
      examSectionId: examQuestions.examSectionId,
      questionId: examQuestions.questionId,
      sectionName: questions.sectionName,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(examQuestions.questionId, questions.id))
    .where(inArray(examQuestions.examSectionId, sectionIds));

  const distinctSectionNames = new Set(
    examQs.map((q) => q.sectionName).filter(Boolean),
  );

  // If only 0 or 1 distinct sectionName, no regrouping needed
  if (distinctSectionNames.size <= 1) return null;

  // Group questions by sectionName
  const sectionNameMap = new Map<string, number>();
  for (const q of examQs) {
    const name = q.sectionName ?? "Unassigned";
    sectionNameMap.set(name, (sectionNameMap.get(name) ?? 0) + 1);
  }

  return [...sectionNameMap.entries()].map(([name, count], idx) => ({
    id: `sectionname:${name}`,
    examId,
    name,
    sectionOrder: idx + 1,
    durationMinutes: null,
    questionCount: count,
    totalMarks: String(count),
    shuffleQuestions: false,
    shuffleOptions: false,
    navigationMode: null,
    instructionsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Candidate exam endpoints per API_SPECIFICATION.md Section 5.1.
 *
 * GET  /candidate/exams               — List assigned exams
 * GET  /candidate/exams/:batchId      — Get exam metadata
 * GET  /candidate/exams/:batchId/questions — Get exam questions
 * POST /candidate/exams/:batchId/start    — Start exam attempt
 * GET  /candidate/exams/:batchId/manifest — Get signed exam manifest
 */
const candidateExamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("candidate"));

  // ─── GET /candidate/exams — List assigned exams for the logged-in candidate ───
  app.get("/", async (request, _reply) => {
    const userId = request.user.sub;

    // Look up candidate record from user ID
    const [candidate] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.userId, userId))
      .limit(1);
    if (!candidate) return [];

    // Find all exam batches where this candidate is assigned
    const assignments = await db
      .select({
        examBatchId: examBatchCandidates.examBatchId,
        batchName: examBatches.name,
        batchStatus: examBatches.status,
        scheduledStartAt: examBatches.scheduledStartAt,
        scheduledEndAt: examBatches.scheduledEndAt,
        examId: examBatches.examId,
        examName: exams.name,
        examDuration: exams.durationMinutes,
        examTotalMarks: exams.totalMarks,
        examInstructions: exams.instructionsJson,
      })
      .from(examBatchCandidates)
      .innerJoin(
        examBatches,
        eq(examBatches.id, examBatchCandidates.examBatchId),
      )
      .innerJoin(exams, eq(exams.id, examBatches.examId))
      .where(
        and(
          eq(examBatchCandidates.candidateId, candidate.id),
          inArray(examBatches.status, ["active", "published"]),
        ),
      );

    const result = assignments.map((a) => ({
      examBatchId: a.examBatchId,
      examName: a.examName ?? a.batchName,
      durationMinutes: a.examDuration,
      totalMarks: a.examTotalMarks,
      status: a.batchStatus,
      scheduledAt: a.scheduledStartAt?.toISOString() ?? null,
      instructions: a.examInstructions ?? null,
    }));

    return result;
  });

  // ─── GET /candidate/exams/:batchId — Get exam metadata ────────────────────────
  app.get("/:batchId", async (request, reply) => {
    const { batchId } = request.params as { batchId: string };
    const userId = request.user.sub;

    // Look up candidate record from user ID (with name + institution admin contact)
    const [candidate] = await db
      .select({
        id: candidates.id,
        fullName: users.fullName,
        institutionId: users.institutionId,
        admitCardNumber: candidates.admitCardNumber,
      })
      .from(candidates)
      .innerJoin(users, eq(users.id, candidates.userId))
      .where(eq(candidates.userId, userId))
      .limit(1);
    if (!candidate)
      return reply.code(403).send({ error: "Candidate record not found" });

    // Fetch institution admin contact (if candidate belongs to an institution)
    let adminContact: {
      name: string | null;
      phone: string | null;
      email: string | null;
    } = {
      name: null,
      phone: null,
      email: null,
    };
    if (candidate.institutionId) {
      const [inst] = await db
        .select({
          name: institutions.name,
          phone: institutions.contactPhone,
          email: institutions.contactEmail,
        })
        .from(institutions)
        .where(eq(institutions.id, candidate.institutionId))
        .limit(1);
      if (inst) {
        adminContact = {
          name: inst.name,
          phone: inst.phone,
          email: inst.email,
        };
      }
    }

    // Verify candidate is assigned to this batch
    const [assignment] = await db
      .select()
      .from(examBatchCandidates)
      .where(
        and(
          eq(examBatchCandidates.examBatchId, batchId),
          eq(examBatchCandidates.candidateId, candidate.id),
        ),
      )
      .limit(1);

    if (!assignment) {
      return reply.code(403).send({ error: "Not assigned to this exam batch" });
    }

    const [batch] = await db
      .select({
        batchId: examBatches.id,
        batchStatus: examBatches.status,
        scheduledStartAt: examBatches.scheduledStartAt,
        examId: examBatches.examId,
        subjectId: exams.subjectId,
        examName: exams.name,
        examDuration: exams.durationMinutes,
        examTotalMarks: exams.totalMarks,
        examInstructions: exams.instructionsJson,
        examNavigation: exams.navigationMode,
      })
      .from(examBatches)
      .innerJoin(exams, eq(exams.id, examBatches.examId))
      .where(eq(examBatches.id, batchId))
      .limit(1);

    if (!batch) {
      return reply.code(404).send({ error: "Exam batch not found" });
    }

    // Get sections — fall back to sectionName-based pseudo-sections
    let metaSections = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, batch.examId))
      .orderBy(examSections.sectionOrder);
    if (metaSections.length === 0) {
      metaSections = (await getSectionNameBasedSections(
        batch.examId,
        batch.subjectId,
      )) as any;
    } else {
      // Check if questions within formal sections have distinct sectionName values
      const regrouped = await regroupSectionsBySectionName(
        batch.examId,
        metaSections,
      );
      if (regrouped) {
        metaSections = regrouped as any;
      }
    }

    // Check if the candidate already has an attempt for this batch
    const [existingAttempt] = await db
      .select({
        id: attempts.id,
        status: attempts.status,
        startedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
        remainingTimeSecs: attempts.remainingTimeSecs,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.examBatchId, batchId),
          eq(attempts.candidateId, candidate.id),
        ),
      )
      .limit(1);

    return {
      examBatchId: batch.batchId,
      examName: batch.examName,
      durationMinutes: batch.examDuration,
      totalMarks: batch.examTotalMarks,
      status: batch.batchStatus,
      scheduledAt: batch.scheduledStartAt?.toISOString() ?? null,
      instructions: batch.examInstructions,
      candidateName: candidate.fullName,
      admitCardNumber: candidate.admitCardNumber ?? "",
      adminContact,
      attemptStatus: existingAttempt?.status ?? null,
      attemptRemainingTimeSecs: existingAttempt?.remainingTimeSecs ?? null,
      attemptSubmittedAt: existingAttempt?.submittedAt?.toISOString() ?? null,
      sections: metaSections.map((s) => ({
        id: s.id,
        name: s.name,
        sectionOrder: s.sectionOrder,
        durationMinutes: s.durationMinutes,
        questionCount: s.questionCount,
        totalMarks: s.totalMarks,
      })),
    };
  });

  // ─── GET /candidate/exams/:batchId/questions — Get exam questions ─────────────
  app.get(
    "/:batchId/questions",
    { preHandler: verifySebBek },
    async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      const userId = request.user.sub;

      // Look up candidate record from user ID
      const [candidate] = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);
      if (!candidate)
        return reply.code(403).send({ error: "Candidate record not found" });

      // Verify assignment
      const [assignment] = await db
        .select()
        .from(examBatchCandidates)
        .where(
          and(
            eq(examBatchCandidates.examBatchId, batchId),
            eq(examBatchCandidates.candidateId, candidate.id),
          ),
        )
        .limit(1);

      if (!assignment) {
        return reply
          .code(403)
          .send({ error: "Not assigned to this exam batch" });
      }

      // Get exam ID and shuffle flags from batch
      const [batch] = await db
        .select({
          examId: examBatches.examId,
          status: examBatches.status,
          subjectId: exams.subjectId,
          shuffleQuestions: exams.shuffleQuestions,
          shuffleOptions: exams.shuffleOptions,
        })
        .from(examBatches)
        .innerJoin(exams, eq(exams.id, examBatches.examId))
        .where(eq(examBatches.id, batchId))
        .limit(1);

      if (!batch) {
        return reply.code(404).send({ error: "Exam batch not found" });
      }

      // Get the candidate's active attempt to use as shuffle seed
      const [attempt] = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(
          and(
            eq(attempts.examBatchId, batchId),
            eq(attempts.candidateId, candidate.id),
            inArray(attempts.status, ["not_started", "in_progress", "paused"]),
          ),
        )
        .limit(1);

      // Use attempt ID as seed (falls back to candidate ID if no attempt yet)
      const shuffleSeed = attempt?.id ?? candidate.id;

      // Get sections — fall back to sectionName-based pseudo-sections
      // when the exam has no formal examSections
      let sections = await db
        .select()
        .from(examSections)
        .where(eq(examSections.examId, batch.examId))
        .orderBy(examSections.sectionOrder);

      let examQs: {
        examSectionId: string;
        questionId: string;
        displayOrder: number;
        qType: string;
        qContent: unknown;
        qMediaUrls: unknown;
        qSectionName: string | null;
      }[];

      if (sections.length > 0) {
        const sectionIds = sections.map((s) => s.id);
        examQs = await db
          .select({
            examSectionId: examQuestions.examSectionId,
            questionId: examQuestions.questionId,
            displayOrder: examQuestions.displayOrder,
            qType: questions.type,
            qContent: questions.contentJson,
            qMediaUrls: questions.mediaUrlsJson,
            qSectionName: questions.sectionName,
          })
          .from(examQuestions)
          .innerJoin(questions, eq(examQuestions.questionId, questions.id))
          .where(inArray(examQuestions.examSectionId, sectionIds))
          .orderBy(examQuestions.displayOrder);

        // Check if questions within formal sections have distinct sectionName values.
        // If so, regroup by sectionName to show proper section-wise breakdown.
        const distinctSectionNames = new Set(
          examQs.map((q) => q.qSectionName).filter(Boolean),
        );
        if (distinctSectionNames.size > 1) {
          // Build pseudo-sections from sectionName, preserving formal section order
          const sectionNameMap = new Map<
            string,
            { questions: typeof examQs; formalSectionId: string }
          >();
          for (const q of examQs) {
            const name = q.qSectionName ?? "Unassigned";
            if (!sectionNameMap.has(name)) {
              sectionNameMap.set(name, {
                questions: [],
                formalSectionId: q.examSectionId,
              });
            }
            sectionNameMap.get(name)!.questions.push(q);
          }
          // Replace sections with sectionName-based ones
          sections = [...sectionNameMap.entries()].map(([name, data], idx) => ({
            id: `sectionname:${name}`,
            examId: batch.examId,
            name,
            sectionOrder: idx + 1,
            durationMinutes: null,
            questionCount: data.questions.length,
            totalMarks: String(data.questions.length),
            shuffleQuestions: false,
            shuffleOptions: false,
            navigationMode: null,
            instructionsJson: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })) as any;
          // Update examQs to use new pseudo-section IDs
          examQs = examQs.map((q) => ({
            ...q,
            examSectionId: `sectionname:${q.qSectionName ?? "Unassigned"}`,
          }));
        }
      } else {
        // No formal examSections — derive from sectionName on questions
        const pseudoSections = await getSectionNameBasedSections(
          batch.examId,
          batch.subjectId,
        );
        sections = pseudoSections as any;
        examQs = pseudoSections.flatMap((s: any) =>
          s._questions.map((q: any, idx: number) => ({
            examSectionId: s.id,
            questionId: q.id,
            displayOrder: idx + 1,
            qType: q.type,
            qContent: q.contentJson,
            qMediaUrls: q.mediaUrlsJson,
            qSectionName: q.sectionName ?? null,
          })),
        );
      }

      if (sections.length === 0) {
        return [];
      }

      // Get options (without isCorrect — never expose to candidate)
      const questionIds = examQs.map((q) => q.questionId);
      const optionsMap: Record<
        string,
        Array<{
          id: string;
          text: string;
          optionMediaUrl: string | null;
          displayOrder: number;
        }>
      > = {};

      if (questionIds.length > 0) {
        const opts = await db
          .select()
          .from(questionOptions)
          .where(inArray(questionOptions.questionId, questionIds))
          .orderBy(questionOptions.displayOrder);

        for (const opt of opts) {
          if (!optionsMap[opt.questionId]) {
            optionsMap[opt.questionId] = [];
          }
          optionsMap[opt.questionId].push({
            id: opt.id,
            text: opt.optionText,
            optionMediaUrl: opt.optionMediaUrl,
            displayOrder: opt.displayOrder,
          });
        }
      }

      // Apply shuffle if enabled — shuffle WITHIN each section only, never across sections
      let shuffledExamQs = examQs;
      if (batch.shuffleQuestions) {
        // Group questions by section, shuffle each group independently, then recombine in section order
        shuffledExamQs = [];
        for (const section of sections) {
          const sectionQuestions = examQs.filter(
            (q) => q.examSectionId === section.id,
          );
          if (sectionQuestions.length > 0) {
            const shuffled = seededShuffle(
              sectionQuestions,
              shuffleSeed + ":questions:" + section.id,
            );
            shuffledExamQs.push(...shuffled);
          }
        }
      }

      // Return in CLIENT_ARCHITECTURE.md Question model format
      return shuffledExamQs.map((q) => {
        const content =
          typeof q.qContent === "string" ? JSON.parse(q.qContent) : q.qContent;
        let questionOptions_list = optionsMap[q.questionId] ?? null;
        if (batch.shuffleOptions && questionOptions_list) {
          questionOptions_list = seededShuffle(
            questionOptions_list,
            shuffleSeed + ":options:" + q.questionId,
          );
        }
        return {
          id: q.questionId,
          sectionId: q.examSectionId,
          type: q.qType,
          displayOrder: q.displayOrder,
          content: {
            text: content?.text ?? "",
            latex: content?.latex ?? null,
            passageId: content?.passageId ?? null,
            imageUrl: content?.imageUrl ?? null,
            audioUrl: content?.audioUrl ?? null,
            videoUrl: content?.videoUrl ?? null,
          },
          options: questionOptions_list,
        };
      });
    },
  );

  // ─── POST /candidate/exams/:batchId/start — Start exam attempt ────────────────
  app.post(
    "/:batchId/start",
    { preHandler: verifySebBek },
    async (request, reply) => {
      const { batchId } = request.params as { batchId: string };
      const userId = request.user.sub;
      const body = (request.body as { deviceId?: string }) ?? {};

      // Look up candidate record from user ID
      const [candidate] = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.userId, userId))
        .limit(1);
      if (!candidate)
        return reply.code(403).send({ error: "Candidate record not found" });

      // Verify assignment
      const [assignment] = await db
        .select()
        .from(examBatchCandidates)
        .where(
          and(
            eq(examBatchCandidates.examBatchId, batchId),
            eq(examBatchCandidates.candidateId, candidate.id),
          ),
        )
        .limit(1);

      if (!assignment) {
        return reply
          .code(403)
          .send({ error: "Not assigned to this exam batch" });
      }

      // Look up the device registration UUID if deviceId string is provided
      let deviceUuid: string | null = null;
      if (body.deviceId) {
        const [device] = await db
          .select()
          .from(deviceRegistrations)
          .where(eq(deviceRegistrations.deviceId, body.deviceId))
          .limit(1);
        deviceUuid = device?.id ?? null;
      }

      // Get batch + exam info
      const [batch] = await db
        .select({
          batchId: examBatches.id,
          batchStatus: examBatches.status,
          examId: examBatches.examId,
          subjectId: exams.subjectId,
          examDuration: exams.durationMinutes,
        })
        .from(examBatches)
        .innerJoin(exams, eq(exams.id, examBatches.examId))
        .where(eq(examBatches.id, batchId))
        .limit(1);

      if (!batch) {
        return reply.code(404).send({ error: "Exam batch not found" });
      }

      if (batch.batchStatus !== "active") {
        return reply.code(423).send({ error: "Exam batch is not active" });
      }

      // Check for existing attempt
      const [existingAttempt] = await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.examBatchId, batchId),
            eq(attempts.candidateId, candidate.id),
          ),
        )
        .limit(1);

      if (existingAttempt) {
        if (
          existingAttempt.status === "submitted" ||
          existingAttempt.status === "auto_submitted"
        ) {
          return reply.code(409).send({ error: "Exam already submitted" });
        }

        // Resume existing attempt
        const durationSecs = (batch.examDuration ?? 180) * 60;

        // For paused attempts, remainingTimeSecs is already frozen in the DB
        // (set by autoPauseAttempt/pauseAttempt). For in_progress attempts,
        // calculate elapsed time since startedAt.
        let remaining: number;
        if (existingAttempt.status === "paused") {
          remaining = existingAttempt.remainingTimeSecs ?? durationSecs;
        } else {
          const elapsed = existingAttempt.startedAt
            ? Math.floor(
                (Date.now() - new Date(existingAttempt.startedAt).getTime()) /
                  1000,
              )
            : 0;
          remaining = Math.max(
            0,
            (existingAttempt.remainingTimeSecs ?? durationSecs) - elapsed,
          );
        }

        // Reschedule auto-submit with correct remaining time
        await cancelAutoSubmit(existingAttempt.id);
        const expiryMs = Date.now() + remaining * 1000;
        await scheduleAutoSubmit(existingAttempt.id, candidate.id, expiryMs);

        // Set active key with longer TTL (120s) to give SSE time to connect
        // under load. SSE will refresh it every 30s once connected.
        await redis.set(`attempt:active:${existingAttempt.id}`, "1", "EX", 120);

        // Get sections — fall back to sectionName-based pseudo-sections
        let resumeSections = await db
          .select()
          .from(examSections)
          .where(eq(examSections.examId, batch.examId))
          .orderBy(examSections.sectionOrder);
        if (resumeSections.length === 0) {
          resumeSections = (await getSectionNameBasedSections(
            batch.examId,
            batch.subjectId,
          )) as any;
        } else {
          const regrouped = await regroupSectionsBySectionName(
            batch.examId,
            resumeSections,
          );
          if (regrouped) {
            resumeSections = regrouped as any;
          }
        }

        return {
          attemptId: existingAttempt.id,
          examBatchId: batchId,
          status: existingAttempt.status,
          startedAt:
            existingAttempt.startedAt?.toISOString() ??
            new Date().toISOString(),
          durationSeconds: durationSecs,
          remainingTimeSeconds: remaining,
          lastQuestionId: existingAttempt.lastQuestionIdSeen ?? null,
          sections: resumeSections.map((s) => ({
            id: s.id,
            name: s.name,
            sectionOrder: s.sectionOrder,
            durationMinutes: s.durationMinutes,
            questionCount: s.questionCount,
            totalMarks: s.totalMarks,
          })),
        };
      }

      // Create new attempt
      const durationSecs = (batch.examDuration ?? 180) * 60;
      const now = new Date();

      const [newAttempt] = await db
        .insert(attempts)
        .values({
          examBatchId: batchId,
          candidateId: candidate.id,
          deviceId: deviceUuid ?? (null as any),
          status: "in_progress",
          startedAt: now,
          remainingTimeSecs: durationSecs,
        })
        .returning();

      // Schedule auto-submit in Redis ZSET at exact expiry time
      const expiryMs = now.getTime() + durationSecs * 1000;
      await scheduleAutoSubmit(newAttempt.id, candidate.id, expiryMs);

      // Set active key for disconnect detection (120s TTL to give SSE time
      // to connect under load, refreshed every 30s by SSE once connected)
      await redis.set(`attempt:active:${newAttempt.id}`, "1", "EX", 120);

      // Get sections — fall back to sectionName-based pseudo-sections
      let newSections = await db
        .select()
        .from(examSections)
        .where(eq(examSections.examId, batch.examId))
        .orderBy(examSections.sectionOrder);
      if (newSections.length === 0) {
        newSections = (await getSectionNameBasedSections(
          batch.examId,
          batch.subjectId,
        )) as any;
      } else {
        const regrouped = await regroupSectionsBySectionName(
          batch.examId,
          newSections,
        );
        if (regrouped) {
          newSections = regrouped as any;
        }
      }

      return {
        attemptId: newAttempt.id,
        examBatchId: batchId,
        status: "in_progress",
        startedAt: now.toISOString(),
        durationSeconds: durationSecs,
        remainingTimeSeconds: durationSecs,
        sections: newSections.map((s) => ({
          id: s.id,
          name: s.name,
          sectionOrder: s.sectionOrder,
          durationMinutes: s.durationMinutes,
          questionCount: s.questionCount,
          totalMarks: s.totalMarks,
        })),
      };
    },
  );

  // ─── GET /candidate/exams/:batchId/manifest — Signed exam manifest ────────────
  // Per SECURITY_ARCHITECTURE.md Section 17.3
  // Note: In production, this would serve a pre-signed manifest.
  // For now, returns the manifest structure (signing deferred until Ed25519 keys are generated).
  app.get("/:batchId/manifest", async (request, reply) => {
    const { batchId } = request.params as { batchId: string };

    // Get batch + exam info
    const [batch] = await db
      .select({
        batchId: examBatches.id,
        batchStatus: examBatches.status,
        examId: examBatches.examId,
        subjectId: exams.subjectId,
        scheduledEnd: examBatches.scheduledEndAt,
        examName: exams.name,
        examDuration: exams.durationMinutes,
        examNavigation: exams.navigationMode,
        examShuffle: exams.shuffleQuestions,
        examShuffleOpts: exams.shuffleOptions,
      })
      .from(examBatches)
      .innerJoin(exams, eq(exams.id, examBatches.examId))
      .where(eq(examBatches.id, batchId))
      .limit(1);

    if (!batch) {
      return reply.code(404).send({ error: "Exam batch not found" });
    }

    // Get sections — fall back to sectionName-based pseudo-sections
    let manifestSections = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, batch.examId))
      .orderBy(examSections.sectionOrder);
    if (manifestSections.length === 0) {
      manifestSections = (await getSectionNameBasedSections(
        batch.examId,
        batch.subjectId,
      )) as any;
    } else {
      const regrouped = await regroupSectionsBySectionName(
        batch.examId,
        manifestSections,
      );
      if (regrouped) {
        manifestSections = regrouped as any;
      }
    }

    const manifest = {
      manifestId: `manifest-${batchId}`,
      examId: batch.examId,
      examBatchId: batchId,
      version: 1,
      issuedAt: new Date().toISOString(),
      expiresAt:
        batch.scheduledEnd?.toISOString() ??
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      exam: {
        title: batch.examName,
        durationMinutes: batch.examDuration,
        sections: manifestSections.map((s) => ({
          id: s.id,
          name: s.name,
          durationMinutes: s.durationMinutes,
          questionCount: s.questionCount,
        })),
        markingScheme: { correct: 4, incorrect: -1, unattempted: 0 },
        navigationMode: batch.examNavigation ?? "free",
        shuffleQuestions: batch.examShuffle ?? false,
        shuffleOptions: batch.examShuffleOpts ?? false,
      },
      server: {
        endpoint: `http://${request.hostname}`,
        certificateFingerprint: "",
      },
    };

    // TODO: In production, sign manifest with Ed25519 private key
    // For now, return unsigned manifest (client will need to skip signature verification in dev mode)
    return {
      manifest,
      signature: "", // Unsigned — for development only
    };
  });
};

export default candidateExamRoutes;
