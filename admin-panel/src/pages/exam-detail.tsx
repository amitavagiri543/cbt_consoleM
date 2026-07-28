import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { examsService } from "../services/exams";
import { subjectsService } from "../services/subjects";
import { useUIStore } from "../stores/ui-store";
import type { Exam, ExamQuestionRef, ExamSection } from "../types";

function getQuestionText(contentJson: unknown): string {
  if (!contentJson || typeof contentJson !== "object") return "";
  const obj = contentJson as Record<string, unknown>;
  if (typeof obj.questionText === "string") return obj.questionText;
  if (typeof obj.question === "string") return obj.question;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.statement === "string") return obj.statement;
  return JSON.stringify(obj).slice(0, 200);
}

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { from?: string } | null)?.from;
  const queryClient = useQueryClient();

  const setCustomBreadcrumbs = useUIStore((s) => s.setCustomBreadcrumbs);
  const setPageHeaderOverride = useUIStore((s) => s.setPageHeaderOverride);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSubjectId, setImportSubjectId] = useState("");

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects-list"],
    queryFn: () => subjectsService.list({ pageSize: 100 }),
  });

  const { data: exam, isLoading } = useQuery<Exam>({
    queryKey: ["exam", id],
    queryFn: () => examsService.getById(id!),
    enabled: !!id,
  });

  const importMutation = useMutation({
    mutationFn: () =>
      examsService.importQuestions(id!, importFile!, importSubjectId),
    onSuccess: (data) => {
      toast.success(
        `Imported ${data.totalImported} questions across ${data.sections.length} sections`,
      );
      if (data.totalFailed > 0) {
        toast.warning(`${data.totalFailed} questions failed to import`);
      }
      setImportOpen(false);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ["exam", id] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? "Import failed");
    },
  });

  const sections = exam?.sections ?? [];
  const totalQuestions = sections.reduce(
    (sum, s) => sum + (s.questions?.length ?? 0),
    0,
  );

  useEffect(() => {
    if (!exam) return;

    setCustomBreadcrumbs([
      { label: "Exams", path: "/exams" },
      { label: exam.name, path: `/exams/${exam.id}` },
    ]);
    setPageHeaderOverride({
      title: exam.name,
      subtitle: `Exam Code: ${exam.code} • Duration: ${exam.durationMinutes} mins • Marks: ${exam.totalMarks} • Questions: ${totalQuestions}`,
    });
  }, [exam, totalQuestions, setCustomBreadcrumbs, setPageHeaderOverride]);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Exam not found</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Compact Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              fromPath
                ? navigate(fromPath, { state: { folder: "exams" } })
                : navigate(-1)
            }
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back
          </Button>
        </div>
      </div>

      {exam.description && (
        <p className="text-sm text-muted-foreground">{exam.description}</p>
      )}

      {/* Import Questions Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Questions (Section-wise Excel)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <select
                value={importSubjectId}
                onChange={(e) => setImportSubjectId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select subject...</option>
                {(subjectsData?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Excel File (.xlsx)</Label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground hover:file:bg-primary/90"
              />
              {importFile && (
                <p className="text-xs text-muted-foreground">
                  Selected: {importFile.name} (
                  {(importFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Excel format:</p>
              <ul className="mt-1 space-y-0.5">
                <li>
                  Each <b>tab/sheet</b> name becomes a <b>section name</b>
                </li>
                <li>
                  Columns: <b>Question Text</b>, Type, Option 1-6, Correct
                  Options (comma-separated indices, e.g. "1" or "1,3"),
                  Solution, Explanation
                </li>
                <li>
                  Example: Correct Options = "2" means Option 2 is correct
                </li>
                <li>Use "all" to mark all options as correct</li>
              </ul>
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const blob = await examsService.downloadSectionTemplate();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "section-wise-question-template.xlsx";
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      toast.error("Failed to download template");
                    }
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download Template
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={
                !importFile || !importSubjectId || importMutation.isPending
              }
            >
              {importMutation.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sections */}
      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No sections or questions added to this exam yet.
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section: ExamSection, idx) => (
            <div key={section.id} className="rounded-lg border">
              {/* Section header */}
              <div className="border-b bg-muted/50 px-5 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">
                      Section {idx + 1}: {section.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {section.questions?.length ?? 0} questions
                      {section.durationMinutes
                        ? ` • ${section.durationMinutes} min`
                        : ""}
                      {section.totalMarks
                        ? ` • ${section.totalMarks} marks`
                        : ""}
                    </p>
                  </div>
                </div>
              </div>

              {/* Questions */}
              <div className="divide-y">
                {(section.questions ?? []).map((q: ExamQuestionRef, qIdx) => {
                  const options = q.options ?? [];
                  const showOptions = [
                    "mcq_single",
                    "mcq_multiple",
                    "true_false",
                  ].includes(q.type ?? "");
                  return (
                    <div key={q.id ?? qIdx} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {qIdx + 1}
                        </span>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="capitalize text-xs"
                            >
                              {q.type ?? "question"}
                            </Badge>
                          </div>
                          <p className="text-sm">
                            {getQuestionText(q.contentJson) || (
                              <span className="text-muted-foreground italic">
                                Question content unavailable
                              </span>
                            )}
                          </p>
                          {showOptions && options.length > 0 && (
                            <ul className="ml-4 space-y-1">
                              {options.map((opt, oIdx) => (
                                <li
                                  key={oIdx}
                                  className={`text-sm ${opt.isCorrect ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}`}
                                >
                                  <span className="mr-2 font-medium">
                                    {String.fromCharCode(65 + oIdx)}.
                                  </span>
                                  {opt.optionText}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(section.questions?.length ?? 0) === 0 && (
                  <div className="px-5 py-4 text-center text-sm text-muted-foreground">
                    No questions in this section.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
