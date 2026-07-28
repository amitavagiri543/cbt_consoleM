import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { type FastifyPluginAsync } from "fastify";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { db } from "../../database/db.js";
import {
    questionOptions,
    questions,
    questionTags,
    questionVersions,
} from "../../database/schemas/index.js";
import { requireRole } from "../../middleware/rbac.js";
import { uploadImage } from "../../services/storage.js";
import { extractZip, findImage } from "../../services/zip-extractor.js";

/* ---------- Shared Types ---------- */

type QuestionInsert = typeof questions.$inferInsert;

interface ExportQuestionRow {
  id: string;
  subjectId: string;
  type: string;
  cognitiveLevel: string | null;
  contentJson: Record<string, unknown>;
  mediaUrlsJson: string[] | null;
  solutionJson: { text?: string; explanation?: string } | null;
  version: number;
  options: { optionText: string; isCorrect: boolean; displayOrder: number }[];
  tags: string[];
}

/* ---------- Constants ---------- */

const EXPORT_LIMIT = 10000;
const INSERT_CHUNK_SIZE = 500;
const CHILD_CHUNK_SIZE = 2000;

/* ---------- Chunking Helper ---------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/* ---------- Export Query Helper ---------- */

async function fetchQuestionsForExport(filters: {
  subjectId?: string;
  type?: string;
  search?: string;
}): Promise<ExportQuestionRow[]> {
  const conditions: ReturnType<typeof eq>[] = [];
  if (filters.subjectId)
    conditions.push(eq(questions.subjectId, filters.subjectId));
  if (filters.type) conditions.push(eq(questions.type, filters.type as never));
  if (filters.search)
    conditions.push(
      ilike(sql`CAST(${questions.contentJson} AS TEXT)`, `%${filters.search}%`),
    );

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(questions)
    .where(where)
    .orderBy(asc(questions.createdAt))
    .limit(EXPORT_LIMIT);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [allOptions, allTags] = await Promise.all([
    db
      .select()
      .from(questionOptions)
      .where(inArray(questionOptions.questionId, ids))
      .orderBy(asc(questionOptions.displayOrder)),
    db.select().from(questionTags).where(inArray(questionTags.questionId, ids)),
  ]);

  const optionsMap = new Map<string, ExportQuestionRow["options"]>();
  for (const opt of allOptions) {
    const arr = optionsMap.get(opt.questionId) ?? [];
    arr.push({
      optionText: opt.optionText,
      isCorrect: opt.isCorrect,
      displayOrder: opt.displayOrder,
    });
    optionsMap.set(opt.questionId, arr);
  }

  const tagsMap = new Map<string, string[]>();
  for (const t of allTags) {
    const arr = tagsMap.get(t.questionId) ?? [];
    arr.push(t.tag);
    tagsMap.set(t.questionId, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subjectId,
    type: r.type,
    cognitiveLevel: r.cognitiveLevel,
    contentJson: r.contentJson as Record<string, unknown>,
    mediaUrlsJson: r.mediaUrlsJson as string[] | null,
    solutionJson: r.solutionJson as ExportQuestionRow["solutionJson"],
    version: r.version,
    options: optionsMap.get(r.id) ?? [],
    tags: tagsMap.get(r.id) ?? [],
  }));
}

/* ---------- Batch Insert Helper ---------- */

async function batchInsertQuestions(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  items: QuestionInsert[],
): Promise<{ id: string }[]> {
  const results: { id: string }[] = [];
  for (const batch of chunk(items, INSERT_CHUNK_SIZE)) {
    const inserted = await tx
      .insert(questions)
      .values(batch)
      .returning({ id: questions.id });
    results.push(...inserted);
  }
  return results;
}

async function batchInsertChildren<T extends { questionId: string }>(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  table: typeof questionOptions | typeof questionTags | typeof questionVersions,
  rows: T[],
): Promise<void> {
  for (const batch of chunk(rows, CHILD_CHUNK_SIZE)) {
    await tx.insert(table).values(batch as never);
  }
}

/* ---------- Export Route ---------- */

const exportQuerySchema = z.object({
  format: z.enum(["json", "excel", "pdf"]).default("json"),
  subjectId: z.string().uuid().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
});

function buildTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Questions");

  ws.columns = [
    { header: "Question Text", key: "questionText", width: 60 },
    { header: "Question Image", key: "questionImage", width: 30 },
    { header: "Type", key: "type", width: 18 },
    { header: "Option 1", key: "opt1", width: 30 },
    { header: "Option 1 Image", key: "opt1Image", width: 25 },
    { header: "Option 2", key: "opt2", width: 30 },
    { header: "Option 2 Image", key: "opt2Image", width: 25 },
    { header: "Option 3", key: "opt3", width: 30 },
    { header: "Option 3 Image", key: "opt3Image", width: 25 },
    { header: "Option 4", key: "opt4", width: 30 },
    { header: "Option 4 Image", key: "opt4Image", width: 25 },
    { header: "Correct Options", key: "correctOpts", width: 18 },
    { header: "Solution (optional)", key: "solution", width: 50 },
    { header: "Explanation (optional)", key: "explanation", width: 50 },
    { header: "Tags (optional)", key: "tags", width: 30 },
  ];

  ws.getRow(1).font = { bold: true };

  ws.addRow({
    questionText: "What is the capital of France?",
    questionImage: "images/q1.png",
    type: "mcq_single",
    opt1: "London",
    opt1Image: "",
    opt2: "Paris",
    opt2Image: "",
    opt3: "Berlin",
    opt3Image: "",
    opt4: "Madrid",
    opt4Image: "",
    correctOpts: "2",
    solution: "Paris",
    explanation: "Paris has been the capital of France since 987 AD.",
    tags: "geography, europe",
  });

  const instr = workbook.addWorksheet("Instructions");
  instr.getColumn(1).width = 30;
  instr.getColumn(2).width = 70;
  instr.addRow(["Field", "Description"]);
  instr.addRow(["Question Text", "The question text (required)"]);
  instr.addRow([
    "Question Image",
    "Image filename in the ZIP, e.g. images/q1.png (optional)",
  ]);
  instr.addRow([
    "Type",
    "Question type: mcq_single, mcq_multiple, true_false, numerical, fill_in_blank",
  ]);
  instr.addRow([
    "Option 1-4",
    "Text for each option (at least 2 required for MCQ)",
  ]);
  instr.addRow([
    "Option 1-4 Image",
    "Image filename for each option (optional)",
  ]);
  instr.addRow([
    "Correct Options",
    "Comma-separated option numbers, e.g. 2 or 1,3",
  ]);
  instr.addRow(["Solution", "Short solution text (optional)"]);
  instr.addRow(["Explanation", "Detailed explanation (optional)"]);
  instr.addRow(["Tags", "Comma-separated tags (optional)"]);
  instr.addRow([]);
  instr.addRow(["How to upload with images:"]);
  instr.addRow(["1. Fill in the Questions sheet"]);
  instr.addRow(["2. Put image files in an 'images' folder"]);
  instr.addRow([
    "3. Reference images by filename in the Question Image / Option Image columns",
  ]);
  instr.addRow(["4. ZIP the Excel file and images folder together"]);
  instr.addRow(["5. Upload the ZIP file using the bulk upload feature"]);
  instr.getRow(1).font = { bold: true };
  instr.getRow(16).font = { bold: true };

  return workbook;
}

function createSamplePng(): Buffer {
  // Minimal 1x1 red PNG
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.from([
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
  ]);
  const idat = Buffer.from([
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
    0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7,
  ]);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([signature, ihdr, idat, iend]);
}

const importExportRoutes: FastifyPluginAsync = async (app) => {
  /* ----- GET /questions/template ----- */
  app.get(
    "/template",
    { preHandler: requireRole("super_admin", "exam_admin", "question_author") },
    async (request, reply) => {
      const query = (request.query as { format?: string }) ?? {};
      const format = query.format ?? "excel";

      const workbook = buildTemplateWorkbook();
      const excelBuffer = await workbook.xlsx.writeBuffer();

      if (format === "zip") {
        const { ZipArchive } = await import("archiver");
        const archive = new ZipArchive();
        const chunks: Buffer[] = [];
        archive.on("data", (chunk: Buffer) => chunks.push(chunk));

        archive.append(Buffer.from(excelBuffer), {
          name: "questions.xlsx",
        });
        archive.append(createSamplePng(), {
          name: "images/q1.png",
        });
        await archive.finalize();

        const zipBuffer = Buffer.concat(chunks);
        return reply
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="question-upload-template.zip"`,
          )
          .send(zipBuffer);
      }

      return reply
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header(
          "Content-Disposition",
          `attachment; filename="question-upload-template.xlsx"`,
        )
        .send(Buffer.from(excelBuffer));
    },
  );
  /* ----- GET /questions/export ----- */
  app.get(
    "/export",
    { preHandler: requireRole("super_admin", "exam_admin") },
    async (request, reply) => {
      const parsed = exportQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid query parameters" });

      const { format, ...filters } = parsed.data;
      const rows = await fetchQuestionsForExport(filters);

      if (format === "json") {
        return reply
          .header("Content-Type", "application/json")
          .header(
            "Content-Disposition",
            `attachment; filename="questions-export-${Date.now()}.json"`,
          )
          .send(
            JSON.stringify(
              {
                exportedAt: new Date().toISOString(),
                total: rows.length,
                questions: rows,
              },
              null,
              2,
            ),
          );
      }

      if (format === "excel") {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet("Questions");

        ws.columns = [
          { header: "ID", key: "id", width: 36 },
          { header: "Type", key: "type", width: 18 },
          { header: "Question Text", key: "questionText", width: 60 },
          { header: "Option 1", key: "opt1", width: 30 },
          { header: "Option 2", key: "opt2", width: 30 },
          { header: "Option 3", key: "opt3", width: 30 },
          { header: "Option 4", key: "opt4", width: 30 },
          { header: "Option 5", key: "opt5", width: 30 },
          { header: "Option 6", key: "opt6", width: 30 },
          { header: "Correct Options", key: "correctOpts", width: 18 },
          { header: "Solution", key: "solution", width: 50 },
          { header: "Explanation", key: "explanation", width: 50 },
          { header: "Tags", key: "tags", width: 30 },
        ];

        ws.getRow(1).font = { bold: true };

        for (const r of rows) {
          const contentText = (r.contentJson?.text as string) ?? "";
          const solutionText = r.solutionJson?.text ?? "";
          const explanation = r.solutionJson?.explanation ?? "";
          const opts = r.options.slice(0, 6);
          const optMap: Record<string, string> = {};
          opts.forEach((o, i) => {
            optMap[`opt${i + 1}`] = o.optionText;
          });
          const correctOpts = opts
            .filter((o) => o.isCorrect)
            .map((o) => o.displayOrder)
            .join(",");

          ws.addRow({
            id: r.id,
            type: r.type,
            questionText: contentText,
            ...optMap,
            correctOpts,
            solution: solutionText,
            explanation,
            tags: r.tags.join(", "),
          });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        return reply
          .header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          )
          .header(
            "Content-Disposition",
            `attachment; filename="questions-export-${Date.now()}.xlsx"`,
          )
          .send(Buffer.from(buffer));
      }

      if (format === "pdf") {
        reply.header("Content-Type", "application/pdf");
        reply.header(
          "Content-Disposition",
          `attachment; filename="questions-export-${Date.now()}.pdf"`,
        );

        const doc = new PDFDocument({ margin: 40, size: "A4" });
        doc.pipe(reply.raw);

        doc
          .fontSize(18)
          .font("Helvetica-Bold")
          .text("Question Bank Export", { align: "center" });
        doc
          .fontSize(10)
          .font("Helvetica")
          .text(
            `Exported: ${new Date().toISOString()} | Total: ${rows.length} questions`,
            { align: "center" },
          );
        doc.moveDown(1);

        for (const r of rows) {
          const contentText = (r.contentJson?.text as string) ?? "";

          doc.fontSize(11).font("Helvetica-Bold").text(`Q: ${contentText}`, {
            width: 515,
          });
          doc
            .fontSize(8)
            .font("Helvetica")
            .fillColor("gray")
            .text(`Type: ${r.type}`);
          doc.fillColor("black");

          if (r.options.length > 0) {
            doc.moveDown(0.3);
            for (const opt of r.options) {
              const marker = opt.isCorrect ? "[✓]" : "[ ]";
              doc
                .fontSize(9)
                .font("Helvetica")
                .text(`  ${marker} ${opt.optionText}`, { width: 500 });
            }
          }

          if (r.solutionJson?.text || r.solutionJson?.explanation) {
            doc.moveDown(0.3);
            if (r.solutionJson.text)
              doc
                .fontSize(9)
                .font("Helvetica-Oblique")
                .text(`Solution: ${r.solutionJson.text}`);
            if (r.solutionJson.explanation)
              doc
                .fontSize(9)
                .font("Helvetica-Oblique")
                .text(`Explanation: ${r.solutionJson.explanation}`);
          }

          if (r.tags.length > 0) {
            doc.moveDown(0.2);
            doc
              .fontSize(8)
              .fillColor("blue")
              .text(`Tags: ${r.tags.join(", ")}`);
            doc.fillColor("black");
          }

          doc.moveDown(0.5);
          doc
            .moveTo(40, doc.y)
            .lineTo(555, doc.y)
            .strokeColor("#cccccc")
            .stroke();
          doc.moveDown(0.5);

          if (doc.y > 780) {
            doc.addPage();
          }
        }

        doc.end();
        return reply;
      }
    },
  );

  /* ----- POST /questions/import ----- */
  app.post(
    "/import",
    { preHandler: requireRole("super_admin", "exam_admin") },
    async (request: any, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "No file uploaded" });

      const fields = file.fields as Record<string, unknown>;
      const subjectId = (fields.subjectId as { value?: string })?.value;

      if (!subjectId)
        return reply.code(400).send({ error: "subjectId is required" });

      const filename = file.filename.toLowerCase();
      const ext = filename.split(".").pop();

      let imported = 0;
      let failed = 0;
      const errors: { row: number; error: string }[] = [];

      if (ext === "json") {
        const raw = await file.toBuffer();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf-8"));
        } catch {
          return reply.code(400).send({ error: "Invalid JSON file" });
        }

        const arr = Array.isArray(parsed)
          ? parsed
          : (parsed as { questions?: unknown[] }).questions;
        if (!Array.isArray(arr))
          return reply
            .code(400)
            .send({ error: "JSON must be an array or { questions: [...] }" });

        interface ParsedItem {
          questionValues: QuestionInsert;
          options: {
            optionText: string;
            isCorrect: boolean;
            displayOrder: number;
          }[];
          tags: string[];
          content: Record<string, unknown>;
        }

        const validItems: ParsedItem[] = [];

        for (let i = 0; i < arr.length; i++) {
          try {
            const item = arr[i] as Record<string, unknown>;
            const content = (item.content ?? {
              text: item.text ?? item.questionText ?? "",
            }) as Record<string, unknown>;
            const opts = Array.isArray(item.options) ? item.options : [];
            const tags = Array.isArray(item.tags) ? item.tags : [];

            validItems.push({
              questionValues: {
                subjectId,
                type: ((item.type as string) ?? "mcq_single") as "mcq_single",
                cognitiveLevel: ((item.cognitiveLevel as string) ?? null) as
                  | "remember"
                  | "understand"
                  | "apply"
                  | "analyze"
                  | "evaluate"
                  | "create"
                  | null,
                contentJson: content,
                mediaUrlsJson: Array.isArray(item.mediaUrls)
                  ? item.mediaUrls
                  : null,
                solutionJson:
                  (item.solution as Record<string, unknown>) ?? null,
                createdBy: request.user.sub,
              },
              options: opts.map((o: Record<string, unknown>, idx: number) => ({
                optionText: (o.text as string) ?? "",
                isCorrect: (o.isCorrect as boolean) ?? false,
                displayOrder: (o.displayOrder as number) ?? idx + 1,
              })),
              tags: tags as string[],
              content,
            });
          } catch (err) {
            failed++;
            errors.push({ row: i + 1, error: (err as Error).message });
          }
        }

        if (validItems.length > 0) {
          try {
            await db.transaction(async (tx) => {
              const insertedQuestions = await batchInsertQuestions(
                tx,
                validItems.map((v) => v.questionValues),
              );

              const allOptions: {
                questionId: string;
                optionText: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const allTags: { questionId: string; tag: string }[] = [];
              const allVersions: {
                questionId: string;
                versionNumber: number;
                contentJson: Record<string, unknown>;
                changedBy: string;
                changeReason: string;
              }[] = [];

              insertedQuestions.forEach((q, idx) => {
                const item = validItems[idx];
                for (const opt of item.options) {
                  allOptions.push({ questionId: q.id, ...opt });
                }
                for (const tag of item.tags) {
                  allTags.push({ questionId: q.id, tag });
                }
                allVersions.push({
                  questionId: q.id,
                  versionNumber: 1,
                  contentJson: item.content,
                  changedBy: request.user.sub,
                  changeReason: "Bulk import (JSON)",
                });
              });

              await Promise.all([
                allOptions.length > 0
                  ? batchInsertChildren(tx, questionOptions, allOptions)
                  : null,
                allTags.length > 0
                  ? batchInsertChildren(tx, questionTags, allTags)
                  : null,
                batchInsertChildren(tx, questionVersions, allVersions),
              ]);

              imported = insertedQuestions.length;
            });
          } catch (err) {
            failed += validItems.length;
            errors.push({
              row: 0,
              error: `Batch insert failed: ${(err as Error).message}`,
            });
          }
        }
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.toBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);

        if (workbook.worksheets.length === 0)
          return reply
            .code(400)
            .send({ error: "Excel file has no worksheets" });

        const excelValidItems: {
          questionValues: QuestionInsert;
          options: {
            optionText: string;
            isCorrect: boolean;
            displayOrder: number;
          }[];
          tags: string[];
          content: Record<string, unknown>;
        }[] = [];

        // Process ALL worksheet tabs (skip Instructions tab)
        for (const ws of workbook.worksheets) {
          const sheetName = ws.name.trim();
          if (sheetName.toLowerCase() === "instructions") continue;

          // Parse headers from row 1 for this worksheet
          const headers: string[] = [];
          ws.getRow(1).eachCell((cell, colNumber) => {
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

          for (let rowIdx = 2; rowIdx <= ws.rowCount; rowIdx++) {
            const row = ws.getRow(rowIdx);
            const questionText =
              getCol(row, "question text") || getCol(row, "question");
            if (!questionText) {
              if (ws.rowCount > 2) {
                failed++;
                errors.push({
                  row: rowIdx,
                  error: `Empty question text (tab: ${sheetName})`,
                });
              }
              continue;
            }

            try {
              const type = getCol(row, "type") || "mcq_single";
              const solutionText = getCol(row, "solution");
              const explanation = getCol(row, "explanation");
              const tagsStr = getCol(row, "tags");

              const opts: {
                text: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const correctSet = new Set(
                getCol(row, "correct options")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map(Number),
              );

              for (let oi = 1; oi <= 6; oi++) {
                const optText = getCol(row, `option ${oi}`);
                if (optText) {
                  opts.push({
                    text: optText,
                    isCorrect: correctSet.has(oi),
                    displayOrder: oi,
                  });
                }
              }

              const content = { text: questionText };
              const solution =
                solutionText || explanation
                  ? {
                      text: solutionText || undefined,
                      explanation: explanation || undefined,
                    }
                  : null;
              const tags = tagsStr
                ? tagsStr
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                : [];

              excelValidItems.push({
                questionValues: {
                  subjectId,
                  type: type as "mcq_single",
                  contentJson: content,
                  solutionJson: solution,
                  sectionName: sheetName,
                  createdBy: request.user.sub,
                },
                options: opts.map((o) => ({
                  optionText: o.text,
                  isCorrect: o.isCorrect,
                  displayOrder: o.displayOrder,
                })),
                tags,
                content,
              });
            } catch (err) {
              failed++;
              errors.push({ row: rowIdx, error: (err as Error).message });
            }
          }
        }

        if (excelValidItems.length > 0) {
          try {
            await db.transaction(async (tx) => {
              const insertedQuestions = await batchInsertQuestions(
                tx,
                excelValidItems.map((v) => v.questionValues),
              );

              const allOptions: {
                questionId: string;
                optionText: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const allTags: { questionId: string; tag: string }[] = [];
              const allVersions: {
                questionId: string;
                versionNumber: number;
                contentJson: Record<string, unknown>;
                changedBy: string;
                changeReason: string;
              }[] = [];

              insertedQuestions.forEach((q, idx) => {
                const item = excelValidItems[idx];
                for (const opt of item.options) {
                  allOptions.push({ questionId: q.id, ...opt });
                }
                for (const tag of item.tags) {
                  allTags.push({ questionId: q.id, tag });
                }
                allVersions.push({
                  questionId: q.id,
                  versionNumber: 1,
                  contentJson: item.content,
                  changedBy: request.user.sub,
                  changeReason: "Bulk import (Excel)",
                });
              });

              await Promise.all([
                allOptions.length > 0
                  ? batchInsertChildren(tx, questionOptions, allOptions)
                  : null,
                allTags.length > 0
                  ? batchInsertChildren(tx, questionTags, allTags)
                  : null,
                batchInsertChildren(tx, questionVersions, allVersions),
              ]);

              imported = insertedQuestions.length;
            });
          } catch (err) {
            failed += excelValidItems.length;
            errors.push({
              row: 0,
              error: `Batch insert failed: ${(err as Error).message}`,
            });
          }
        }
      } else {
        return reply.code(400).send({
          error: "Unsupported file format. Use .json, .xlsx, .xls, or .zip",
        });
      }

      return reply.code(201).send({
        imported,
        failed,
        total: imported + failed,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      });
    },
  );

  /* ----- POST /questions/import-zip ----- */
  app.post(
    "/import-zip",
    { preHandler: requireRole("super_admin", "exam_admin") },
    async (request: any, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "No file uploaded" });

      const fields = file.fields as Record<string, unknown>;
      const subjectId = (fields.subjectId as { value?: string })?.value;
      if (!subjectId)
        return reply.code(400).send({ error: "subjectId is required" });

      const filename = file.filename.toLowerCase();
      if (!filename.endsWith(".zip"))
        return reply.code(400).send({ error: "File must be a .zip archive" });

      const zipBuffer = await file.toBuffer();

      let extracted;
      try {
        extracted = await extractZip(zipBuffer);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: `Failed to extract ZIP: ${(err as Error).message}` });
      }

      if (!extracted.excelFile && !extracted.jsonFile)
        return reply.code(400).send({
          error:
            "ZIP must contain an Excel (.xlsx) or JSON (.json) file with questions",
        });

      let imported = 0;
      let failed = 0;
      const errors: { row: number; error: string }[] = [];

      /* ---------- ZIP with JSON ---------- */
      if (extracted.jsonFile) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(extracted.jsonFile.buffer.toString("utf-8"));
        } catch {
          return reply.code(400).send({ error: "Invalid JSON file in ZIP" });
        }

        const arr = Array.isArray(parsed)
          ? parsed
          : (parsed as { questions?: unknown[] }).questions;
        if (!Array.isArray(arr))
          return reply
            .code(400)
            .send({ error: "JSON must be an array or { questions: [...] }" });

        interface ParsedItem {
          questionValues: QuestionInsert;
          options: {
            optionText: string;
            isCorrect: boolean;
            displayOrder: number;
          }[];
          tags: string[];
          content: Record<string, unknown>;
        }

        const validItems: ParsedItem[] = [];

        for (let i = 0; i < arr.length; i++) {
          try {
            const item = arr[i] as Record<string, unknown>;
            const content = (item.content ?? {
              text: item.text ?? item.questionText ?? "",
            }) as Record<string, unknown>;
            const opts = Array.isArray(item.options) ? item.options : [];
            const tags = Array.isArray(item.tags) ? item.tags : [];

            // Upload images referenced in the JSON
            const mediaUrls: string[] = [];
            if (Array.isArray(item.mediaUrls)) {
              for (const ref of item.mediaUrls) {
                if (typeof ref !== "string") continue;
                // If it's a local file reference, upload from ZIP
                const imgFile = findImage(extracted.images, ref);
                if (imgFile) {
                  const url = await uploadImage(
                    imgFile.buffer,
                    `questions/${subjectId}`,
                    imgFile.filename,
                  );
                  mediaUrls.push(url);
                } else if (ref.startsWith("http")) {
                  mediaUrls.push(ref);
                }
              }
            }
            // Also check for image field
            if (typeof item.image === "string") {
              const imgFile = findImage(extracted.images, item.image);
              if (imgFile) {
                const url = await uploadImage(
                  imgFile.buffer,
                  `questions/${subjectId}`,
                  imgFile.filename,
                );
                mediaUrls.push(url);
              }
            }

            // Upload option images
            const processedOptions = await Promise.all(
              opts.map(async (o: Record<string, unknown>, idx: number) => {
                let optionText = (o.text as string) ?? "";
                const optMediaUrls: string[] = [];
                if (typeof o.image === "string") {
                  const imgFile = findImage(extracted.images, o.image);
                  if (imgFile) {
                    const url = await uploadImage(
                      imgFile.buffer,
                      `questions/${subjectId}/options`,
                      imgFile.filename,
                    );
                    optMediaUrls.push(url);
                  }
                }
                return {
                  optionText,
                  isCorrect: (o.isCorrect as boolean) ?? false,
                  displayOrder: (o.displayOrder as number) ?? idx + 1,
                  mediaUrls: optMediaUrls,
                };
              }),
            );

            validItems.push({
              questionValues: {
                subjectId,
                type: ((item.type as string) ?? "mcq_single") as "mcq_single",
                cognitiveLevel: ((item.cognitiveLevel as string) ?? null) as
                  | "remember"
                  | "understand"
                  | "apply"
                  | "analyze"
                  | "evaluate"
                  | "create"
                  | null,
                contentJson: content,
                mediaUrlsJson: mediaUrls.length > 0 ? mediaUrls : null,
                solutionJson:
                  (item.solution as Record<string, unknown>) ?? null,
                createdBy: request.user.sub,
              },
              options: processedOptions.map((o) => ({
                optionText: o.optionText,
                isCorrect: o.isCorrect,
                displayOrder: o.displayOrder,
              })),
              tags: tags as string[],
              content,
            });
          } catch (err) {
            failed++;
            errors.push({ row: i + 1, error: (err as Error).message });
          }
        }

        if (validItems.length > 0) {
          try {
            await db.transaction(async (tx) => {
              const insertedQuestions = await batchInsertQuestions(
                tx,
                validItems.map((v) => v.questionValues),
              );

              const allOptions: {
                questionId: string;
                optionText: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const allTags: { questionId: string; tag: string }[] = [];
              const allVersions: {
                questionId: string;
                versionNumber: number;
                contentJson: Record<string, unknown>;
                changedBy: string;
                changeReason: string;
              }[] = [];

              insertedQuestions.forEach((q, idx) => {
                const item = validItems[idx];
                for (const opt of item.options) {
                  allOptions.push({ questionId: q.id, ...opt });
                }
                for (const tag of item.tags) {
                  allTags.push({ questionId: q.id, tag });
                }
                allVersions.push({
                  questionId: q.id,
                  versionNumber: 1,
                  contentJson: item.content,
                  changedBy: request.user.sub,
                  changeReason: "Bulk import (ZIP/JSON)",
                });
              });

              await Promise.all([
                allOptions.length > 0
                  ? batchInsertChildren(tx, questionOptions, allOptions)
                  : null,
                allTags.length > 0
                  ? batchInsertChildren(tx, questionTags, allTags)
                  : null,
                batchInsertChildren(tx, questionVersions, allVersions),
              ]);

              imported = insertedQuestions.length;
            });
          } catch (err) {
            failed += validItems.length;
            errors.push({
              row: 0,
              error: `Batch insert failed: ${(err as Error).message}`,
            });
          }
        }
      }

      /* ---------- ZIP with Excel ---------- */
      if (extracted.excelFile) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(extracted.excelFile.buffer as any);

        if (workbook.worksheets.length === 0)
          return reply
            .code(400)
            .send({ error: "Excel file has no worksheets" });

        const excelValidItems: {
          questionValues: QuestionInsert;
          options: {
            optionText: string;
            isCorrect: boolean;
            displayOrder: number;
          }[];
          tags: string[];
          content: Record<string, unknown>;
        }[] = [];

        // Process ALL worksheet tabs (skip Instructions tab)
        for (const ws of workbook.worksheets) {
          const sheetName = ws.name.trim();
          if (sheetName.toLowerCase() === "instructions") continue;

          const headers: string[] = [];
          ws.getRow(1).eachCell((cell, colNumber) => {
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

          for (let rowIdx = 2; rowIdx <= ws.rowCount; rowIdx++) {
            const row = ws.getRow(rowIdx);
            const questionText =
              getCol(row, "question text") || getCol(row, "question");
            if (!questionText) {
              if (ws.rowCount > 2) {
                failed++;
                errors.push({
                  row: rowIdx,
                  error: `Empty question text (tab: ${sheetName})`,
                });
              }
              continue;
            }

            try {
              const type = getCol(row, "type") || "mcq_single";
              const solutionText = getCol(row, "solution");
              const explanation = getCol(row, "explanation");
              const tagsStr = getCol(row, "tags");
              const questionImageRef =
                getCol(row, "question image") || getCol(row, "image");

              // Upload question image if referenced
              const mediaUrls: string[] = [];
              if (questionImageRef) {
                const imgFile = findImage(extracted.images, questionImageRef);
                if (imgFile) {
                  const url = await uploadImage(
                    imgFile.buffer,
                    `questions/${subjectId}`,
                    imgFile.filename,
                  );
                  mediaUrls.push(url);
                } else if (questionImageRef.startsWith("http")) {
                  mediaUrls.push(questionImageRef);
                }
              }

              const opts: {
                text: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const correctSet = new Set(
                getCol(row, "correct options")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map(Number),
              );

              for (let oi = 1; oi <= 6; oi++) {
                const optText = getCol(row, `option ${oi}`);
                const optImageRef = getCol(row, `option ${oi} image`);
                if (optText || optImageRef) {
                  // Upload option image if referenced
                  if (optImageRef) {
                    const imgFile = findImage(extracted.images, optImageRef);
                    if (imgFile) {
                      const url = await uploadImage(
                        imgFile.buffer,
                        `questions/${subjectId}/options`,
                        imgFile.filename,
                      );
                      mediaUrls.push(url);
                    } else if (optImageRef.startsWith("http")) {
                      mediaUrls.push(optImageRef);
                    }
                  }
                  opts.push({
                    text: optText || "",
                    isCorrect: correctSet.has(oi),
                    displayOrder: oi,
                  });
                }
              }

              const content = { text: questionText };
              const solution =
                solutionText || explanation
                  ? {
                      text: solutionText || undefined,
                      explanation: explanation || undefined,
                    }
                  : null;
              const tags = tagsStr
                ? tagsStr
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                : [];

              excelValidItems.push({
                questionValues: {
                  subjectId,
                  type: type as "mcq_single",
                  contentJson: content,
                  mediaUrlsJson: mediaUrls.length > 0 ? mediaUrls : null,
                  solutionJson: solution,
                  sectionName: sheetName,
                  createdBy: request.user.sub,
                },
                options: opts.map((o) => ({
                  optionText: o.text,
                  isCorrect: o.isCorrect,
                  displayOrder: o.displayOrder,
                })),
                tags,
                content,
              });
            } catch (err) {
              failed++;
              errors.push({ row: rowIdx, error: (err as Error).message });
            }
          }
        }

        if (excelValidItems.length > 0) {
          try {
            await db.transaction(async (tx) => {
              const insertedQuestions = await batchInsertQuestions(
                tx,
                excelValidItems.map((v) => v.questionValues),
              );

              const allOptions: {
                questionId: string;
                optionText: string;
                isCorrect: boolean;
                displayOrder: number;
              }[] = [];
              const allTags: { questionId: string; tag: string }[] = [];
              const allVersions: {
                questionId: string;
                versionNumber: number;
                contentJson: Record<string, unknown>;
                changedBy: string;
                changeReason: string;
              }[] = [];

              insertedQuestions.forEach((q, idx) => {
                const item = excelValidItems[idx];
                for (const opt of item.options) {
                  allOptions.push({ questionId: q.id, ...opt });
                }
                for (const tag of item.tags) {
                  allTags.push({ questionId: q.id, tag });
                }
                allVersions.push({
                  questionId: q.id,
                  versionNumber: 1,
                  contentJson: item.content,
                  changedBy: request.user.sub,
                  changeReason: "Bulk import (ZIP/Excel)",
                });
              });

              await Promise.all([
                allOptions.length > 0
                  ? batchInsertChildren(tx, questionOptions, allOptions)
                  : null,
                allTags.length > 0
                  ? batchInsertChildren(tx, questionTags, allTags)
                  : null,
                batchInsertChildren(tx, questionVersions, allVersions),
              ]);

              imported = insertedQuestions.length;
            });
          } catch (err) {
            failed += excelValidItems.length;
            errors.push({
              row: 0,
              error: `Batch insert failed: ${(err as Error).message}`,
            });
          }
        }
      }

      return reply.code(201).send({
        imported,
        failed,
        total: imported + failed,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      });
    },
  );
};

export default importExportRoutes;
