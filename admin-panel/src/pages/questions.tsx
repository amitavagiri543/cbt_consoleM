import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeft,
    ClipboardList,
    Download,
    Loader2,
    Pencil,
    Plus,
    Search,
    Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "../components/ui/table";
import { examsService } from "../services/exams";
import { questionsService } from "../services/questions";
import { subjectsService } from "../services/subjects";
import type {
    CreateExamInput,
    CreateQuestionInput,
    NavigationMode,
    Question,
    QuestionType,
    SelectionStrategy,
} from "../types";

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "mcq_single", label: "MCQ (Single Correct)" },
  { value: "mcq_multiple", label: "MCQ (Multiple Correct)" },
  { value: "fill_in_blank", label: "Fill in the Blank" },
  { value: "essay", label: "Essay / Subjective" },
  { value: "true_false", label: "True / False" },
  { value: "matching", label: "Matching" },
  { value: "assertion_reason", label: "Assertion-Reason" },
  { value: "comprehension", label: "Comprehension" },
  { value: "drag_drop", label: "Drag and Drop" },
  { value: "image_based", label: "Image Based" },
  { value: "audio_video", label: "Audio / Video" },
  { value: "numerical", label: "Numerical" },
  { value: "matrix_match", label: "Matrix Match" },
];

const typeLabels: Record<QuestionType, string> = Object.fromEntries(
  QUESTION_TYPES.map((t) => [t.value, t.label]),
) as Record<QuestionType, string>;

function SectionWiseView({
  data,
  loading,
  typeLabels,
  onEdit,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkDelete,
}: {
  data?: {
    sections: {
      name: string;
      questions: Question[];
    }[];
    unassigned: Question[];
  };
  loading: boolean;
  typeLabels: Record<QuestionType, string>;
  onEdit: (q: Question) => void;
  onDelete: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[], checked: boolean) => void;
  onBulkDelete: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || (data.sections.length === 0 && data.unassigned.length === 0)) {
    return (
      <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
        No questions found. Upload questions with Excel tabs to see section-wise
        grouping.
      </div>
    );
  }

  const allQuestionIds = [
    ...data.sections.flatMap((s) => s.questions.map((q) => q.id)),
    ...data.unassigned.map((q) => q.id),
  ];
  const allSelected =
    allQuestionIds.length > 0 &&
    allQuestionIds.every((id) => selectedIds.has(id));
  const someSelected = allQuestionIds.some((id) => selectedIds.has(id));

  const renderQuestionRow = (q: Question, i: number) => {
    const contentText = (q.contentJson?.text as string) ?? "";
    return (
      <TableRow key={q.id}>
        <TableCell className="w-10">
          <input
            type="checkbox"
            checked={selectedIds.has(q.id)}
            onChange={() => onToggleSelect(q.id)}
            className="h-4 w-4 rounded border-input"
          />
        </TableCell>
        <TableCell className="text-xs text-muted-foreground w-8">
          {i + 1}
        </TableCell>
        <TableCell className="max-w-md">
          <p className="text-sm line-clamp-2">{contentText}</p>
          {q.options && q.options.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {q.options.length} option(s)
            </p>
          )}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-xs">
            {typeLabels[q.type] ?? q.type}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {(q.tags ?? []).slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {(q.tags ?? []).length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{(q.tags ?? []).length - 2}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(q)}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(q.id)}
              title="Delete"
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const sectionCheckboxHeader = (ids: string[]) => {
    const allSectionSelected =
      ids.length > 0 && ids.every((id) => selectedIds.has(id));
    return (
      <input
        type="checkbox"
        checked={allSectionSelected}
        onChange={(e) => onToggleSelectAll(ids, e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
    );
  };

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5">
          <span className="text-sm font-medium text-red-700">
            {selectedIds.size} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={onBulkDelete}
            className="ml-auto"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete Selected ({selectedIds.size})
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={(e) => onToggleSelectAll(allQuestionIds, e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <span className="text-xs text-muted-foreground">
          Select all ({allQuestionIds.length})
        </span>
      </div>

      {data.sections.map((section) => {
        const sectionIds = section.questions.map((q) => q.id);
        return (
          <div
            key={section.name}
            className="rounded-md border border-border overflow-hidden"
          >
            <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {sectionCheckboxHeader(sectionIds)}
                <span className="font-semibold text-sm">{section.name}</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {section.questions.length} question(s)
              </Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="w-32">Tags</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.questions.map((q, i) => renderQuestionRow(q, i))}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {data.unassigned.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {sectionCheckboxHeader(data.unassigned.map((q) => q.id))}
              <span className="font-medium text-sm">
                Questions without a section
              </span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {data.unassigned.length} question(s)
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-32">Tags</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unassigned.map((q, i) => renderQuestionRow(q, i))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function QuestionsPage({
  subjectId: propSubjectId,
  batchId,
  hideHeader: _hideHeader,
  onBack,
}: {
  subjectId?: string;
  batchId?: string;
  hideHeader?: boolean;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    subjectId: propSubjectId || "",
    type: "",
  });
  useEffect(() => {
    if (propSubjectId) {
      setCreateForm((f) => ({ ...f, subjectId: propSubjectId }));
      setImportSubjectId(propSubjectId);
    }
  }, [propSubjectId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createExamOpen, setCreateExamOpen] = useState(false);
  const [examForm, setExamForm] = useState({
    name: "",
    code: "",
    description: "",
    durationMinutes: "180",
    totalMarks: "100",
    selectionStrategy: "static" as SelectionStrategy,
    navigationMode: "free" as NavigationMode,
    shuffleQuestions: false,
    shuffleOptions: false,
    scheduledStartDate: "",
    scheduledStartTime: "",
  });
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSubjectId, setImportSubjectId] = useState(propSubjectId || "");
  const [createForm, setCreateForm] = useState({
    subjectId: propSubjectId || "",
    type: "mcq_single" as QuestionType,
    contentText: "",
    option1: "",
    option2: "",
    option3: "",
    option4: "",
    correctOption: "1",
    correctOptions: [] as string[],
    solutionText: "",
    tags: "",
  });

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects", "all"],
    queryFn: () => subjectsService.list({ page: 1, pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: sectionData, isLoading: sectionLoading } = useQuery({
    queryKey: [
      "questions",
      "section-wise",
      propSubjectId || filters.subjectId,
      batchId,
    ],
    queryFn: () =>
      questionsService.sectionWise(propSubjectId || filters.subjectId, batchId),
    enabled: !!(propSubjectId || filters.subjectId),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const f = createForm;
      const input: CreateQuestionInput = {
        subjectId: f.subjectId,
        type: f.type,
        content: { text: f.contentText },
        tags: f.tags
          ? f.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      };
      if (
        f.type === "mcq_single" ||
        f.type === "mcq_multiple" ||
        f.type === "true_false"
      ) {
        const isMultiple = f.type === "mcq_multiple";
        const correctIdx = parseInt(f.correctOption);
        input.options = [
          {
            text: f.option1,
            isCorrect: isMultiple
              ? f.correctOptions.includes("1")
              : correctIdx === 1,
            displayOrder: 1,
          },
          {
            text: f.option2,
            isCorrect: isMultiple
              ? f.correctOptions.includes("2")
              : correctIdx === 2,
            displayOrder: 2,
          },
          {
            text: f.option3,
            isCorrect: isMultiple
              ? f.correctOptions.includes("3")
              : correctIdx === 3,
            displayOrder: 3,
          },
          {
            text: f.option4,
            isCorrect: isMultiple
              ? f.correctOptions.includes("4")
              : correctIdx === 4,
            displayOrder: 4,
          },
        ].filter((o) => o.text);
      }
      if (f.solutionText) {
        input.solution = { text: f.solutionText };
      }
      return questionsService.create(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      toast.success("Question created successfully");
      setCreateOpen(false);
    },
    onError: () => toast.error("Failed to create question"),
  });

  const createExamMutation = useMutation({
    mutationFn: async () => {
      const selectedSubjectId = filters.subjectId || propSubjectId || "";
      const input: CreateExamInput = {
        subjectId: selectedSubjectId || undefined,
        batchId: batchId || undefined,
        name: examForm.name,
        code: examForm.code,
        description: examForm.description || undefined,
        durationMinutes: parseInt(examForm.durationMinutes) || 60,
        totalMarks: parseFloat(examForm.totalMarks) || 0,
        selectionStrategy: examForm.selectionStrategy,
        navigationMode: examForm.navigationMode,
        shuffleQuestions: examForm.shuffleQuestions,
        shuffleOptions: examForm.shuffleOptions,
        scheduledStartAt:
          examForm.scheduledStartDate && examForm.scheduledStartTime
            ? new Date(
                `${examForm.scheduledStartDate}T${examForm.scheduledStartTime}`,
              ).toISOString()
            : undefined,
      };
      return examsService.create(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast.success("Exam created successfully");
      setCreateExamOpen(false);
      setExamForm({
        name: "",
        code: "",
        description: "",
        durationMinutes: "180",
        totalMarks: "100",
        selectionStrategy: "static" as SelectionStrategy,
        navigationMode: "free" as NavigationMode,
        shuffleQuestions: false,
        shuffleOptions: false,
        scheduledStartDate: "",
        scheduledStartTime: "",
      });
    },
    onError: () => toast.error("Failed to create exam"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => questionsService.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      toast.success("Question deleted");
    },
    onError: () => toast.error("Failed to delete question"),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: "",
    type: "mcq_single" as QuestionType,
    contentText: "",
    option1: "",
    option2: "",
    option3: "",
    option4: "",
    correctOption: "1",
    correctOptions: [] as string[],
    solutionText: "",
    tags: "",
  });

  // Bulk Delete States
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sectionSelectedIds, setSectionSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [sectionBulkDeleteConfirmOpen, setSectionBulkDeleteConfirmOpen] =
    useState(false);

  const openEditDialog = (q: Question) => {
    const content = q.contentJson as Record<string, unknown>;
    const text = (content?.text as string) ?? "";
    const solution = q.solutionJson as Record<string, unknown> | null;
    const solutionText = (solution?.text as string) ?? "";
    const opts = q.options ?? [];
    const correctOpts = opts.filter((o) => o.isCorrect);
    setEditForm({
      id: q.id,
      type: q.type,
      contentText: text,
      option1: opts[0]?.optionText ?? "",
      option2: opts[1]?.optionText ?? "",
      option3: opts[2]?.optionText ?? "",
      option4: opts[3]?.optionText ?? "",
      correctOption: correctOpts[0] ? String(correctOpts[0].displayOrder) : "1",
      correctOptions: correctOpts.map((o) => String(o.displayOrder)),
      solutionText,
      tags: (q.tags ?? []).join(", "),
    });
    setEditOpen(true);
  };

  const editMutation = useMutation({
    mutationFn: () => {
      const f = editForm;
      const input: Partial<CreateQuestionInput> = {
        type: f.type,
        content: { text: f.contentText },
        tags: f.tags
          ? f.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      };
      if (
        f.type === "mcq_single" ||
        f.type === "mcq_multiple" ||
        f.type === "true_false"
      ) {
        const isMultiple = f.type === "mcq_multiple";
        input.options = [
          {
            text: f.option1,
            isCorrect: isMultiple
              ? f.correctOptions.includes("1")
              : f.correctOption === "1",
            displayOrder: 1,
          },
          {
            text: f.option2,
            isCorrect: isMultiple
              ? f.correctOptions.includes("2")
              : f.correctOption === "2",
            displayOrder: 2,
          },
          {
            text: f.option3,
            isCorrect: isMultiple
              ? f.correctOptions.includes("3")
              : f.correctOption === "3",
            displayOrder: 3,
          },
          {
            text: f.option4,
            isCorrect: isMultiple
              ? f.correctOptions.includes("4")
              : f.correctOption === "4",
            displayOrder: 4,
          },
        ].filter((o) => o.text);
      }
      if (f.solutionText) {
        input.solution = { text: f.solutionText };
      }
      return questionsService.update(f.id, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      toast.success("Question updated successfully");
      setEditOpen(false);
    },
    onError: () => toast.error("Failed to update question"),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!importFile || !importSubjectId)
        throw new Error("Missing file or subject");
      if (importFile.name.toLowerCase().endsWith(".zip")) {
        return questionsService.importZip(importFile, importSubjectId);
      }
      return questionsService.import(importFile, importSubjectId);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      toast.success(
        `Imported ${res.imported}/${res.total} questions${res.failed > 0 ? `, ${res.failed} failed` : ""}`,
      );
      if (res.errors && res.errors.length > 0) {
        console.warn("Import errors:", res.errors);
      }
      setImportOpen(false);
      setImportFile(null);
    },
    onError: () => toast.error("Import failed"),
  });

  const handleSectionBulkDelete = async () => {
    if (sectionSelectedIds.size === 0) return;
    setBulkDeleting(true);
    const selectedIds = [...sectionSelectedIds];
    setSectionSelectedIds(new Set());
    setSectionBulkDeleteConfirmOpen(false);
    try {
      await questionsService.bulkDelete(selectedIds);
      toast.success(`Successfully deleted ${selectedIds.length} question(s)`);
      queryClient.invalidateQueries({ queryKey: ["questions"] });
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error ?? "Failed to delete questions";
      toast.error(typeof msg === "string" ? msg : "Failed to delete questions");
    } finally {
      setBulkDeleting(false);
    }
  };

  const showOptions = ["mcq_single", "mcq_multiple", "true_false"].includes(
    createForm.type,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search questions..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              className="pl-9 h-9 text-xs"
            />
          </div>
          {!propSubjectId && (
            <select
              value={filters.subjectId}
              onChange={(e) => {
                setFilters((f) => ({ ...f, subjectId: e.target.value }));
              }}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-xs"
            >
              <option value="">All Subjects</option>
              {(subjectsData?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative z-20">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTemplateMenuOpen((v) => !v)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download Template
            </Button>
            {templateMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-md w-48">
                <button
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    setTemplateMenuOpen(false);
                    questionsService.downloadTemplate().then((blob) => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "question-upload-template.xlsx";
                      a.click();
                      URL.revokeObjectURL(url);
                    });
                  }}
                >
                  Excel Template (.xlsx)
                </button>
                <button
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    setTemplateMenuOpen(false);
                    questionsService.downloadZipTemplate().then((blob) => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "question-upload-template.zip";
                      a.click();
                      URL.revokeObjectURL(url);
                    });
                  }}
                >
                  ZIP Template (.zip)
                </button>
              </div>
            )}
          </div>
          {batchId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateExamOpen(true)}
              disabled={!filters.subjectId && !propSubjectId}
              title={
                !filters.subjectId && !propSubjectId
                  ? "Select a subject first"
                  : "Create exam (question paper) from this subject"
              }
            >
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
              Create Exam
            </Button>
          )}
          <div className="relative z-20">
            <Button size="sm" onClick={() => setAddMenuOpen((v) => !v)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Question
            </Button>
            {addMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-md w-44">
                <button
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  Single Upload
                </button>
                <button
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setImportOpen(true);
                  }}
                >
                  Bulk Upload
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <SectionWiseView
        data={sectionData}
        loading={sectionLoading}
        typeLabels={typeLabels}
        onEdit={openEditDialog}
        onDelete={(id) => deleteMutation.mutate(id)}
        selectedIds={sectionSelectedIds}
        onToggleSelect={(id) =>
          setSectionSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleSelectAll={(ids, checked) =>
          setSectionSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) ids.forEach((id) => next.add(id));
            else ids.forEach((id) => next.delete(id));
            return next;
          })
        }
        onBulkDelete={() => setSectionBulkDeleteConfirmOpen(true)}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Question</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!propSubjectId && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <select
                  value={createForm.subjectId}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, subjectId: e.target.value }))
                  }
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
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <select
                  value={createForm.type}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      type: e.target.value as QuestionType,
                    }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Question Text</Label>
              <textarea
                value={createForm.contentText}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, contentText: e.target.value }))
                }
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Enter the question..."
              />
            </div>
            {showOptions && (
              <div className="space-y-2">
                <Label>
                  Options (select correct answer
                  {createForm.type === "mcq_multiple" ? "s" : ""})
                </Label>
                {[1, 2, 3, 4].map((idx) => {
                  const isMultiple = createForm.type === "mcq_multiple";
                  const isChecked = isMultiple
                    ? createForm.correctOptions.includes(String(idx))
                    : createForm.correctOption === String(idx);
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type={isMultiple ? "checkbox" : "radio"}
                        name="correctOption"
                        checked={isChecked}
                        onChange={(e) => {
                          if (isMultiple) {
                            setCreateForm((f) => ({
                              ...f,
                              correctOptions: e.target.checked
                                ? [...f.correctOptions, String(idx)]
                                : f.correctOptions.filter(
                                    (c) => c !== String(idx),
                                  ),
                            }));
                          } else {
                            setCreateForm((f) => ({
                              ...f,
                              correctOption: String(idx),
                            }));
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <Input
                        value={
                          createForm[
                            `option${idx}` as keyof typeof createForm
                          ] as string
                        }
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            [`option${idx}`]: e.target.value,
                          }))
                        }
                        placeholder={`Option ${idx}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="space-y-2">
              <Label>Solution / Explanation (optional)</Label>
              <textarea
                value={createForm.solutionText}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, solutionText: e.target.value }))
                }
                rows={2}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Enter solution or explanation..."
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={createForm.tags}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, tags: e.target.value }))
                }
                placeholder="e.g. algebra, calculus, derivatives"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !createForm.subjectId ||
                !createForm.contentText
              }
            >
              {createMutation.isPending ? "Creating..." : "Create Question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {batchId && (
        <Dialog open={createExamOpen} onOpenChange={setCreateExamOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Exam (Question Paper)</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label>Subject</Label>
                <p className="text-sm text-muted-foreground">
                  {(subjectsData?.data ?? []).find(
                    (s) => s.id === (filters.subjectId || propSubjectId),
                  )?.name ?? "Select a subject in the filter above"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="exam-name">Exam Name</Label>
                  <Input
                    id="exam-name"
                    value={examForm.name}
                    onChange={(e) =>
                      setExamForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. Physics Mock Test 1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam-code">Code</Label>
                  <Input
                    id="exam-code"
                    value={examForm.code}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. PHY-MOCK-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exam-desc">Description (optional)</Label>
                <Input
                  id="exam-desc"
                  value={examForm.description}
                  onChange={(e) =>
                    setExamForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="exam-duration">Duration (minutes)</Label>
                  <Input
                    id="exam-duration"
                    type="number"
                    value={examForm.durationMinutes}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        durationMinutes: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam-marks">Total Marks</Label>
                  <Input
                    id="exam-marks"
                    type="number"
                    step="0.5"
                    value={examForm.totalMarks}
                    onChange={(e) =>
                      setExamForm((f) => ({ ...f, totalMarks: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="exam-strategy">Selection Strategy</Label>
                  <select
                    id="exam-strategy"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    value={examForm.selectionStrategy}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        selectionStrategy: e.target.value as SelectionStrategy,
                      }))
                    }
                  >
                    <option value="static">Static (fixed questions)</option>
                    <option value="random">Random (from pool)</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exam-nav">Navigation Mode</Label>
                <select
                  id="exam-nav"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={examForm.navigationMode}
                  onChange={(e) =>
                    setExamForm((f) => ({
                      ...f,
                      navigationMode: e.target.value as NavigationMode,
                    }))
                  }
                >
                  <option value="free">Free (any order)</option>
                  <option value="linear">Linear (sequential)</option>
                  <option value="section_free">Section-wise free</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="exam-start-date">Exam Date</Label>
                  <Input
                    id="exam-start-date"
                    type="date"
                    value={examForm.scheduledStartDate}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        scheduledStartDate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam-start-time">Exam Time</Label>
                  <Input
                    id="exam-start-time"
                    type="time"
                    value={examForm.scheduledStartTime}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        scheduledStartTime: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                When the exam is scheduled to start (for display purposes only)
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={examForm.shuffleQuestions}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        shuffleQuestions: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  Shuffle Questions
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={examForm.shuffleOptions}
                    onChange={(e) =>
                      setExamForm((f) => ({
                        ...f,
                        shuffleOptions: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  Shuffle Options
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateExamOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createExamMutation.mutate()}
                disabled={
                  createExamMutation.isPending ||
                  !examForm.name ||
                  !examForm.code
                }
              >
                {createExamMutation.isPending ? "Creating..." : "Create Exam"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Upload Questions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!propSubjectId && (
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
            )}
            <div className="space-y-2">
              <Label>File (JSON, Excel .xlsx, or ZIP .zip)</Label>
              <input
                type="file"
                accept=".json,.xlsx,.xls,.zip"
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
              <p className="font-medium text-foreground">Supported formats:</p>
              <ul className="mt-1 space-y-0.5">
                <li>
                  <b>ZIP</b> (recommended): Excel + images folder bundled
                  together. Columns: Question Text, Question Image, Type, Option
                  1-6, Option 1-6 Image, Correct Options, Solution, Explanation,
                  Tags
                </li>
                <li>
                  <b>JSON</b>: Array of questions or {"{ questions: [...] }"}
                </li>
                <li>
                  <b>Excel</b>: Same columns as ZIP but without image support
                </li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={
                importMutation.isPending || !importFile || !importSubjectId
              }
            >
              {importMutation.isPending ? "Importing..." : "Import Questions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <select
                  value={editForm.type}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      type: e.target.value as QuestionType,
                    }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Question Text</Label>
              <textarea
                value={editForm.contentText}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, contentText: e.target.value }))
                }
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Enter the question..."
              />
            </div>
            {["mcq_single", "mcq_multiple", "true_false"].includes(
              editForm.type,
            ) && (
              <div className="space-y-2">
                <Label>
                  Options (select correct answer
                  {editForm.type === "mcq_multiple" ? "s" : ""})
                </Label>
                {[1, 2, 3, 4].map((idx) => {
                  const isMultiple = editForm.type === "mcq_multiple";
                  const isChecked = isMultiple
                    ? editForm.correctOptions.includes(String(idx))
                    : editForm.correctOption === String(idx);
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type={isMultiple ? "checkbox" : "radio"}
                        name="editCorrectOption"
                        checked={isChecked}
                        onChange={(e) => {
                          if (isMultiple) {
                            setEditForm((f) => ({
                              ...f,
                              correctOptions: e.target.checked
                                ? [...f.correctOptions, String(idx)]
                                : f.correctOptions.filter(
                                    (c) => c !== String(idx),
                                  ),
                            }));
                          } else {
                            setEditForm((f) => ({
                              ...f,
                              correctOption: String(idx),
                            }));
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <Input
                        value={
                          editForm[
                            `option${idx}` as keyof typeof editForm
                          ] as string
                        }
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            [`option${idx}`]: e.target.value,
                          }))
                        }
                        placeholder={`Option ${idx}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="space-y-2">
              <Label>Solution / Explanation (optional)</Label>
              <textarea
                value={editForm.solutionText}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, solutionText: e.target.value }))
                }
                rows={2}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Enter solution or explanation..."
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={editForm.tags}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, tags: e.target.value }))
                }
                placeholder="e.g. algebra, calculus, derivatives"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending || !editForm.contentText}
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section View Bulk Delete Confirm Dialog */}
      <Dialog
        open={sectionBulkDeleteConfirmOpen}
        onOpenChange={setSectionBulkDeleteConfirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-500">
              Confirm Bulk Delete
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete{" "}
              <span className="font-bold text-foreground">
                {sectionSelectedIds.size}
              </span>{" "}
              selected question(s)? This action cannot be undone. All related
              data (options, tags, versions, exam references, answers) will be
              permanently removed.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSectionBulkDeleteConfirmOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSectionBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
