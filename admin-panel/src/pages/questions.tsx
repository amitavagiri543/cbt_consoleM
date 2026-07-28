import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type SortingState,
} from "@tanstack/react-table";
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Download,
    Loader2,
    Pencil,
    Plus,
    Search,
    Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { cn } from "../lib/utils";
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
}: {
  data?: {
    sections: {
      id: string;
      examId: string;
      examName: string;
      name: string;
      sectionOrder: number;
      questions: (Question & {
        examQuestionId: string;
        displayOrder: number;
      })[];
    }[];
    unassigned: Question[];
  };
  loading: boolean;
  typeLabels: Record<QuestionType, string>;
  onEdit: (q: Question) => void;
  onDelete: (id: string) => void;
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
        No questions found in any exam sections for this batch.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.sections.map((section) => (
        <div
          key={section.id}
          className="rounded-md border border-border overflow-hidden"
        >
          <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{section.examName}</span>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium text-sm">{section.name}</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {section.questions.length} question(s)
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-32">Tags</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.questions.map((q, i) => {
                const contentText = (q.contentJson?.text as string) ?? "";
                return (
                  <TableRow key={q.id}>
                    <TableCell className="text-xs text-muted-foreground">
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
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs"
                          >
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
              })}
            </TableBody>
          </Table>
        </div>
      ))}

      {data.unassigned.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between">
            <span className="font-medium text-sm">Unassigned Questions</span>
            <Badge variant="secondary" className="text-xs">
              {data.unassigned.length} question(s)
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-32">Tags</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unassigned.map((q, i) => {
                const contentText = (q.contentJson?.text as string) ?? "";
                return (
                  <TableRow key={q.id}>
                    <TableCell className="text-xs text-muted-foreground">
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
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs"
                          >
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
              })}
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);
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
  const [viewMode, setViewMode] = useState<"flat" | "section">("flat");
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

  const { data, isLoading } = useQuery({
    queryKey: [
      "questions",
      pagination.pageIndex,
      pagination.pageSize,
      debouncedSearch,
      filters,
    ],
    queryFn: () =>
      questionsService.list({
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        search: debouncedSearch || undefined,
        subjectId: filters.subjectId || undefined,
        type: filters.type || undefined,
      }),
    placeholderData: (prev) => prev,
    enabled: viewMode === "flat",
  });

  const { data: sectionData, isLoading: sectionLoading } = useQuery({
    queryKey: [
      "questions",
      "section-wise",
      propSubjectId || filters.subjectId,
      batchId,
    ],
    queryFn: () =>
      questionsService.sectionWise(
        propSubjectId || filters.subjectId,
        batchId!,
      ),
    enabled:
      viewMode === "section" &&
      !!batchId &&
      !!(propSubjectId || filters.subjectId),
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
  const [rowSelection, setRowSelection] = useState({});
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

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

  const tableData = useMemo(() => data?.data ?? [], [data]);

  const columns: ColumnDef<Question>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
          aria-label="Select all"
          className="h-4 w-4 rounded border-border bg-background accent-primary cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(!!e.target.checked)}
          aria-label="Select row"
          className="h-4 w-4 rounded border-border bg-background accent-primary cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "contentJson",
      header: "Question",
      cell: ({ row }) => {
        const content = row.getValue("contentJson") as Record<string, unknown>;
        const text = (content?.text as string) ?? "";
        const opts = row.original.options ?? [];
        const showOptions = [
          "mcq_single",
          "mcq_multiple",
          "true_false",
        ].includes(row.original.type);
        return (
          <div className="max-w-md space-y-1">
            <p className="font-medium">
              {text.length > 80 ? text.slice(0, 80) + "…" : text}
            </p>
            {showOptions && opts.length > 0 && (
              <ul className="ml-4 space-y-0.5 text-xs text-muted-foreground">
                {opts.map((o, i) => (
                  <li
                    key={i}
                    className={
                      o.isCorrect
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : ""
                    }
                  >
                    {String.fromCharCode(65 + i)}) {o.optionText}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("type") as QuestionType;
        return <Badge variant="outline">{typeLabels[type]}</Badge>;
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditDialog(row.original)}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteMutation.mutate(row.original.id)}
            title="Delete"
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, pagination, rowSelection },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / data.pageSize) : -1,
  });

  const handleBulkDelete = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    if (selectedRows.length === 0) return;
    setBulkDeleting(true);
    const selectedIds = selectedRows.map((row) => row.original.id);
    // Clear selection and close dialog immediately to prevent stale state
    setRowSelection({});
    setBulkDeleteConfirmOpen(false);
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
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
              className="pl-9 h-9 text-xs"
            />
          </div>
          {batchId && (propSubjectId || filters.subjectId) && (
            <div className="flex rounded-md border border-input overflow-hidden">
              <button
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "flat"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent hover:bg-accent",
                )}
                onClick={() => setViewMode("flat")}
              >
                Flat View
              </button>
              <button
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors border-l border-input",
                  viewMode === "section"
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent hover:bg-accent",
                )}
                onClick={() => setViewMode("section")}
              >
                Section View
              </button>
            </div>
          )}
          {!propSubjectId && (
            <select
              value={filters.subjectId}
              onChange={(e) => {
                setFilters((f) => ({ ...f, subjectId: e.target.value }));
                setPagination((p) => ({ ...p, pageIndex: 0 }));
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
          {table.getSelectedRowModel().rows.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              className="shadow-sm transition-all animate-in fade-in zoom-in-95 duration-200"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete Selected ({table.getSelectedRowModel().rows.length})
            </Button>
          )}
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

      {viewMode === "section" && batchId ? (
        <SectionWiseView
          data={sectionData}
          loading={sectionLoading}
          typeLabels={typeLabels}
          onEdit={openEditDialog}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      ) : (
        <>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : tableData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No questions found
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data ? `${data.total} total questions` : "Loading..."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm">
                Page {pagination.pageIndex + 1}
                {data ? ` of ${Math.ceil(data.total / data.pageSize)}` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

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

      {/* Bulk Deactivate Confirm Dialog */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
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
                {table.getSelectedRowModel().rows.length}
              </span>{" "}
              selected question(s)? This action cannot be undone. All related
              data (options, tags, versions, exam references, answers) will be
              permanently removed.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteConfirmOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
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
