import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Activity,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Monitor,
    Search,
    Settings,
    Shield,
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
import { Textarea } from "../components/ui/textarea";
import { sebService, type SebSettings } from "../services/seb";
import {
    systemService,
    type UpdatePolicyInput,
    type UpdateSettingInput,
} from "../services/system";

type Tab = "settings" | "policies" | "health" | "seb";

export default function SystemSettingsPage() {
  const [tab, setTab] = useState<Tab>("settings");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [editingSetting, setEditingSetting] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<string | null>(null);
  const [settingValue, setSettingValue] = useState("");
  const [settingDesc, setSettingDesc] = useState("");
  const [policyJson, setPolicyJson] = useState("");
  const [policyActive, setPolicyActive] = useState(true);
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["system-settings", page, pageSize, search],
    queryFn: () =>
      systemService.listSettings({
        page,
        pageSize,
        search: search || undefined,
      }),
    enabled: tab === "settings",
  });

  const policiesQuery = useQuery({
    queryKey: ["security-policies", page, pageSize, search],
    queryFn: () =>
      systemService.listPolicies({
        page,
        pageSize,
        search: search || undefined,
      }),
    enabled: tab === "policies",
  });

  const healthQuery = useQuery({
    queryKey: ["health-detailed"],
    queryFn: () => systemService.healthDetailed(),
    enabled: tab === "health",
  });

  const updateSettingMutation = useMutation({
    mutationFn: ({ key, data }: { key: string; data: UpdateSettingInput }) =>
      systemService.updateSetting(key, data),
    onSuccess: () => {
      toast.success("Setting updated successfully");
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      setEditingSetting(null);
    },
    onError: () => toast.error("Failed to update setting"),
  });

  const updatePolicyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePolicyInput }) =>
      systemService.updatePolicy(id, data),
    onSuccess: () => {
      toast.success("Security policy updated successfully");
      queryClient.invalidateQueries({ queryKey: ["security-policies"] });
      setEditingPolicy(null);
    },
    onError: () => toast.error("Failed to update security policy"),
  });

  const handleEditSetting = (
    key: string,
    currentValue: string,
    currentDesc: string | null,
  ) => {
    setEditingSetting(key);
    setSettingValue(currentValue);
    setSettingDesc(currentDesc ?? "");
  };

  const handleSaveSetting = () => {
    if (!editingSetting) return;
    updateSettingMutation.mutate({
      key: editingSetting,
      data: { value: settingValue, description: settingDesc || undefined },
    });
  };

  const handleEditPolicy = (
    id: string,
    json: Record<string, unknown>,
    isActive: boolean,
  ) => {
    setEditingPolicy(id);
    setPolicyJson(JSON.stringify(json, null, 2));
    setPolicyActive(isActive);
  };

  const handleSavePolicy = () => {
    if (!editingPolicy) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(policyJson);
    } catch {
      toast.error("Invalid JSON format");
      return;
    }
    updatePolicyMutation.mutate({
      id: editingPolicy,
      data: { settingsJson: parsed, isActive: policyActive },
    });
  };

  const totalPages = (data: { total: number } | undefined) =>
    data ? Math.ceil(data.total / pageSize) : 1;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        <Button
          variant={tab === "settings" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("settings")}
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
        <Button
          variant={tab === "policies" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("policies")}
        >
          <Shield className="mr-2 h-4 w-4" />
          Security Policies
        </Button>
        <Button
          variant={tab === "health" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("health")}
        >
          <Activity className="mr-2 h-4 w-4" />
          Health
        </Button>
        <Button
          variant={tab === "seb" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("seb")}
        >
          <Monitor className="mr-2 h-4 w-4" />
          SEB Settings
        </Button>
      </div>

      {(tab === "settings" || tab === "policies") && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
      )}

      {tab === "settings" && (
        <>
          {settingsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Editable</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settingsQuery.data?.data.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-8"
                        >
                          No settings found
                        </TableCell>
                      </TableRow>
                    ) : (
                      settingsQuery.data?.data.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-sm font-medium">
                            {s.key}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {s.value}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{s.valueType}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {s.description ?? "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={s.isEditable ? "default" : "secondary"}
                            >
                              {s.isEditable ? "Yes" : "No"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!s.isEditable}
                              onClick={() =>
                                handleEditSetting(s.key, s.value, s.description)
                              }
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={page}
                totalPages={totalPages(settingsQuery.data)}
                onPageChange={setPage}
                total={settingsQuery.data?.total ?? 0}
              />
            </>
          )}
        </>
      )}

      {tab === "policies" && (
        <>
          {policiesQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Settings</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policiesQuery.data?.data.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground py-8"
                        >
                          No security policies found
                        </TableCell>
                      </TableRow>
                    ) : (
                      policiesQuery.data?.data.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {p.policyName}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.description ?? "-"}
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {JSON.stringify(p.settingsJson).slice(0, 60)}
                            {JSON.stringify(p.settingsJson).length > 60
                              ? "..."
                              : ""}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={p.isActive ? "default" : "secondary"}
                            >
                              {p.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleEditPolicy(
                                  p.id,
                                  p.settingsJson,
                                  p.isActive,
                                )
                              }
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={page}
                totalPages={totalPages(policiesQuery.data)}
                onPageChange={setPage}
                total={policiesQuery.data?.total ?? 0}
              />
            </>
          )}
        </>
      )}

      {tab === "health" && (
        <>
          {healthQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : healthQuery.data ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h3 className="mb-3 text-lg font-semibold">Database</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant={
                        healthQuery.data.database.status === "ok"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {healthQuery.data.database.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Latency</span>
                    <span className="font-mono">
                      {healthQuery.data.database.latencyMs ?? "N/A"}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pool Total</span>
                    <span className="font-mono">
                      {healthQuery.data.database.pool.total}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pool Idle</span>
                    <span className="font-mono">
                      {healthQuery.data.database.pool.idle}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pool Waiting</span>
                    <span className="font-mono">
                      {healthQuery.data.database.pool.waiting}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="mb-3 text-lg font-semibold">Memory</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">RSS</span>
                    <span className="font-mono">
                      {healthQuery.data.memory.rssMB} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heap Used</span>
                    <span className="font-mono">
                      {healthQuery.data.memory.heapUsedMB} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heap Total</span>
                    <span className="font-mono">
                      {healthQuery.data.memory.heapTotalMB} MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">External</span>
                    <span className="font-mono">
                      {healthQuery.data.memory.externalMB} MB
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="mb-3 text-lg font-semibold">Process</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PID</span>
                    <span className="font-mono">
                      {healthQuery.data.process.pid}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Node Version</span>
                    <span className="font-mono">
                      {healthQuery.data.process.nodeVersion}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Platform</span>
                    <span className="font-mono">
                      {healthQuery.data.process.platform}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Uptime</span>
                    <span className="font-mono">
                      {Math.floor(healthQuery.data.uptime / 60)}m{" "}
                      {healthQuery.data.uptime % 60}s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Environment</span>
                    <span className="font-mono">
                      {healthQuery.data.environment}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="mb-3 text-lg font-semibold">Overall Status</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant={
                        healthQuery.data.status === "ok"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {healthQuery.data.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Timestamp</span>
                    <span className="font-mono text-xs">
                      {new Date(healthQuery.data.timestamp).toLocaleString(
                        "en-IN",
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {tab === "seb" && <SebSettingsTab />}

      {/* Edit Setting Dialog */}
      <Dialog
        open={editingSetting !== null}
        onOpenChange={(open) => !open && setEditingSetting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Setting: {editingSetting}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="setting-value">Value</Label>
              <Input
                id="setting-value"
                value={settingValue}
                onChange={(e) => setSettingValue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setting-desc">Description (optional)</Label>
              <Input
                id="setting-desc"
                value={settingDesc}
                onChange={(e) => setSettingDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSetting(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSetting}
              disabled={updateSettingMutation.isPending}
            >
              {updateSettingMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Policy Dialog */}
      <Dialog
        open={editingPolicy !== null}
        onOpenChange={(open) => !open && setEditingPolicy(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Security Policy</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="policy-json">Settings (JSON)</Label>
              <Textarea
                id="policy-json"
                value={policyJson}
                onChange={(e) => setPolicyJson(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="policy-active"
                checked={policyActive}
                onChange={(e) => setPolicyActive(e.target.checked)}
              />
              <Label htmlFor="policy-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPolicy(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePolicy}
              disabled={updatePolicyMutation.isPending}
            >
              {updatePolicyMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SebSettingsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SebSettings>({
    enabled: false,
    requireBek: true,
    startUrl: "",
  });
  const [blockedProcessesText, setBlockedProcessesText] = useState("");
  const [permittedProcessesText, setPermittedProcessesText] = useState("");
  const [openSection, setOpenSection] = useState<string>("general");

  const sebQuery = useQuery({
    queryKey: ["seb-settings"],
    queryFn: sebService.getSettings,
  });

  useEffect(() => {
    if (sebQuery.data) {
      setForm(sebQuery.data);
      setBlockedProcessesText(
        (sebQuery.data.blockedProcesses ?? []).join("\n"),
      );
      setPermittedProcessesText(
        (sebQuery.data.permittedProcesses ?? []).join("\n"),
      );
    }
  }, [sebQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (data: SebSettings) => sebService.saveSettings(data),
    onSuccess: () => {
      toast.success("SEB settings saved successfully");
      queryClient.invalidateQueries({ queryKey: ["seb-settings"] });
    },
    onError: () => toast.error("Failed to save SEB settings"),
  });

  const handleSave = () => {
    const blocked = blockedProcessesText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const permitted = permittedProcessesText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    saveMutation.mutate({
      ...form,
      blockedProcesses: blocked,
      permittedProcesses: permitted,
    });
  };

  const toggle = (key: keyof SebSettings) => {
    setForm((prev) => ({ ...prev, [key]: !prev[key] as never }));
  };

  const setNum = (key: keyof SebSettings, value: number) => {
    setForm((prev) => ({ ...prev, [key]: value as never }));
  };

  const setStr = (key: keyof SebSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value as never }));
  };

  if (sebQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Helper: Toggle switch
  const Toggle = ({
    k,
    label,
    desc,
  }: {
    k: keyof SebSettings;
    label: string;
    desc: string;
  }) => (
    <div className="flex items-start justify-between rounded-lg border p-3">
      <div className="mr-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={form[k] as boolean}
        onClick={() => toggle(k)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form[k] ? "bg-primary" : "bg-input"}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${form[k] ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );

  // Helper: Collapsible section
  const Section = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) => (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpenSection(openSection === id ? "" : id)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-muted-foreground">
          {openSection === id ? "−" : "+"}
        </span>
      </button>
      {openSection === id && (
        <div className="space-y-4 p-4 pt-0">{children}</div>
      )}
    </div>
  );

  // Helper: Number input
  const NumInput = ({
    k,
    label,
    placeholder,
  }: {
    k: keyof SebSettings;
    label: string;
    placeholder?: string;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={(form[k] as number) ?? 0}
        onChange={(e) => setNum(k, parseInt(e.target.value) || 0)}
        placeholder={placeholder}
      />
    </div>
  );

  // Helper: Text input
  const TextInput = ({
    k,
    label,
    placeholder,
    type,
  }: {
    k: keyof SebSettings;
    label: string;
    placeholder?: string;
    type?: string;
  }) => {
    const [focused, setFocused] = useState(false);
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <Input
          type={type ?? "text"}
          autoComplete="off"
          name={`seb-field-${k}`}
          value={(form[k] as string) ?? ""}
          onChange={(e) => setStr(k, e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          readOnly={!focused && type === "password" ? true : undefined}
          data-lpignore="true"
          data-1p-ignore="true"
        />
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Hidden inputs to absorb browser autofill */}
      <input
        type="text"
        name="fake-username"
        autoComplete="username"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        type="password"
        name="fake-password"
        autoComplete="new-password"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="rounded-lg border p-4 bg-muted/30">
        <div className="flex items-center gap-2 mb-2">
          <Monitor className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">
            Safe Exam Browser Configuration
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          These settings apply globally to all exam batches. When SEB is
          enabled, candidates must launch exams through Safe Exam Browser.
          Settings are based on the official SEB configuration key
          specification.
        </p>
      </div>

      {/* Quick toggles - always visible */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          k="enabled"
          label="Enable SEB"
          desc="Require Safe Exam Browser for all exams"
        />
        <Toggle
          k="requireBek"
          label="Require Browser Exam Key"
          desc="Reject requests without valid BEK header"
        />
      </div>

      {/* General */}
      <Section id="general" title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            k="startUrl"
            label="Start URL (optional)"
            placeholder="https://exam.example.com/exam"
          />
          <TextInput
            k="sebServerUrl"
            label="SEB Server URL (optional)"
            placeholder="https://seb-server.example.com"
          />
          <TextInput
            k="quitPassword"
            label="Quit Password (optional)"
            type="password"
            placeholder="Password to quit SEB"
          />
          <NumInput
            k="sebMode"
            label="SEB Mode (0=kiosk, 1=browser)"
            placeholder="0"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="allowQuit"
            label="Allow Quit"
            desc="Allow students to quit SEB"
          />
          <Toggle
            k="ignoreExitKeys"
            label="Ignore Exit Keys"
            desc="Ignore standard SEB exit key combinations"
          />
        </div>
      </Section>

      {/* User Interface */}
      <Section id="ui" title="User Interface">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="showTaskBar"
            label="Show Task Bar"
            desc="Display SEB task bar"
          />
          <Toggle k="showTime" label="Show Time" desc="Display clock in SEB" />
          <Toggle
            k="showReloadButton"
            label="Show Reload Button"
            desc="Show page reload button"
          />
          <Toggle
            k="showInputLanguage"
            label="Show Input Language"
            desc="Show keyboard layout switcher"
          />
          <Toggle
            k="showSideMenu"
            label="Show Side Menu"
            desc="Show SEB side menu"
          />
          <Toggle
            k="showMenuBar"
            label="Show Menu Bar"
            desc="Show menu bar in SEB"
          />
          <Toggle
            k="enableBrowserWindowToolbar"
            label="Browser Toolbar"
            desc="Enable browser window toolbar"
          />
          <Toggle
            k="hideBrowserWindowToolbar"
            label="Hide Toolbar"
            desc="Hide browser window toolbar"
          />
          <Toggle
            k="browserWindowAllowAddressBar"
            label="Address Bar"
            desc="Allow address bar in browser window"
          />
          <Toggle
            k="touchOptimized"
            label="Touch Optimized"
            desc="Optimize UI for touch devices"
          />
          <Toggle
            k="enableZoomText"
            label="Enable Zoom Text"
            desc="Allow text zoom"
          />
          <Toggle
            k="enableZoomPage"
            label="Enable Zoom Page"
            desc="Allow page zoom"
          />
          <Toggle
            k="allowDictionaryLookup"
            label="Dictionary Lookup"
            desc="Allow dictionary lookups"
          />
          <Toggle
            k="enableTouchExit"
            label="Touch Exit"
            desc="Enable touch-based exit"
          />
          <Toggle
            k="allowDeveloperConsole"
            label="Developer Console"
            desc="Allow dev tools (not recommended)"
          />
          <Toggle
            k="allowSpellCheck"
            label="Spell Check"
            desc="Enable spell checking"
          />
          <Toggle
            k="allowSpellCheckDictionary"
            label="Spell Check Dictionary"
            desc="Allow spell check dictionaries"
          />
          <Toggle
            k="audioMute"
            label="Mute Audio"
            desc="Mute all audio in SEB"
          />
          <Toggle
            k="audioControlEnabled"
            label="Audio Control"
            desc="Enable audio control in task bar"
          />
          <Toggle
            k="audioSetVolumeLevel"
            label="Set Volume Level"
            desc="Force specific volume level"
          />
          <Toggle
            k="browserScreenKeyboard"
            label="Screen Keyboard"
            desc="Show on-screen keyboard"
          />
          <Toggle
            k="showQrVerifyButton"
            label="QR Verify Button"
            desc="Show QR verification button"
          />
          <Toggle
            k="allowFind"
            label="Allow Find"
            desc="Allow page search functionality"
          />
          <Toggle
            k="allowPrint"
            label="Allow Print"
            desc="Allow printing from SEB"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumInput
            k="zoomMode"
            label="Zoom Mode (0=config, 1=always)"
            placeholder="0"
          />
          <NumInput
            k="oskBehavior"
            label="OSK Behavior (0=none, 1=allow, 2=force)"
            placeholder="0"
          />
          <NumInput
            k="audioVolumeLevel"
            label="Audio Volume Level (0-100)"
            placeholder="25"
          />
          <NumInput
            k="batteryChargeThresholdCritical"
            label="Battery Critical Threshold (%)"
            placeholder="0"
          />
          <NumInput
            k="batteryChargeThresholdLow"
            label="Battery Low Threshold (%)"
            placeholder="0"
          />
        </div>
        <TextInput
          k="browserWindowTitleSuffix"
          label="Browser Window Title Suffix"
          placeholder=""
        />
      </Section>

      {/* Browser */}
      <Section id="browser" title="Browser">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="enableSebBrowser"
            label="Enable SEB Browser"
            desc="Use SEB's internal browser"
          />
          <Toggle
            k="browserWindowAllowReload"
            label="Allow Reload (main window)"
            desc="Allow reload in main browser window"
          />
          <Toggle
            k="newBrowserWindowAllowReload"
            label="Allow Reload (new windows)"
            desc="Allow reload in new browser windows"
          />
          <Toggle
            k="showReloadWarning"
            label="Show Reload Warning"
            desc="Warn before reloading"
          />
          <Toggle
            k="newBrowserWindowShowReloadWarning"
            label="Reload Warning (new windows)"
            desc="Warn before reloading new windows"
          />
          <Toggle
            k="enablePlugIns"
            label="Enable Plug-ins"
            desc="Enable browser plug-ins"
          />
          <Toggle
            k="enableJava"
            label="Enable Java"
            desc="Enable Java applets"
          />
          <Toggle
            k="enableJavaScript"
            label="Enable JavaScript"
            desc="Enable JavaScript execution"
          />
          <Toggle
            k="blockPopUpWindows"
            label="Block Pop-ups"
            desc="Block pop-up windows"
          />
          <Toggle
            k="allowVideoCapture"
            label="Allow Video Capture"
            desc="Allow camera access"
          />
          <Toggle
            k="allowAudioCapture"
            label="Allow Audio Capture"
            desc="Allow microphone access"
          />
          <Toggle
            k="allowBrowsingBackForward"
            label="Back/Forward Navigation"
            desc="Allow back/forward browsing"
          />
          <Toggle
            k="removeBrowserProfile"
            label="Remove Browser Profile"
            desc="Clear browser profile on start"
          />
          <Toggle
            k="removeLocalStorage"
            label="Remove Local Storage"
            desc="Clear local storage on start"
          />
          <Toggle
            k="allowPDFReaderToolbar"
            label="PDF Reader Toolbar"
            desc="Allow PDF reader toolbar"
          />
          <Toggle
            k="allowPDFPlugIn"
            label="PDF Plug-in"
            desc="Use PDF browser plug-in"
          />
          <Toggle
            k="newBrowserWindowByLinkBlockForeign"
            label="Block Foreign (link)"
            desc="Block foreign content via links"
          />
          <Toggle
            k="newBrowserWindowByScriptBlockForeign"
            label="Block Foreign (script)"
            desc="Block foreign content via scripts"
          />
          <Toggle
            k="newBrowserWindowShowURL"
            label="Show URL (new windows)"
            desc="Show URL in new browser windows"
          />
          <Toggle
            k="browserWindowShowURL"
            label="Show URL (main window)"
            desc="Show URL in main browser window"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumInput
            k="newBrowserWindowByLinkPolicy"
            label="Link Window Policy (0=open, 1=block, 2=same)"
            placeholder="2"
          />
          <NumInput
            k="newBrowserWindowByScriptPolicy"
            label="Script Window Policy (0=open, 1=block, 2=same)"
            placeholder="2"
          />
        </div>
        <TextInput
          k="browserUserAgent"
          label="Custom User Agent (optional)"
          placeholder="Leave empty for default"
        />
      </Section>

      {/* Downloads / Uploads */}
      <Section id="downloads" title="Downloads & Uploads">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="allowDownloads"
            label="Allow Downloads"
            desc="Allow file downloads"
          />
          <Toggle
            k="allowUploads"
            label="Allow Uploads"
            desc="Allow file uploads"
          />
          <Toggle
            k="allowCustomDownUploadLocation"
            label="Custom Download Location"
            desc="Allow choosing download location"
          />
          <Toggle
            k="openDownloads"
            label="Open Downloads"
            desc="Automatically open downloaded files"
          />
          <Toggle
            k="downloadPDFFiles"
            label="Download PDF Files"
            desc="Download PDFs instead of viewing"
          />
          <Toggle
            k="downloadAndOpenSebConfig"
            label="Download & Open .seb Config"
            desc="Allow downloading SEB config files"
          />
          <Toggle
            k="backgroundOpenSebConfig"
            label="Background Open SEB Config"
            desc="Open SEB config in background"
          />
          <Toggle
            k="useTemporaryDownUploadDirectory"
            label="Temporary Directory"
            desc="Use temporary directory for downloads"
          />
          <Toggle
            k="browserShowFileSystemElementPath"
            label="Show File Path"
            desc="Show full file system paths"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            k="downloadDirectoryWin"
            label="Download Directory (Windows)"
            placeholder=""
          />
          <TextInput
            k="downloadDirectoryMac"
            label="Download Directory (macOS)"
            placeholder=""
          />
          <NumInput
            k="chooseFileToUploadPolicy"
            label="File Upload Policy (0=allow, 1=block)"
            placeholder="0"
          />
        </div>
      </Section>

      {/* Exam */}
      <Section id="exam" title="Exam Settings">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="sendBrowserExamKey"
            label="Send Browser Exam Key"
            desc="Send BEK in HTTP header"
          />
          <Toggle
            k="browserURLSalt"
            label="Browser URL Salt"
            desc="Use URL salt for BEK"
          />
          <Toggle
            k="examSessionClearCookiesOnStart"
            label="Clear Cookies on Start"
            desc="Clear cookies when exam starts"
          />
          <Toggle
            k="examSessionClearCookiesOnEnd"
            label="Clear Cookies on End"
            desc="Clear cookies when exam ends"
          />
          <Toggle
            k="examSessionReconfigureAllow"
            label="Allow Reconfiguration"
            desc="Allow SEB reconfiguration during exam"
          />
          <Toggle
            k="restartExamUseStartURL"
            label="Restart Uses Start URL"
            desc="Restart exam uses start URL"
          />
          <Toggle
            k="restartExamPasswordProtected"
            label="Restart Password Protected"
            desc="Require password to restart exam"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            k="restartExamText"
            label="Restart Exam Text"
            placeholder=""
          />
          <TextInput
            k="restartExamURL"
            label="Restart Exam URL"
            placeholder=""
          />
          <TextInput
            k="examSessionReconfigureConfigURL"
            label="Reconfiguration Config URL"
            placeholder=""
          />
          <TextInput
            k="startURLAppendQueryParameter"
            label="Start URL Query Parameter"
            placeholder=""
          />
        </div>
      </Section>

      {/* Applications */}
      <Section id="apps" title="Applications & Security">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="monitorProcesses"
            label="Monitor Processes"
            desc="Monitor running processes"
          />
          <Toggle
            k="allowSwitchToApplications"
            label="Switch to Applications"
            desc="Allow switching to other apps"
          />
          <Toggle
            k="allowFlashFullscreen"
            label="Allow Flash Fullscreen"
            desc="Allow Flash fullscreen mode"
          />
          <Toggle
            k="allowWindowResize"
            label="Allow Window Resize"
            desc="Allow resizing SEB window"
          />
          <Toggle
            k="blockScreenCapture"
            label="Block Screen Capture"
            desc="Prevent screen capture tools"
          />
          <Toggle
            k="blockScreenSharing"
            label="Block Screen Sharing"
            desc="Prevent screen sharing apps"
          />
        </div>
      </Section>

      {/* Network */}
      <Section id="network" title="Network & URL Filtering">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            k="enableURLFilter"
            label="Enable URL Filter"
            desc="Filter URLs based on rules"
          />
          <Toggle
            k="enableURLContentFilter"
            label="Enable Content Filter"
            desc="Filter page content"
          />
        </div>
      </Section>

      {/* Blocked Processes */}
      <Section id="blocked" title="Blocked Processes (Prohibited)">
        <Textarea
          value={blockedProcessesText}
          onChange={(e) => setBlockedProcessesText(e.target.value)}
          rows={6}
          placeholder="TeamViewer&#10;AnyDesk&#10;Zoom"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          One process name per line. These will be killed while SEB is running.
        </p>
      </Section>

      {/* Permitted Processes */}
      <Section id="permitted" title="Permitted Processes (Allowed)">
        <Textarea
          value={permittedProcessesText}
          onChange={(e) => setPermittedProcessesText(e.target.value)}
          rows={4}
          placeholder="Calculator.exe&#10;Notepad.exe"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          One process name per line. These applications are allowed during the
          exam.
        </p>
      </Section>

      {/* Save button */}
      <div className="sticky bottom-0 flex justify-end border-t bg-background pt-4">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save SEB Settings
        </Button>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">Total: {total} items</p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
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
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
