import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type SortingState,
} from "@tanstack/react-table";
import {
    AlertTriangle,
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Eye,
    Loader2,
    Monitor,
    Pencil,
    Play,
    Search,
    Square,
    Trash2,
    UserX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { Textarea } from "../components/ui/textarea";
import { candidateService } from "../services/candidates";
import { examBatchService } from "../services/exam-batches";
import { examsService } from "../services/exams";
import type {
    CheckConflictsResponse,
    ConflictingCandidate,
    Exam,
    UpdateExamInput,
} from "../types";

const columns: ColumnDef<Exam>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue("name")}</span>
    ),
  },
  {
    id: "batchName",
    header: "Batch",
    cell: ({ row }) => row.original.batchName ?? "—",
  },
  {
    accessorKey: "durationMinutes",
    header: "Duration",
    cell: ({ row }) => {
      const mins = row.getValue("durationMinutes") as number;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    },
  },
  {
    accessorKey: "totalMarks",
    header: "Total Marks",
    cell: ({ row }) => row.getValue("totalMarks"),
  },
  {
    accessorKey: "scheduledStartAt",
    header: "Exam Date",
    cell: ({ row }) => {
      const val = row.getValue("scheduledStartAt") as string | null | undefined;
      if (!val) return "—";
      const d = new Date(val);
      return (
        <span className="text-sm">
          {d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}{" "}
          {d.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      );
    },
  },
];

export default function ExamsListPage({
  institutionId,
  hideHeader: _hideHeader,
  onBack,
}: {
  institutionId?: string;
  hideHeader?: boolean;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  // Debounce search to avoid firing API calls on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  const [stoppingExamId, setStoppingExamId] = useState<string | null>(null);
  const [stopConfirmExam, setStopConfirmExam] = useState<Exam | null>(null);
  const [conflictData, setConflictData] =
    useState<CheckConflictsResponse | null>(null);
  const [conflictExamName, setConflictExamName] = useState<string>("");
  const [conflictBatchId, setConflictBatchId] = useState<string | null>(null);
  const [resolvingConflicts, setResolvingConflicts] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["exams", debouncedSearch, page, institutionId],
    queryFn: () =>
      examsService.list({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        institutionId: institutionId || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  // Fetch exam batches to know which exams are running
  const examBatchMap =
    useQuery({
      queryKey: ["exam-batches", "for-exams-table", institutionId],
      queryFn: () => examBatchService.list({ pageSize: 100 }),
      select: (resp) => {
        const obj: Record<string, { id: string; status: string }> = {};
        for (const b of resp.data ?? []) {
          if (!obj[b.examId]) {
            obj[b.examId] = { id: b.id, status: b.status };
          }
        }
        return obj;
      },
    }).data ?? {};

  const stopExamMutation = useMutation({
    mutationFn: async (examId: string) => {
      const batch = examBatchMap[examId];
      if (!batch) throw new Error("No active batch found");
      await examBatchService.finish(batch.id);
      return batch.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-batches"] });
      toast.success("Exam stopped successfully");
      setStoppingExamId(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to stop exam");
      setStoppingExamId(null);
    },
  });

  const isStoppingForConfirm =
    !!stopConfirmExam &&
    stoppingExamId === stopConfirmExam.id &&
    stopExamMutation.isPending;

  const [startingExamId, setStartingExamId] = useState<string | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [editForm, setEditForm] = useState<
    UpdateExamInput & {
      scheduledStartDate?: string;
      scheduledStartTime?: string;
    }
  >({});

  const updateExamMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateExamInput }) => {
      return examsService.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast.success("Exam updated successfully");
      setEditingExam(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to update exam");
    },
  });

  const openEditDialog = useCallback((exam: Exam) => {
    const d = exam.scheduledStartAt ? new Date(exam.scheduledStartAt) : null;
    setEditForm({
      name: exam.name,
      code: exam.code,
      description: exam.description ?? "",
      durationMinutes: exam.durationMinutes,
      totalMarks: Number(exam.totalMarks),
      selectionStrategy: exam.selectionStrategy,
      navigationMode: exam.navigationMode,
      shuffleQuestions: exam.shuffleQuestions,
      shuffleOptions: exam.shuffleOptions,
      resultVisibility: exam.resultVisibility,
      scheduledStartDate: d ? d.toISOString().split("T")[0] : "",
      scheduledStartTime: d ? d.toTimeString().slice(0, 5) : "",
    });
    setEditingExam(exam);
  }, []);

  const handleSaveEdit = () => {
    if (!editingExam) return;
    const { scheduledStartDate, scheduledStartTime, ...rest } = editForm;
    const payload: UpdateExamInput = { ...rest };
    if (scheduledStartDate && scheduledStartTime) {
      payload.scheduledStartAt = new Date(
        `${scheduledStartDate}T${scheduledStartTime}`,
      ).toISOString();
    } else {
      payload.scheduledStartAt = null;
    }
    updateExamMutation.mutate({ id: editingExam.id, data: payload });
  };

  const [deletingExam, setDeletingExam] = useState<Exam | null>(null);

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return examsService.permanentDelete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["exam-batches"] });
      toast.success("Exam permanently deleted");
      setDeletingExam(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to delete exam");
      setDeletingExam(null);
    },
  });

  const startExamMutation = useMutation({
    mutationFn: async (exam: Exam) => {
      setStartingExamId(exam.id);
      const { data: batches } = await examBatchService.list({
        examId: exam.id,
        pageSize: 100,
      });
      // Prefer a draft batch to start; fall back to first batch
      const draftBatch = batches?.find((b) => b.status === "draft");
      let batchId = draftBatch?.id ?? batches?.[0]?.id;
      if (!batchId) {
        const now = new Date();
        const end = new Date(now.getTime() + exam.durationMinutes * 60 * 1000);
        const created = await examBatchService.create({
          examId: exam.id,
          batchId: exam.batchId ?? undefined,
          name: `${exam.name}`,
          scheduledStartAt: now.toISOString(),
          scheduledEndAt: end.toISOString(),
        });
        batchId = created.id;
      }

      // Fetch candidates assigned to this exam batch
      const { data: batchCandidates } =
        await examBatchService.listCandidates(batchId);

      let candidateIds = batchCandidates?.map((c) => c.candidateId) ?? [];

      // If no candidates in exam batch yet, try to get them from the org batch
      // (they'll be auto-populated on activation)
      if (candidateIds.length === 0 && exam.batchId) {
        const { data: orgCandidates } = await candidateService.list({
          batchId: exam.batchId,
          pageSize: 100,
        });
        candidateIds = (orgCandidates ?? []).map((c) => c.id);
      }

      if (candidateIds.length > 0) {
        // Check for scheduling conflicts
        const conflicts = await examBatchService.checkConflicts(batchId, {
          candidateIds,
        });

        if (conflicts.hasConflicts) {
          // Return conflict data to show modal — don't activate yet
          return {
            batchId,
            conflicts,
            examName: exam.name,
          };
        }
      }

      // No conflicts — activate directly
      await examBatchService.activate(batchId);
      return { batchId, conflicts: null, examName: exam.name };
    },
    onSuccess: (result) => {
      if (result.conflicts && result.conflicts.hasConflicts) {
        // Show conflict modal instead of activating
        setConflictData(result.conflicts);
        setConflictExamName(result.examName);
        setConflictBatchId(result.batchId);
        setStartingExamId(null);
      } else {
        queryClient.invalidateQueries({ queryKey: ["exam-batches"] });
        toast.success("Exam started successfully");
        setStartingExamId(null);
      }
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to start exam");
      setStartingExamId(null);
    },
  });

  const tableData = useMemo(() => data?.data ?? [], [data]);

  // Use refs for frequently-changing values to keep tableColumns stable
  const startingExamIdRef = useRef(startingExamId);
  const stoppingExamIdRef = useRef(stoppingExamId);
  startingExamIdRef.current = startingExamId;
  stoppingExamIdRef.current = stoppingExamId;

  const startMutate = useCallback(
    (exam: Exam) => startExamMutation.mutate(exam),
    // mutate is stable from useMutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const stopMutate = useCallback(
    (examId: string) => stopExamMutation.mutate(examId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const handleSetDeletingExam = useCallback(
    (exam: Exam) => setDeletingExam(exam),
    [],
  );

  const tableColumns = useMemo(() => {
    const cols = [...columns];
    cols.push({
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const exam = row.original;
        const batch = examBatchMap[exam.id];
        const batchStatus = batch?.status;
        const scheduledStartAt = exam.scheduledStartAt
          ? new Date(exam.scheduledStartAt)
          : null;
        const now = new Date();

        let label = "Draft";
        let className = "bg-gray-100 text-gray-700 border-gray-300";

        if (
          batchStatus === "active" ||
          batchStatus === "published" ||
          batchStatus === "paused" ||
          batchStatus === "submission_window"
        ) {
          label = "Ongoing";
          className = "bg-green-100 text-green-700 border-green-400";
        } else if (
          batchStatus === "finished" ||
          batchStatus === "results_published" ||
          batchStatus === "archived"
        ) {
          label = "Completed";
          className = "bg-blue-100 text-blue-700 border-blue-400";
        } else if (scheduledStartAt && scheduledStartAt > now) {
          label = "Upcoming";
          className = "bg-yellow-100 text-yellow-700 border-yellow-400";
        } else if (scheduledStartAt && scheduledStartAt <= now) {
          label = "Time Passed";
          className = "bg-orange-100 text-orange-700 border-orange-400";
        } else if (!exam.isActive) {
          label = "Disabled";
          className = "bg-red-100 text-red-700 border-red-400";
        }

        return (
          <Badge variant="outline" className={className}>
            {label}
          </Badge>
        );
      },
    });
    cols.push({
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const exam = row.original;
        const isStarting = startingExamIdRef.current === exam.id;
        const isStopping = stoppingExamIdRef.current === exam.id;
        const batch = examBatchMap[exam.id];
        const isRunning =
          batch && (batch.status === "active" || batch.status === "published");
        const isCompleted =
          batch &&
          (batch.status === "finished" ||
            batch.status === "results_published" ||
            batch.status === "archived");

        return (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(`/exams/${exam.id}`, {
                  state: { from: location.pathname, folder: "exams" },
                })
              }
              title="View exam details"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openEditDialog(exam)}
              disabled={isCompleted}
              title={
                isCompleted ? "Exam completed - editing disabled" : "Edit exam"
              }
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/live-monitor")}
              title="Live monitor"
              className={
                isRunning
                  ? "border-green-500 text-green-600 hover:bg-green-50"
                  : ""
              }
            >
              <Monitor className="h-4 w-4" />
            </Button>
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStopConfirmExam(exam);
                }}
                disabled={isStopping}
                className="w-[80px]"
                title="Stop exam"
              >
                <Square className="mr-1 h-4 w-4" />
                {isStopping ? "Stopping" : "Stop"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startMutate(exam)}
                disabled={isStarting || isCompleted}
                className="w-[80px]"
                title={isCompleted ? "Exam already completed" : "Start exam"}
              >
                <Play className="mr-1 h-4 w-4" />
                {isStarting ? "Starting..." : "Start"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSetDeletingExam(exam)}
              title={isRunning ? "Cannot delete a running exam" : "Delete exam"}
              disabled={isRunning}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    });
    return cols;
  }, [
    startMutate,
    stopMutate,
    examBatchMap,
    navigate,
    openEditDialog,
    handleSetDeletingExam,
  ]);

  const table = useReactTable({
    data: tableData,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
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
              placeholder="Search exams..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              className="pl-9 h-9 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
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
                  colSpan={tableColumns.length}
                  className="h-24 text-center"
                >
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            ) : tableData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={tableColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No exams found
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Total: {data?.total ?? 0} exams
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="text-sm">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <Dialog
        open={!!editingExam}
        onOpenChange={(open) => !open && setEditingExam(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Exam — {editingExam?.name}</DialogTitle>
          </DialogHeader>
          {editingExam && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Exam Name</Label>
                  <Input
                    id="edit-name"
                    value={editForm.name ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-code">Exam Code</Label>
                  <Input
                    id="edit-code"
                    value={editForm.code ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, code: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editForm.description ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-duration">Duration (minutes)</Label>
                  <Input
                    id="edit-duration"
                    type="number"
                    value={editForm.durationMinutes ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        durationMinutes: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-total-marks">Total Marks</Label>
                  <Input
                    id="edit-total-marks"
                    type="number"
                    value={editForm.totalMarks ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        totalMarks: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-start-date">Exam Date</Label>
                  <Input
                    id="edit-start-date"
                    type="date"
                    value={editForm.scheduledStartDate ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        scheduledStartDate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-start-time">Exam Time</Label>
                  <Input
                    id="edit-start-time"
                    type="time"
                    value={editForm.scheduledStartTime ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        scheduledStartTime: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-strategy">Selection Strategy</Label>
                  <select
                    id="edit-strategy"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={editForm.selectionStrategy ?? "all"}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        selectionStrategy: e.target
                          .value as UpdateExamInput["selectionStrategy"],
                      }))
                    }
                  >
                    <option value="all">All Questions</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-nav-mode">Navigation Mode</Label>
                  <select
                    id="edit-nav-mode"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={editForm.navigationMode ?? "free"}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        navigationMode: e.target
                          .value as UpdateExamInput["navigationMode"],
                      }))
                    }
                  >
                    <option value="free">Free Navigation</option>
                    <option value="linear">Linear</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-shuffle-q"
                    checked={editForm.shuffleQuestions ?? false}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        shuffleQuestions: e.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <Label htmlFor="edit-shuffle-q">Shuffle Questions</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-shuffle-o"
                    checked={editForm.shuffleOptions ?? false}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        shuffleOptions: e.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <Label htmlFor="edit-shuffle-o">Shuffle Options</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingExam(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateExamMutation.isPending}
            >
              {updateExamMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deletingExam}
        onOpenChange={(open) => !open && setDeletingExam(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Exam Permanently</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <span className="font-semibold text-foreground">
              {deletingExam?.name}
            </span>
            ? This will remove all associated sections, questions, batches,
            attempts, and related data. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingExam(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deletingExam && permanentDeleteMutation.mutate(deletingExam.id)
              }
              disabled={permanentDeleteMutation.isPending}
            >
              {permanentDeleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stop Exam Confirmation */}
      <Dialog
        open={!!stopConfirmExam}
        onOpenChange={(open) => !open && setStopConfirmExam(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Stop Exam
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to stop the exam{" "}
              <span className="font-semibold text-foreground">
                {stopConfirmExam?.name}
              </span>{" "}
              and end it immediately?
            </p>
            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
              <p className="text-sm text-red-800 dark:text-red-200">
                <span className="font-semibold">Warning:</span> This action
                cannot be undone. All active candidate sessions will be
                terminated immediately and unsubmitted answers will be lost.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopConfirmExam(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (stopConfirmExam) {
                  setStoppingExamId(stopConfirmExam.id);
                  stopExamMutation.mutate(stopConfirmExam.id);
                  setStopConfirmExam(null);
                }
              }}
              disabled={isStoppingForConfirm}
            >
              {isStoppingForConfirm ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Stopping...
                </>
              ) : (
                "Yes, Stop Exam"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scheduling Conflict Modal */}
      <Dialog
        open={!!conflictData}
        onOpenChange={(open) => {
          if (!open) {
            setConflictData(null);
            setConflictExamName("");
            setConflictBatchId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Scheduling Conflict Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The following candidates are already assigned to another exam with
              an overlapping time window for{" "}
              <span className="font-semibold text-foreground">
                {conflictExamName}
              </span>
              . You can remove them from this exam or proceed anyway.
            </p>
            <div className="space-y-3">
              {conflictData?.conflictingCandidates.map(
                (cc: ConflictingCandidate) => (
                  <div
                    key={cc.candidateId}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {cc.admitCardNumber}
                        {cc.rollNumber && ` • ${cc.rollNumber}`}
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {cc.conflicts.map((c) => (
                        <div
                          key={c.batchId}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">
                            {c.examName}
                          </span>
                          <span>•</span>
                          <span>
                            {new Date(c.startAt).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" — "}
                            {new Date(c.endAt).toLocaleString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {c.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConflictData(null);
                setConflictExamName("");
                setConflictBatchId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resolvingConflicts}
              onClick={async () => {
                if (!conflictData || !conflictBatchId) return;
                setResolvingConflicts(true);
                try {
                  const conflictingIds = conflictData.conflictingCandidates.map(
                    (cc) => cc.candidateId,
                  );
                  await examBatchService.removeCandidates(conflictBatchId, {
                    candidateIds: conflictingIds,
                  });
                  toast.success(
                    `Removed ${conflictingIds.length} conflicting candidate(s)`,
                  );
                  await examBatchService.activate(conflictBatchId);
                  queryClient.invalidateQueries({ queryKey: ["exam-batches"] });
                  toast.success("Exam started successfully");
                  setConflictData(null);
                  setConflictExamName("");
                  setConflictBatchId(null);
                } catch (err: unknown) {
                  const e = err as { response?: { data?: { error?: string } } };
                  toast.error(
                    e.response?.data?.error ?? "Failed to resolve conflicts",
                  );
                } finally {
                  setResolvingConflicts(false);
                }
              }}
            >
              {resolvingConflicts ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resolving...
                </>
              ) : (
                <>
                  <UserX className="mr-2 h-4 w-4" /> Remove & Start
                </>
              )}
            </Button>
            <Button
              disabled={resolvingConflicts}
              onClick={async () => {
                if (!conflictBatchId) return;
                setResolvingConflicts(true);
                try {
                  await examBatchService.activate(conflictBatchId);
                  queryClient.invalidateQueries({ queryKey: ["exam-batches"] });
                  toast.success("Exam started successfully");
                  setConflictData(null);
                  setConflictExamName("");
                  setConflictBatchId(null);
                } catch (err: unknown) {
                  const e = err as { response?: { data?: { error?: string } } };
                  toast.error(
                    e.response?.data?.error ?? "Failed to start exam",
                  );
                } finally {
                  setResolvingConflicts(false);
                }
              }}
            >
              Start Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
