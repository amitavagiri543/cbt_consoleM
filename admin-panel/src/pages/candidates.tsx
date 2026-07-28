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
    ArrowLeft,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Download,
    FileSpreadsheet,
    Loader2,
    Pencil,
    Plus,
    Search,
    Trash2,
    UserMinus,
    UserPlus,
    Users,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
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
import { candidateService } from "../services/candidates";
import { batchesService } from "../services/organization";

import type {
    BulkImportCandidateRow,
    CandidateListItem,
    UpdateCandidateInput,
} from "../types";

interface CreateFormState {
  email: string;
  fullName: string;
  dateOfBirth: string;
  rollNumber: string;
  admitCardNumber: string;
  phone: string;
  batchId: string;
}

const emptyCreateForm: CreateFormState = {
  email: "",
  fullName: "",
  dateOfBirth: "",
  rollNumber: "",
  admitCardNumber: "",
  phone: "",
  batchId: "",
};

interface EditFormState {
  fullName: string;
  dateOfBirth: string;
  rollNumber: string;
  admitCardNumber: string;
  phone: string;
  batchId: string;
  isActive: boolean;
}

const emptyEditForm: EditFormState = {
  fullName: "",
  dateOfBirth: "",
  rollNumber: "",
  admitCardNumber: "",
  phone: "",
  batchId: "",
  isActive: true,
};

export default function CandidatesPage({
  institutionId,
  batchId,
  hideHeader: _hideHeader,
  onBack,
}: {
  institutionId?: string;
  batchId?: string;
  hideHeader?: boolean;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CandidateListItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CandidateListItem | null>(
    null,
  );
  const [createForm, setCreateForm] =
    useState<CreateFormState>(emptyCreateForm);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEditForm);
  const [bulkBatchId, setBulkBatchId] = useState("");
  const [parsedRows, setParsedRows] = useState<BulkImportCandidateRow[]>([]);
  const [parsedFileName, setParsedFileName] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    new Set(),
  );
  const [removeFromBatchTarget, setRemoveFromBatchTarget] =
    useState<CandidateListItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bulk Delete States
  const [rowSelection, setRowSelection] = useState({});
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: [
      "candidates",
      { page, pageSize, search, institutionId, batchId },
    ],
    queryFn: () =>
      candidateService.list({
        page,
        pageSize,
        search: search || undefined,
        institutionId,
        batchId,
      }),
  });

  const { data: batchesData } = useQuery({
    queryKey: ["batches-list", institutionId],
    queryFn: () => batchesService.list({ pageSize: 100, institutionId }),
  });

  // Fetch institution candidates (not filtered by batch) for assignment
  const { data: institutionCandidates, isLoading: instCandLoading } = useQuery({
    queryKey: ["candidates-institution", institutionId, assignSearch],
    queryFn: () =>
      candidateService.list({
        page: 1,
        pageSize: 100,
        search: assignSearch || undefined,
        institutionId,
      }),
    enabled: !!batchId && assignOpen,
    staleTime: 0,
  });

  const batches = batchesData?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: CreateFormState) =>
      candidateService.create({
        email: data.email,
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth,
        rollNumber: data.rollNumber || undefined,
        admitCardNumber: data.admitCardNumber || undefined,
        phone: data.phone || undefined,
        batchId: null,
        institutionId: institutionId ?? null,
      }),
    onSuccess: () => {
      toast.success("Candidate created successfully");
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      setCreateOpen(false);
      setCreateForm(emptyCreateForm);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to create candidate");
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (vars: { rows: BulkImportCandidateRow[]; batchId: string }) =>
      candidateService.bulkImport({
        batchId: vars.batchId || null,
        institutionId: institutionId ?? null,
        candidates: vars.rows,
      }),
    onSuccess: (res) => {
      toast.success(`${res.imported} imported, ${res.skipped} skipped`);
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      setBulkOpen(false);
      setParsedRows([]);
      setParsedFileName("");
      setBulkBatchId("");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Bulk import failed");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; data: UpdateCandidateInput }) =>
      candidateService.update(vars.id, vars.data),
    onSuccess: () => {
      toast.success("Candidate updated successfully");
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      setEditOpen(false);
      setEditTarget(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to update candidate");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => candidateService.delete(id),
    onSuccess: () => {
      toast.success("Candidate deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      setDeleteOpen(false);
      setDeleteTarget(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to delete candidate");
    },
  });

  const assignCandidatesMutation = useMutation({
    mutationFn: async (ids: string[]) =>
      candidateService.assignToBatch(batchId!, ids),
    onSuccess: () => {
      toast.success(
        `${selectedCandidateIds.size} candidate(s) assigned to batch`,
      );
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["candidates-institution"],
        refetchType: "all",
      });
      setAssignOpen(false);
      setSelectedCandidateIds(new Set());
      setAssignSearch("");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to assign candidates");
    },
  });

  const removeFromBatchMutation = useMutation({
    mutationFn: (id: string) => candidateService.removeFromBatch(batchId!, id),
    onSuccess: () => {
      toast.success("Candidate removed from batch");
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["candidates-institution"],
        refetchType: "all",
      });
      setRemoveFromBatchTarget(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(
        err.response?.data?.error ?? "Failed to remove candidate from batch",
      );
    },
  });

  const columns = useMemo<ColumnDef<CandidateListItem>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={(e) =>
              table.toggleAllPageRowsSelected(!!e.target.checked)
            }
            aria-label="Select all"
            className="h-4 w-4 rounded border-border bg-background accent-primary text-primary focus:ring-primary cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={(e) => row.toggleSelected(!!e.target.checked)}
            aria-label="Select row"
            className="h-4 w-4 rounded border-border bg-background accent-primary text-primary focus:ring-primary cursor-pointer"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "fullName",

        header: "Name",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.fullName}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "rollNumber",
        header: "Roll No.",
        cell: ({ row }) => row.original.rollNumber ?? "—",
      },
      {
        accessorKey: "admitCardNumber",
        header: "Admit Card",
        cell: ({ row }) => row.original.admitCardNumber ?? "—",
      },
      {
        accessorKey: "dateOfBirth",
        header: "DOB",
        cell: ({ row }) => row.original.dateOfBirth ?? "—",
      },
      {
        accessorKey: "batchName",
        header: "Batch",
        cell: ({ row }) => row.original.batchName ?? "—",
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => row.original.phone ?? "—",
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            className={
              row.original.isActive
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }
          >
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) =>
          batchId ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRemoveFromBatchTarget(row.original)}
            >
              <UserMinus className="h-4 w-4 text-red-500" />
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditTarget(row.original);
                  setEditForm({
                    fullName: row.original.fullName,
                    dateOfBirth: row.original.dateOfBirth ?? "",
                    rollNumber: row.original.rollNumber ?? "",
                    admitCardNumber: row.original.admitCardNumber ?? "",
                    phone: row.original.phone ?? "",
                    batchId: row.original.batchId ?? "",
                    isActive: row.original.isActive,
                  });
                  setEditOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDeleteTarget(row.original);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ),
      },
    ],
    [batchId],
  );

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

  const handleDownloadTemplate = async () => {
    try {
      const blob = await candidateService.downloadTemplate();
      const url = URL.createObjectURL(blob as unknown as Blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.setAttribute("download", "candidates_template.xlsx");
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
    } catch {
      toast.error("Failed to download template");
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);
        const rows: BulkImportCandidateRow[] = json
          .map((row) => ({
            email: String(row["email"] ?? row["Email"] ?? "").trim(),
            fullName: String(
              row["fullName"] ??
                row["Full Name"] ??
                row["name"] ??
                row["Name"] ??
                "",
            ).trim(),
            dateOfBirth: String(
              row["dateOfBirth"] ??
                row["Date Of Birth"] ??
                row["dob"] ??
                row["DOB"] ??
                "",
            )
              .trim()
              .padStart(8, "0"),
            admitCardNumber: String(
              row["admitCardNumber"] ??
                row["Admit Card"] ??
                row["admitCard"] ??
                "",
            ).trim(),
            rollNumber:
              (row["rollNumber"] ??
              row["Roll Number"] ??
              row["rollNo"] ??
              undefined)
                ? String(
                    row["rollNumber"] ?? row["Roll Number"] ?? row["rollNo"],
                  ).trim()
                : undefined,
            phone:
              (row["phone"] ?? row["Phone"] ?? undefined)
                ? String(row["phone"] ?? row["Phone"]).trim()
                : undefined,
          }))
          .filter((r) => r.email && r.fullName && r.dateOfBirth);
        if (rows.length === 0) {
          toast.error(
            "No valid rows found. Columns needed: email, fullName, dateOfBirth (optional: rollNumber, admitCardNumber, phone)",
          );
          return;
        }
        setParsedRows(rows);
        setParsedFileName(file.name);
        setBulkOpen(true);
      } catch {
        toast.error(
          "Failed to parse file. Please upload a valid CSV or Excel file.",
        );
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleBulkImport = () => {
    if (parsedRows.length === 0) {
      toast.error("No rows to import. Please upload a file first.");
      return;
    }
    bulkMutation.mutate({ rows: parsedRows, batchId: bulkBatchId });
  };

  const handleBulkDelete = async () => {
    const selectedRows = table.getSelectedRowModel().rows;
    if (selectedRows.length === 0) return;

    setBulkDeleting(true);
    try {
      const deletePromises = selectedRows.map((row) =>
        batchId
          ? candidateService.removeFromBatch(batchId, row.original.id)
          : candidateService.delete(row.original.id),
      );
      await Promise.all(deletePromises);
      toast.success(
        `Successfully ${batchId ? "removed" : "deleted"} ${selectedRows.length} candidates`,
      );
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      setRowSelection({});
      setBulkDeleteConfirmOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete/remove some candidates");
    } finally {
      setBulkDeleting(false);
    }
  };

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
              placeholder="Search by name, email, roll no..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 h-9 text-xs"
            />
          </div>
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

          {batchId ? (
            <Button
              size="sm"
              onClick={() => {
                setSelectedCandidateIds(new Set());
                setAssignOpen(true);
              }}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Assign Candidates
            </Button>
          ) : (
            <>
              <input
                type="file"
                accept=".xlsx,.xls"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Template
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Candidate
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Single Add
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Bulk Add (Excel)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Table */}
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
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No candidates found.
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

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, data.total)} of {data.total}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cand-email">Email *</Label>
              <Input
                id="cand-email"
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm({ ...createForm, email: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cand-name">Full Name *</Label>
              <Input
                id="cand-name"
                value={createForm.fullName}
                onChange={(e) =>
                  setCreateForm({ ...createForm, fullName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cand-dob">Date of Birth * (ddmmyyyy)</Label>
              <Input
                id="cand-dob"
                placeholder="e.g. 28102003"
                value={createForm.dateOfBirth}
                onChange={(e) =>
                  setCreateForm({ ...createForm, dateOfBirth: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cand-roll">Roll Number</Label>
                <Input
                  id="cand-roll"
                  value={createForm.rollNumber}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, rollNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cand-admit">Admit Card No.</Label>
                <Input
                  id="cand-admit"
                  value={createForm.admitCardNumber}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      admitCardNumber: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cand-phone">Phone</Label>
              <Input
                id="cand-phone"
                value={createForm.phone}
                onChange={(e) =>
                  setCreateForm({ ...createForm, phone: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                !createForm.email ||
                !createForm.fullName ||
                !createForm.dateOfBirth
              }
              onClick={() => createMutation.mutate(createForm)}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-cand-name">Full Name *</Label>
              <Input
                id="edit-cand-name"
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm({ ...editForm, fullName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-cand-dob">Date of Birth (ddmmyyyy)</Label>
              <Input
                id="edit-cand-dob"
                placeholder="e.g. 28102003"
                value={editForm.dateOfBirth}
                onChange={(e) =>
                  setEditForm({ ...editForm, dateOfBirth: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-cand-roll">Roll Number</Label>
                <Input
                  id="edit-cand-roll"
                  value={editForm.rollNumber}
                  onChange={(e) =>
                    setEditForm({ ...editForm, rollNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cand-admit">Admit Card No.</Label>
                <Input
                  id="edit-cand-admit"
                  value={editForm.admitCardNumber}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      admitCardNumber: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-cand-phone">Phone</Label>
                <Input
                  id="edit-cand-phone"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm({ ...editForm, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cand-batch">Batch</Label>
                <select
                  id="edit-cand-batch"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={editForm.batchId}
                  onChange={(e) =>
                    setEditForm({ ...editForm, batchId: e.target.value })
                  }
                >
                  <option value="">No batch</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-cand-active"
                checked={editForm.isActive}
                onChange={(e) =>
                  setEditForm({ ...editForm, isActive: e.target.checked })
                }
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="edit-cand-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={updateMutation.isPending || !editForm.fullName}
              onClick={() => {
                if (!editTarget) return;
                updateMutation.mutate({
                  id: editTarget.id,
                  data: {
                    fullName: editForm.fullName,
                    dateOfBirth: editForm.dateOfBirth || undefined,
                    rollNumber: editForm.rollNumber || undefined,
                    admitCardNumber: editForm.admitCardNumber || undefined,
                    phone: editForm.phone || undefined,
                    batchId: editForm.batchId || null,
                    isActive: editForm.isActive,
                  },
                });
              }}
            >
              {updateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Candidate</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-muted-foreground">
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.fullName}
            </span>
            ? This will also remove their user account and all related data.
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from Batch Confirmation Dialog (batch mode) */}
      <Dialog
        open={!!removeFromBatchTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveFromBatchTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from Batch</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-muted-foreground">
            Remove{" "}
            <span className="font-medium text-foreground">
              {removeFromBatchTarget?.fullName}
            </span>{" "}
            from this batch? The candidate will remain in the institution but
            will no longer be assigned to this batch.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveFromBatchTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeFromBatchMutation.isPending}
              onClick={() => {
                if (removeFromBatchTarget)
                  removeFromBatchMutation.mutate(removeFromBatchTarget.id);
              }}
            >
              {removeFromBatchMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Remove from Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) {
            setParsedRows([]);
            setParsedFileName("");
            setBulkBatchId("");
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Import Candidates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {parsedFileName || "No file selected"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {parsedRows.length} valid row
                    {parsedRows.length !== 1 ? "s" : ""} parsed
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose File
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-batch">Assign to Batch (optional)</Label>
              <select
                id="bulk-batch"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={bulkBatchId}
                onChange={(e) => setBulkBatchId(e.target.value)}
              >
                <option value="">No batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            {parsedRows.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Full Name</TableHead>
                      <TableHead>Admit Card</TableHead>
                      <TableHead>Roll No.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.slice(0, 50).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{r.email}</TableCell>
                        <TableCell className="text-xs">{r.fullName}</TableCell>
                        <TableCell className="text-xs">
                          {r.admitCardNumber ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.rollNumber ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedRows.length > 50 && (
                  <p className="py-1 text-center text-xs text-muted-foreground">
                    ...and {parsedRows.length - 50} more
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Supported formats: XLSX, XLS. Required columns: email, fullName,
              dateOfBirth. Optional: rollNumber, admitCardNumber, phone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkMutation.isPending || parsedRows.length === 0}
              onClick={handleBulkImport}
            >
              {bulkMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Import {parsedRows.length} Candidate
              {parsedRows.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Candidates Dialog (batch mode) */}
      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open) {
            setSelectedCandidateIds(new Set());
            setAssignSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign Candidates to Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search candidates by name or email..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
              {instCandLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (institutionCandidates?.data ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No candidates found in this institution.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Admit Card</TableHead>
                      <TableHead>Batch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(institutionCandidates?.data ?? [])
                      .filter(
                        (c) => !(data?.data ?? []).some((bc) => bc.id === c.id),
                      )
                      .map((c) => (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer"
                          onClick={() => {
                            setSelectedCandidateIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedCandidateIds.has(c.id)}
                              onChange={() => {}}
                              className="h-4 w-4 rounded border-input"
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {c.fullName}
                          </TableCell>
                          <TableCell className="text-xs">{c.email}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.admitCardNumber ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.batchName ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {selectedCandidateIds.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedCandidateIds.size} candidate
                {selectedCandidateIds.size !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                assignCandidatesMutation.isPending ||
                selectedCandidateIds.size === 0
              }
              onClick={() => {
                assignCandidatesMutation.mutate(
                  Array.from(selectedCandidateIds),
                );
              }}
            >
              {assignCandidatesMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Assign {selectedCandidateIds.size} Candidate
              {selectedCandidateIds.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirm Dialog */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-500">
              Confirm Bulk Deletion
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete/remove the{" "}
              <span className="font-bold text-foreground">
                {table.getSelectedRowModel().rows.length}
              </span>{" "}
              selected candidate(s)? This action cannot be undone.
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
