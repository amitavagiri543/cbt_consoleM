import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import ExcelJS from "exceljs";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../../database/db.js";
import { proctoringConfigs } from "../../database/schemas/config.js";
import {
    attempts,
    batches,
    examBatchCandidates,
    examBatches,
    examQuestions,
    exams,
    examSections,
    institutions,
    questionOptions,
    questions,
    questionVersions,
    subjects,
} from "../../database/schemas/index.js";
import { analyticsSnapshots } from "../../database/schemas/results.js";
import { requireRole } from "../../middleware/rbac.js";

/* ---------- Schemas ---------- */

const createExamSchema = z.object({
  subjectId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  description: z.string().optional().nullable(),
  durationMinutes: z.number().int().min(1),
  totalMarks: z.coerce.number().min(0).transform(String),
  selectionStrategy: z.enum(["static", "random", "hybrid"]).default("static"),
  navigationMode: z.enum(["free", "linear", "section_free"]).default("free"),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  instructions: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      rules: z.array(z.string()).optional(),
    })
    .optional()
    .nullable(),
  resultVisibility: z.string().max(20).default("delayed"),
  scheduledStartAt: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : v)),
});

const updateExamSchema = createExamSchema.partial();

const createSectionSchema = z.object({
  name: z.string().min(1).max(255),
  sectionOrder: z.number().int().min(1),
  durationMinutes: z.number().int().min(1).optional().nullable(),
  totalMarks: z.coerce.number().min(0).transform(String),
  questionCount: z.number().int().min(1),
  navigationMode: z
    .enum(["free", "linear", "section_free"])
    .optional()
    .nullable(),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  instructions: z.record(z.unknown()).optional().nullable(),
});

const updateSectionSchema = createSectionSchema.partial();

const addExamQuestionsSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1),
  isOptional: z.boolean().default(false),
});

const updateExamQuestionSchema = z.object({
  isOptional: z.boolean().optional(),
  displayOrder: z.number().int().min(1).optional(),
});

/* ---------- Route Plugin ---------- */

const examRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("super_admin", "exam_admin"));

  /* ----- GET /exams — list with pagination ----- */
  app.get("/", async (request, reply) => {
    const query = request.query as {
      page?: string;
      pageSize?: string;
      search?: string;
      subjectId?: string;
      institutionId?: string;
      batchId?: string;
    };
    const page = Math.max(1, parseInt(query.page ?? "1"));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(query.pageSize ?? "20")),
    );
    const search = query.search?.trim();

    const conditions = [];
    if (search && search.length >= 3) {
      conditions.push(ilike(exams.name, `%${search}%`));
    }
    if (query.subjectId) {
      conditions.push(eq(exams.subjectId, query.subjectId));
    }
    if (query.institutionId) {
      conditions.push(eq(subjects.institutionId, query.institutionId));
    }
    if (query.batchId) {
      conditions.push(eq(exams.batchId, query.batchId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: exams.id,
          subjectId: exams.subjectId,
          batchId: exams.batchId,
          name: exams.name,
          description: exams.description,
          code: exams.code,
          durationMinutes: exams.durationMinutes,
          totalMarks: exams.totalMarks,
          selectionStrategy: exams.selectionStrategy,
          navigationMode: exams.navigationMode,
          shuffleQuestions: exams.shuffleQuestions,
          shuffleOptions: exams.shuffleOptions,
          instructionsJson: exams.instructionsJson,
          resultVisibility: exams.resultVisibility,
          scheduledStartAt: exams.scheduledStartAt,
          isActive: exams.isActive,
          createdBy: exams.createdBy,
          createdAt: exams.createdAt,
          updatedAt: exams.updatedAt,
          subjectName: subjects.name,
          batchName: batches.name,
        })
        .from(exams)
        .leftJoin(subjects, eq(exams.subjectId, subjects.id))
        .leftJoin(batches, eq(exams.batchId, batches.id))
        .where(where)
        .orderBy(desc(exams.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(exams)
        .leftJoin(subjects, eq(exams.subjectId, subjects.id))
        .leftJoin(batches, eq(exams.batchId, batches.id))
        .where(where),
    ]);

    return reply.send({
      data: rows,
      total: countResult[0]?.count ?? 0,
      page,
      pageSize,
    });
  });

  /* ----- POST /exams — create exam ----- */
  app.post("/", async (request, reply) => {
    const parsed = createExamSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const { instructions, subjectId, ...examFields } = parsed.data;

    // If subjectId is provided, fetch questions for that subject
    let subjectQuestions: {
      id: string;
    }[] = [];
    if (subjectId) {
      subjectQuestions = await db
        .select({
          id: questions.id,
        })
        .from(questions)
        .where(eq(questions.subjectId, subjectId));

      if (subjectQuestions.length === 0) {
        return reply.code(400).send({
          error:
            "Cannot create exam: the selected subject has no questions. Add questions to the subject first.",
        });
      }
    }

    const [exam] = await db
      .insert(exams)
      .values({
        ...examFields,
        subjectId: subjectId ?? null,
        instructionsJson: (instructions as Record<string, unknown>) ?? null,
        createdBy: request.user.sub,
      } as typeof exams.$inferInsert)
      .returning();

    // Auto-create a section and add all subject questions
    if (subjectId && subjectQuestions.length > 0) {
      const totalMarks = subjectQuestions.length;

      const [section] = await db
        .insert(examSections)
        .values({
          examId: exam.id,
          name: "Section 1",
          sectionOrder: 1,
          totalMarks: String(totalMarks),
          questionCount: subjectQuestions.length,
        } as typeof examSections.$inferInsert)
        .returning();

      const questionValues = subjectQuestions.map((q, idx) => ({
        examSectionId: section.id,
        questionId: q.id,
        displayOrder: idx + 1,
        isOptional: false,
      }));

      await db.insert(examQuestions).values(questionValues);
    }

    return reply.code(201).send(exam);
  });

  /* ----- GET /exams/:id — get exam with sections ----- */
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const batchInst = alias(institutions, "batch_inst");
    const subjInst = alias(institutions, "subj_inst");

    const [exam] = await db
      .select({
        id: exams.id,
        subjectId: exams.subjectId,
        batchId: exams.batchId,
        name: exams.name,
        description: exams.description,
        code: exams.code,
        durationMinutes: exams.durationMinutes,
        totalMarks: exams.totalMarks,
        selectionStrategy: exams.selectionStrategy,
        navigationMode: exams.navigationMode,
        shuffleQuestions: exams.shuffleQuestions,
        shuffleOptions: exams.shuffleOptions,
        instructionsJson: exams.instructionsJson,
        resultVisibility: exams.resultVisibility,
        scheduledStartAt: exams.scheduledStartAt,
        isActive: exams.isActive,
        createdBy: exams.createdBy,
        createdAt: exams.createdAt,
        updatedAt: exams.updatedAt,
        subjectName: subjects.name,
        batchName: batches.name,
        institutionName: sql<string>`COALESCE(${batchInst.name}, ${subjInst.name})`,
        institutionId: sql<string>`COALESCE(${batchInst.id}, ${subjInst.id})`,
      })
      .from(exams)
      .leftJoin(subjects, eq(exams.subjectId, subjects.id))
      .leftJoin(batches, eq(exams.batchId, batches.id))
      .leftJoin(batchInst, eq(batches.institutionId, batchInst.id))
      .leftJoin(subjInst, eq(subjects.institutionId, subjInst.id))
      .where(eq(exams.id, id));
    if (!exam) return reply.code(404).send({ error: "Exam not found" });

    const sections = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, id))
      .orderBy(asc(examSections.sectionOrder));

    // Fetch question counts per section in one query
    const sectionIds = sections.map((s) => s.id);
    let sectionQuestions: {
      id: string;
      examSectionId: string;
      questionId: string;
      displayOrder: number;
      isOptional: boolean;
      type: string;
      contentJson: unknown;
      options?: {
        optionText: string;
        isCorrect: boolean;
        displayOrder: number;
      }[];
    }[] = [];
    if (sectionIds.length > 0) {
      sectionQuestions = await db
        .select({
          id: examQuestions.id,
          examSectionId: examQuestions.examSectionId,
          questionId: examQuestions.questionId,
          displayOrder: examQuestions.displayOrder,
          isOptional: examQuestions.isOptional,
          type: questions.type,
          contentJson: questions.contentJson,
        })
        .from(examQuestions)
        .innerJoin(questions, eq(examQuestions.questionId, questions.id))
        .where(inArray(examQuestions.examSectionId, sectionIds))
        .orderBy(asc(examQuestions.displayOrder));

      // Fetch options for all questions in one query
      const questionIds = sectionQuestions.map((q) => q.questionId);
      if (questionIds.length > 0) {
        const allOptions = await db
          .select({
            questionId: questionOptions.questionId,
            optionText: questionOptions.optionText,
            isCorrect: questionOptions.isCorrect,
            displayOrder: questionOptions.displayOrder,
          })
          .from(questionOptions)
          .where(
            sql`${questionOptions.questionId} = ANY(${sql.raw(`ARRAY['${questionIds.join("','")}']::uuid[]`)})`,
          )
          .orderBy(asc(questionOptions.displayOrder));

        const optionsMap = new Map<string, typeof allOptions>();
        for (const opt of allOptions) {
          const arr = optionsMap.get(opt.questionId) ?? [];
          arr.push(opt);
          optionsMap.set(opt.questionId, arr);
        }
        sectionQuestions = sectionQuestions.map((q) => ({
          ...q,
          options: optionsMap.get(q.questionId) ?? [],
        }));
      }
    }

    const sectionsWithQuestions = sections.map((s) => ({
      ...s,
      questions: sectionQuestions.filter((q) => q.examSectionId === s.id),
    }));

    // Also fetch subject questions grouped by sectionName (Excel tab names)
    // so the exam detail page can show them even without formal exam sections
    let subjectQuestionGroups: {
      name: string;
      questions: {
        id: string;
        type: string;
        contentJson: unknown;
        options?: {
          optionText: string;
          isCorrect: boolean;
          displayOrder: number;
        }[];
      }[];
    }[] = [];
    let unassignedSubjectQuestions: (typeof subjectQuestionGroups)[number]["questions"] =
      [];

    if (exam.subjectId) {
      const subjQuestions = await db
        .select({
          id: questions.id,
          type: questions.type,
          contentJson: questions.contentJson,
          sectionName: questions.sectionName,
        })
        .from(questions)
        .where(eq(questions.subjectId, exam.subjectId))
        .orderBy(desc(questions.createdAt));

      if (subjQuestions.length > 0) {
        const subjQuestionIds = subjQuestions.map((q) => q.id);
        const subjOptions = await db
          .select({
            questionId: questionOptions.questionId,
            optionText: questionOptions.optionText,
            isCorrect: questionOptions.isCorrect,
            displayOrder: questionOptions.displayOrder,
          })
          .from(questionOptions)
          .where(
            sql`${questionOptions.questionId} = ANY(${sql.raw(`ARRAY['${subjQuestionIds.join("','")}']::uuid[]`)})`,
          )
          .orderBy(asc(questionOptions.displayOrder));

        const subjOptionsMap = new Map<string, typeof subjOptions>();
        for (const opt of subjOptions) {
          const arr = subjOptionsMap.get(opt.questionId) ?? [];
          arr.push(opt);
          subjOptionsMap.set(opt.questionId, arr);
        }

        const sectionMap = new Map<
          string,
          (typeof subjectQuestionGroups)[number]["questions"]
        >();
        for (const q of subjQuestions) {
          const enriched = {
            id: q.id,
            type: q.type,
            contentJson: q.contentJson,
            options: subjOptionsMap.get(q.id) ?? [],
          };
          if (q.sectionName) {
            const arr = sectionMap.get(q.sectionName) ?? [];
            arr.push(enriched);
            sectionMap.set(q.sectionName, arr);
          } else {
            unassignedSubjectQuestions.push(enriched);
          }
        }

        subjectQuestionGroups = [...sectionMap.entries()].map(([name, qs]) => ({
          name,
          questions: qs,
        }));
      }
    }

    return reply.send({
      ...exam,
      sections: sectionsWithQuestions,
      subjectQuestionGroups,
      unassignedSubjectQuestions,
    });
  });

  /* ----- PUT /exams/:id — update exam ----- */
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateExamSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const { instructions, ...examFields } = parsed.data;

    const [updated] = await db
      .update(exams)
      .set({
        ...examFields,
        ...(instructions !== undefined
          ? { instructionsJson: instructions as Record<string, unknown> | null }
          : {}),
        updatedAt: new Date(),
      } as Partial<typeof exams.$inferInsert>)
      .where(eq(exams.id, id))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Exam not found" });
    return reply.send(updated);
  });

  /* ----- DELETE /exams/:id — deactivate exam ----- */
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [updated] = await db
      .update(exams)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(exams.id, id))
      .returning({ id: exams.id });

    if (!updated) return reply.code(404).send({ error: "Exam not found" });
    return reply.send({ message: "Exam deactivated" });
  });

  /* ----- DELETE /exams/:id/permanent — permanently delete exam ----- */
  app.delete("/:id/permanent", async (request, reply) => {
    const { id } = request.params as { id: string };

    // Get all exam batch IDs for this exam
    const batchIds = await db
      .select({ id: examBatches.id, status: examBatches.status })
      .from(examBatches)
      .where(eq(examBatches.examId, id));
    const batchIdList = batchIds.map((b) => b.id);

    // Prevent deletion if any batch is active or published
    const hasRunning = batchIds.some(
      (b) => b.status === "active" || b.status === "published",
    );
    if (hasRunning) {
      return reply.code(409).send({
        error:
          "Cannot delete an exam with an ongoing batch. Stop the exam first.",
      });
    }

    // Get all exam section IDs for this exam
    const sectionIds = await db
      .select({ id: examSections.id })
      .from(examSections)
      .where(eq(examSections.examId, id));
    const sectionIdList = sectionIds.map((s) => s.id);

    // Delete in correct FK order
    if (sectionIdList.length > 0) {
      await db
        .delete(examQuestions)
        .where(inArray(examQuestions.examSectionId, sectionIdList));
    }
    await db.delete(examSections).where(eq(examSections.examId, id));

    if (batchIdList.length > 0) {
      await db
        .delete(analyticsSnapshots)
        .where(inArray(analyticsSnapshots.examBatchId, batchIdList));
      await db
        .delete(attempts)
        .where(inArray(attempts.examBatchId, batchIdList));
      await db
        .delete(proctoringConfigs)
        .where(inArray(proctoringConfigs.examBatchId, batchIdList));
      await db
        .delete(examBatchCandidates)
        .where(inArray(examBatchCandidates.examBatchId, batchIdList));
      await db.delete(examBatches).where(inArray(examBatches.id, batchIdList));
    }

    const [deleted] = await db
      .delete(exams)
      .where(eq(exams.id, id))
      .returning({ id: exams.id });

    if (!deleted) return reply.code(404).send({ error: "Exam not found" });
    return reply.send({ message: "Exam permanently deleted" });
  });

  /* ----- POST /exams/:id/sections — add section ----- */
  app.post("/:id/sections", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createSectionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const [exam] = await db
      .select({ id: exams.id })
      .from(exams)
      .where(eq(exams.id, id));
    if (!exam) return reply.code(404).send({ error: "Exam not found" });

    const [section] = await db
      .insert(examSections)
      .values({
        ...parsed.data,
        examId: id,
        instructionsJson:
          (parsed.data.instructions as Record<string, unknown>) ?? null,
      } as typeof examSections.$inferInsert)
      .returning();

    return reply.code(201).send(section);
  });

  /* ----- PUT /exams/:id/sections/:sectionId — update section ----- */
  app.put("/:id/sections/:sectionId", async (request, reply) => {
    const { id, sectionId } = request.params as {
      id: string;
      sectionId: string;
    };
    const parsed = updateSectionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    const { instructions, ...sectionFields } = parsed.data;

    const [updated] = await db
      .update(examSections)
      .set({
        ...sectionFields,
        ...(instructions !== undefined
          ? { instructionsJson: instructions as Record<string, unknown> | null }
          : {}),
        updatedAt: new Date(),
      } as Partial<typeof examSections.$inferInsert>)
      .where(and(eq(examSections.id, sectionId), eq(examSections.examId, id)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Section not found" });
    return reply.send(updated);
  });

  /* ----- DELETE /exams/:id/sections/:sectionId — remove section ----- */
  app.delete("/:id/sections/:sectionId", async (request, reply) => {
    const { id, sectionId } = request.params as {
      id: string;
      sectionId: string;
    };

    // Transaction: delete child questions + section atomically
    const result = await db.transaction(async (tx) => {
      await tx
        .delete(examQuestions)
        .where(eq(examQuestions.examSectionId, sectionId));

      const [deleted] = await tx
        .delete(examSections)
        .where(and(eq(examSections.id, sectionId), eq(examSections.examId, id)))
        .returning({ id: examSections.id });

      return deleted;
    });

    if (!result) return reply.code(404).send({ error: "Section not found" });
    return reply.send({ message: "Section removed" });
  });

  /* ----- POST /exams/:id/sections/:sectionId/questions — add questions ----- */
  app.post("/:id/sections/:sectionId/questions", async (request, reply) => {
    const { id, sectionId } = request.params as {
      id: string;
      sectionId: string;
    };
    const parsed = addExamQuestionsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });

    // Parallel: verify section exists, validate question IDs, get max display order
    const [section, validQuestions, maxRow] = await Promise.all([
      db
        .select({ id: examSections.id })
        .from(examSections)
        .where(and(eq(examSections.id, sectionId), eq(examSections.examId, id)))
        .limit(1),
      db
        .select({ id: questions.id })
        .from(questions)
        .where(inArray(questions.id, parsed.data.questionIds)),
      db
        .select({
          maxOrder: sql<number>`COALESCE(MAX(${examQuestions.displayOrder}), 0)`,
        })
        .from(examQuestions)
        .where(eq(examQuestions.examSectionId, sectionId)),
    ]);

    if (!section.length)
      return reply.code(404).send({ error: "Section not found" });

    if (validQuestions.length !== parsed.data.questionIds.length)
      return reply.code(400).send({ error: "Some question IDs are invalid" });

    let nextOrder = (maxRow[0]?.maxOrder ?? 0) + 1;

    const values = parsed.data.questionIds.map((questionId) => ({
      examSectionId: sectionId,
      questionId,
      displayOrder: nextOrder++,
      isOptional: parsed.data.isOptional,
    }));

    await db.insert(examQuestions).values(values);

    return reply.code(201).send({
      message: `${values.length} question(s) added`,
      added: values.length,
    });
  });

  /* ----- PUT /exams/:id/sections/:sectionId/questions/:eqId — update exam question ----- */
  app.put(
    "/:id/sections/:sectionId/questions/:eqId",
    async (request, reply) => {
      const { sectionId, eqId } = request.params as {
        id: string;
        sectionId: string;
        eqId: string;
      };
      const parsed = updateExamQuestionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        });

      const updateFields: Record<string, unknown> = {};
      if (parsed.data.isOptional !== undefined)
        updateFields.isOptional = parsed.data.isOptional;
      if (parsed.data.displayOrder !== undefined)
        updateFields.displayOrder = parsed.data.displayOrder;

      const [updated] = await db
        .update(examQuestions)
        .set(updateFields)
        .where(
          and(
            eq(examQuestions.id, eqId),
            eq(examQuestions.examSectionId, sectionId),
          ),
        )
        .returning();

      if (!updated)
        return reply.code(404).send({ error: "Exam question not found" });
      return reply.send(updated);
    },
  );

  /* ----- DELETE /exams/:id/sections/:sectionId/questions/:eqId — remove question ----- */
  app.delete(
    "/:id/sections/:sectionId/questions/:eqId",
    async (request, reply) => {
      const { sectionId, eqId } = request.params as {
        id: string;
        sectionId: string;
        eqId: string;
      };

      const [deleted] = await db
        .delete(examQuestions)
        .where(
          and(
            eq(examQuestions.id, eqId),
            eq(examQuestions.examSectionId, sectionId),
          ),
        )
        .returning();

      if (!deleted)
        return reply.code(404).send({ error: "Exam question not found" });
      return reply.send({ message: "Question removed from section" });
    },
  );

  /* ----- GET /exams/section-template — download multi-tab Excel template ----- */
  app.get(
    "/section-template",
    { preHandler: requireRole("super_admin", "exam_admin", "question_author") },
    async (request, reply) => {
      const query = (request.query as { sections?: string }) ?? {};
      const sectionNames = query.sections
        ? query.sections
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : ["Section 1", "Section 2"];

      const workbook = new ExcelJS.Workbook();

      const columns = [
        { header: "Question Text", key: "questionText", width: 60 },
        { header: "Type", key: "type", width: 18 },
        { header: "Option 1", key: "opt1", width: 30 },
        { header: "Option 2", key: "opt2", width: 30 },
        { header: "Option 3", key: "opt3", width: 30 },
        { header: "Option 4", key: "opt4", width: 30 },
        { header: "Option 5", key: "opt5", width: 30 },
        { header: "Option 6", key: "opt6", width: 30 },
        { header: "Correct Options", key: "correctOpts", width: 18 },
        { header: "Solution (optional)", key: "solution", width: 40 },
        { header: "Explanation (optional)", key: "explanation", width: 40 },
        {
          header: "Question Image (optional)",
          key: "questionImage",
          width: 25,
        },
      ];

      for (const sectionName of sectionNames) {
        const ws = workbook.addWorksheet(sectionName);
        ws.columns = columns;
        ws.getRow(1).font = { bold: true };

        // Example row
        ws.addRow({
          questionText: "What is the capital of France?",
          type: "mcq_single",
          opt1: "London",
          opt2: "Paris",
          opt3: "Berlin",
          opt4: "Madrid",
          opt5: "",
          opt6: "",
          correctOpts: "2",
          solution: "Paris",
          explanation: "Paris has been the capital of France since 987 AD.",
          questionImage: "",
        });

        // Example for mcq_multiple
        ws.addRow({
          questionText: "Which of the following are prime numbers?",
          type: "mcq_multiple",
          opt1: "2",
          opt2: "4",
          opt3: "7",
          opt4: "9",
          opt5: "",
          opt6: "",
          correctOpts: "1,3",
          solution: "",
          explanation: "2 and 7 are prime numbers. 4 = 2x2, 9 = 3x3.",
          questionImage: "",
        });
      }

      // Instructions tab
      const instr = workbook.addWorksheet("Instructions");
      instr.getColumn(1).width = 30;
      instr.getColumn(2).width = 70;
      instr.addRow(["Field", "Description"]);
      instr.addRow([
        "Tab Name",
        "Each tab name becomes a SECTION name in the exam",
      ]);
      instr.addRow(["Question Text", "The question text (required)"]);
      instr.addRow([
        "Type",
        "mcq_single, mcq_multiple, or true_false (default: mcq_single)",
      ]);
      instr.addRow([
        "Option 1-6",
        "Text for each option (min 2 required for MCQ)",
      ]);
      instr.addRow([
        "Correct Options",
        "Comma-separated option numbers (e.g. 2 or 1,3) or 'all'",
      ]);
      instr.addRow(["Solution", "Short solution text (optional)"]);
      instr.addRow(["Explanation", "Detailed explanation (optional)"]);
      instr.addRow(["Question Image", "Image URL or filename (optional)"]);
      instr.addRow([]);
      instr.addRow(["How to use:"]);
      instr.addRow([
        "1. Each tab = one section. Rename tabs to your section names",
      ]);
      instr.addRow(["2. Add more tabs if you need more sections"]);
      instr.addRow(["3. Fill in questions row by row starting from row 2"]);
      instr.addRow([
        "4. For mcq_single: put one number in Correct Options (e.g. 2)",
      ]);
      instr.addRow([
        "5. For mcq_multiple: put comma-separated numbers (e.g. 1,3)",
      ]);
      instr.addRow([
        "6. Upload this file via the Import Questions button on the exam page",
      ]);
      instr.getRow(1).font = { bold: true };
      instr.getRow(11).font = { bold: true };

      const buffer = await workbook.xlsx.writeBuffer();
      return reply
        .code(200)
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header(
          "Content-Disposition",
          'attachment; filename="section-wise-question-template.xlsx"',
        )
        .send(Buffer.from(buffer));
    },
  );

  /* ----- POST /exams/:id/import-questions — multi-tab Excel, each tab = section ----- */
  app.post("/:id/import-questions", async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verify exam exists
    const [exam] = await db
      .select({ id: exams.id, subjectId: exams.subjectId })
      .from(exams)
      .where(eq(exams.id, id))
      .limit(1);
    if (!exam) return reply.code(404).send({ error: "Exam not found" });

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });

    const fields = file.fields as Record<string, unknown>;
    const subjectId = (fields.subjectId as { value?: string })?.value;
    if (!subjectId)
      return reply.code(400).send({ error: "subjectId is required" });

    const filename = file.filename.toLowerCase();
    if (!filename.endsWith(".xlsx") && !filename.endsWith(".xls"))
      return reply
        .code(400)
        .send({ error: "File must be an Excel (.xlsx) file" });

    const buf = await file.toBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf as unknown as ArrayBuffer);

    if (workbook.worksheets.length === 0)
      return reply.code(400).send({ error: "Excel file has no worksheets" });

    // Get existing sections for this exam
    const existingSections = await db
      .select()
      .from(examSections)
      .where(eq(examSections.examId, id))
      .orderBy(examSections.sectionOrder);

    let maxSectionOrder = existingSections.reduce(
      (max, s) => Math.max(max, s.sectionOrder),
      0,
    );

    const results: {
      sectionName: string;
      sectionId: string;
      imported: number;
      failed: number;
      errors: { row: number; error: string }[];
    }[] = [];

    // Process each worksheet tab as a section
    for (const worksheet of workbook.worksheets) {
      const sectionName = worksheet.name.trim();
      if (!sectionName) continue;
      // Skip Instructions tab
      if (sectionName.toLowerCase() === "instructions") continue;

      // Parse headers from row 1
      const headers: string[] = [];
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value ?? "")
          .toLowerCase()
          .trim();
      });

      const getCol = (row: ExcelJS.Row, name: string): string => {
        const idx = headers.indexOf(name);
        if (idx < 0) return "";
        const cell = row.getCell(idx + 1);
        return String(cell.value ?? "").trim();
      };

      // Find or create section
      let section = existingSections.find(
        (s) => s.name.toLowerCase() === sectionName.toLowerCase(),
      );

      if (!section) {
        maxSectionOrder++;
        const [newSection] = await db
          .insert(examSections)
          .values({
            examId: id,
            name: sectionName,
            sectionOrder: maxSectionOrder,
            totalMarks: "0",
            questionCount: 0,
            shuffleQuestions: false,
            shuffleOptions: false,
          } as typeof examSections.$inferInsert)
          .returning();
        section = newSection;
        existingSections.push(section);
      }

      // Get max display order for existing questions in this section
      const [maxRow] = await db
        .select({
          maxOrder: sql<number>`COALESCE(MAX(${examQuestions.displayOrder}), 0)`,
        })
        .from(examQuestions)
        .where(eq(examQuestions.examSectionId, section.id));
      let nextDisplayOrder = (maxRow?.maxOrder ?? 0) + 1;

      let imported = 0;
      let failed = 0;
      const errors: { row: number; error: string }[] = [];

      const questionInserts: (typeof questions.$inferInsert)[] = [];
      const optionInserts: {
        questionId: string;
        optionText: string;
        isCorrect: boolean;
        displayOrder: number;
      }[] = [];
      const examQuestionInserts: {
        examSectionId: string;
        questionId: string;
        displayOrder: number;
        isOptional: boolean;
      }[] = [];

      for (let rowIdx = 2; rowIdx <= worksheet.rowCount; rowIdx++) {
        const row = worksheet.getRow(rowIdx);
        const questionText =
          getCol(row, "question text") || getCol(row, "question");
        if (!questionText) {
          if (rowIdx > 2 || worksheet.rowCount > 2) {
            failed++;
            errors.push({ row: rowIdx, error: "Empty question text" });
          }
          continue;
        }

        try {
          const type = getCol(row, "type") || "mcq_single";
          const solutionText = getCol(row, "solution");
          const explanation = getCol(row, "explanation");

          // Parse options (Option 1-6)
          const opts: {
            optionText: string;
            isCorrect: boolean;
            displayOrder: number;
          }[] = [];
          for (let i = 1; i <= 6; i++) {
            const optText = getCol(row, `option ${i}`);
            if (!optText) continue;
            // Parse correct options (comma-separated indices or "all")
            const correctStr = getCol(row, "correct options");
            let isCorrect = false;
            if (correctStr.toLowerCase() === "all") {
              isCorrect = true;
            } else {
              const correctIndices = correctStr
                .split(",")
                .map((s) => parseInt(s.trim()))
                .filter((n) => !isNaN(n));
              isCorrect = correctIndices.includes(i);
            }
            opts.push({
              optionText: optText,
              isCorrect,
              displayOrder: i,
            });
          }

          if (opts.length === 0) {
            failed++;
            errors.push({ row: rowIdx, error: "No options provided" });
            continue;
          }

          // Check at least one correct option
          if (!opts.some((o) => o.isCorrect)) {
            failed++;
            errors.push({
              row: rowIdx,
              error: "No correct option marked",
            });
            continue;
          }

          const contentJson: Record<string, unknown> = { text: questionText };
          if (getCol(row, "question image"))
            contentJson.imageUrl = getCol(row, "question image");

          const solutionJson: Record<string, unknown> | null = {};
          if (solutionText) solutionJson!.text = solutionText;
          if (explanation) solutionJson!.explanation = explanation;
          const hasSolution = solutionText || explanation;

          questionInserts.push({
            subjectId,
            type: type as "mcq_single" | "mcq_multiple" | "true_false",
            contentJson,
            solutionJson: hasSolution ? solutionJson : null,
            createdBy: request.user.sub,
          });

          // Store options + exam question mapping temporarily with placeholder index
          const placeholderIdx = questionInserts.length - 1;
          for (const opt of opts) {
            optionInserts.push({
              questionId: `__placeholder_${placeholderIdx}`,
              ...opt,
            });
          }
          examQuestionInserts.push({
            examSectionId: section.id,
            questionId: `__placeholder_${placeholderIdx}`,
            displayOrder: nextDisplayOrder++,
            isOptional: false,
          });
        } catch (err) {
          failed++;
          errors.push({
            row: rowIdx,
            error: (err as Error).message,
          });
        }
      }

      // Batch insert questions, then resolve placeholders
      if (questionInserts.length > 0) {
        try {
          const insertedQuestions = await db
            .insert(questions)
            .values(questionInserts)
            .returning({ id: questions.id });

          // Replace placeholders with actual IDs
          for (let i = 0; i < insertedQuestions.length; i++) {
            const qId = insertedQuestions[i].id;
            for (const opt of optionInserts) {
              if (opt.questionId === `__placeholder_${i}`) {
                opt.questionId = qId;
              }
            }
            for (const eq of examQuestionInserts) {
              if (eq.questionId === `__placeholder_${i}`) {
                eq.questionId = qId;
              }
            }
          }

          // Insert options
          if (optionInserts.length > 0) {
            await db.insert(questionOptions).values(
              optionInserts.map((o) => ({
                questionId: o.questionId,
                optionText: o.optionText,
                isCorrect: o.isCorrect,
                displayOrder: o.displayOrder,
              })),
            );
          }

          // Insert exam questions
          if (examQuestionInserts.length > 0) {
            await db.insert(examQuestions).values(examQuestionInserts);
          }

          // Insert question versions
          const versionInserts = insertedQuestions.map((q) => ({
            questionId: q.id,
            versionNumber: 1,
            contentJson: questionInserts[insertedQuestions.indexOf(q)]
              .contentJson as Record<string, unknown>,
            changedBy: request.user.sub,
            changeReason: "Bulk import (Excel section-wise)",
          }));
          if (versionInserts.length > 0) {
            await db.insert(questionVersions).values(versionInserts);
          }

          imported = insertedQuestions.length;
        } catch (err) {
          failed += questionInserts.length;
          errors.push({
            row: 0,
            error: `Batch insert failed: ${(err as Error).message}`,
          });
        }
      }

      // Update section question count
      if (imported > 0) {
        const totalQuestionsInSection = await db
          .select({
            count: sql<number>`COUNT(*)::int`,
          })
          .from(examQuestions)
          .where(eq(examQuestions.examSectionId, section.id));

        await db
          .update(examSections)
          .set({
            questionCount: totalQuestionsInSection[0]?.count ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(examSections.id, section.id));
      }

      results.push({
        sectionName,
        sectionId: section.id,
        imported,
        failed,
        errors: errors.length > 0 ? errors.slice(0, 10) : [],
      });
    }

    const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    return reply.code(201).send({
      success: true,
      sections: results,
      totalImported,
      totalFailed,
    });
  });
};

export default examRoutes;
