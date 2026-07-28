import {
    Activity,
    AlertTriangle,
    Clock,
    Pause,
    Play,
    RefreshCw,
    Terminal,
    Timer,
    Wifi,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "../components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "../components/ui/table";
import { examBatchService } from "../services/exam-batches";
import { sessionService } from "../services/sessions";
import type { ActiveAttempt, ExamBatchListItem } from "../types/index";

function formatTime(secs: number): string {
  if (secs <= 0) return "00:00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Computes the live remaining time for an attempt.
 * - For `in_progress`: subtracts seconds elapsed since last server refresh
 * - For `paused` / `not_started` / terminal: returns the server value as-is (frozen)
 */
function liveRemainingSecs(
  attempt: ActiveAttempt,
  lastRefresh: number,
  now: number,
): number {
  if (attempt.status !== "in_progress") return attempt.remainingTimeSecs;
  const elapsed = Math.floor((now - lastRefresh) / 1000);
  return Math.max(0, attempt.remainingTimeSecs - elapsed);
}

function statusColor(status: string): string {
  switch (status) {
    case "in_progress":
      return "bg-green-500/10 text-green-600 border-green-500/20";
    case "paused":
      return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
    case "not_started":
      return "bg-blue-500/10 text-blue-600 border-blue-500/20";
    case "submitted":
    case "auto_submitted":
      return "bg-gray-500/10 text-gray-600 border-gray-500/20";
    case "terminated":
      return "bg-red-500/10 text-red-600 border-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-600 border-gray-500/20";
  }
}

export default function LiveMonitorPage() {
  const [examBatches, setExamBatches] = useState<ExamBatchListItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [attempts, setAttempts] = useState<ActiveAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevAttemptsRef = useRef<Map<string, string>>(new Map());

  // Tick every second for real-time countdown display
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Load exam batches on mount
  useEffect(() => {
    const loadBatches = async () => {
      try {
        const res = await examBatchService.list({ pageSize: 100 });
        setExamBatches(res.data);
        if (res.data.length > 0 && !selectedBatchId) {
          const activeBatch = res.data.find(
            (b) => b.status === "active" || b.status === "published",
          );
          setSelectedBatchId(activeBatch?.id ?? res.data[0].id);
        }
      } catch {
        toast.error("Failed to load exam batches");
      }
    };
    loadBatches();
  }, []);

  const fetchActiveSessions = useCallback(
    async (silent = false) => {
      if (!selectedBatchId) return;
      if (!silent) setLoading(true);
      try {
        const res = await sessionService.getActiveSessions(selectedBatchId);
        const newAttempts = res.attempts;

        // Detect status changes and fire toast notifications
        for (const attempt of newAttempts) {
          const prevStatus = prevAttemptsRef.current.get(attempt.id);
          if (prevStatus && prevStatus !== attempt.status) {
            if (attempt.status === "auto_submitted") {
              toast.warning(
                `Attempt ${attempt.id.slice(0, 8)}... was auto-submitted (timer expired)`,
                { icon: <Zap className="h-4 w-4" />, duration: 8000 },
              );
            } else if (
              attempt.status === "submitted" ||
              attempt.status === "force_submitted"
            ) {
              toast.success(
                `Attempt ${attempt.id.slice(0, 8)}... was submitted`,
              );
            } else if (attempt.status === "terminated") {
              toast.error(
                `Attempt ${attempt.id.slice(0, 8)}... was terminated`,
              );
            } else if (attempt.status === "paused") {
              toast.info(
                `${attempt.candidateName ?? attempt.id.slice(0, 8)}... was paused`,
              );
            } else if (
              attempt.status === "in_progress" &&
              prevStatus === "paused"
            ) {
              toast.info(
                `${attempt.candidateName ?? attempt.id.slice(0, 8)}... was resumed`,
              );
            }
          }
          prevAttemptsRef.current.set(attempt.id, attempt.status);
        }

        setAttempts(newAttempts);
        setLastRefresh(Date.now());
      } catch {
        // Silent on auto-refresh, toast on manual
        if (!silent) toast.error("Failed to fetch active sessions");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedBatchId],
  );

  // SSE connection — replaces 3-second polling.
  // Server pushes events in real-time: pause, resume, submit, terminate, etc.
  // On any event, we do an immediate fetch to get the updated data.
  useEffect(() => {
    if (!autoRefresh || !selectedBatchId) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Initial fetch
    fetchActiveSessions(true);

    // Open SSE connection
    const eventSource = new EventSource(
      `/api/sse/admin?token=${encodeURIComponent(token)}&examBatchId=${encodeURIComponent(selectedBatchId)}`,
    );

    // On any session event, immediately fetch updated data
    const handleSessionEvent = () => {
      fetchActiveSessions(true);
    };

    eventSource.addEventListener("session:paused", handleSessionEvent);
    eventSource.addEventListener("session:resumed", handleSessionEvent);
    eventSource.addEventListener("session:auto_paused", handleSessionEvent);
    eventSource.addEventListener("session:auto_resumed", handleSessionEvent);
    eventSource.addEventListener("session:submitted", handleSessionEvent);
    eventSource.addEventListener("session:auto_submitted", handleSessionEvent);
    eventSource.addEventListener("session:terminated", handleSessionEvent);

    eventSource.onerror = () => {
      // SSE connection lost — EventSource auto-reconnects.
      // Fallback: poll every 5s while disconnected.
    };

    return () => {
      eventSource.close();
    };
  }, [autoRefresh, selectedBatchId, fetchActiveSessions]);

  const handlePause = async (attemptId: string) => {
    try {
      await sessionService.pauseAttempt(attemptId, "Admin pause from monitor");
      toast.success("Attempt paused");
      fetchActiveSessions(true);
    } catch {
      toast.error("Failed to pause attempt");
    }
  };

  const handleResume = async (attemptId: string) => {
    try {
      await sessionService.resumeAttempt(attemptId);
      toast.success("Attempt resumed");
      fetchActiveSessions(true);
    } catch {
      toast.error("Failed to resume attempt");
    }
  };

  const handleTerminate = async (attemptId: string) => {
    if (!confirm("Are you sure you want to terminate this attempt?")) return;
    try {
      await sessionService.terminateAttempt(
        attemptId,
        "Admin termination from monitor",
      );
      toast.success("Attempt terminated");
      fetchActiveSessions(true);
    } catch {
      toast.error("Failed to terminate attempt");
    }
  };

  const inProgressCount = useMemo(
    () => attempts.filter((a) => a.status === "in_progress").length,
    [attempts],
  );
  const pausedCount = useMemo(
    () => attempts.filter((a) => a.status === "paused").length,
    [attempts],
  );
  const notStartedCount = useMemo(
    () => attempts.filter((a) => a.status === "not_started").length,
    [attempts],
  );
  const autoSubmittedCount = useMemo(
    () => attempts.filter((a) => a.status === "auto_submitted").length,
    [attempts],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant={autoRefresh ? "default" : "outline"}
          size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`}
          />
          {autoRefresh ? "Live (SSE)" : "Manual"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchActiveSessions(false)}
          disabled={loading}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        {lastRefresh > 0 && (
          <span className="text-xs text-muted-foreground">
            Updated {Math.max(0, Math.floor((now - lastRefresh) / 1000))}s ago
          </span>
        )}
      </div>

      {/* Batch selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Exam Batch:</label>
        <select
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          value={selectedBatchId}
          onChange={(e) => setSelectedBatchId(e.target.value)}
        >
          <option value="">Select a batch...</option>
          {examBatches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.examName ?? b.name} ({b.status})
            </option>
          ))}
        </select>
        {lastRefresh > 0 && (
          <span className="text-xs text-muted-foreground">
            Last updated: {new Date(lastRefresh).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              In Progress
            </CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {inProgressCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Paused
            </CardTitle>
            <Pause className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {pausedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Not Started
            </CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {notStartedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Auto-Submitted
            </CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {autoSubmittedCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active sessions table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Active Sessions ({attempts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedBatchId ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Select an exam batch to view active sessions
            </div>
          ) : attempts.length === 0 && !loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              No active sessions for this exam batch
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attempt ID</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remaining Time</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Browser</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Reconnects</TableHead>
                  <TableHead>Started At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell className="font-mono text-xs">
                      {attempt.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell className="text-xs">
                      {attempt.candidateName ??
                        attempt.candidateId.slice(0, 8) + "..."}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusColor(attempt.status)}
                      >
                        {attempt.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const liveSecs = liveRemainingSecs(
                          attempt,
                          lastRefresh,
                          now,
                        );
                        const isLow = liveSecs <= 300 && liveSecs > 0;
                        const isPaused = attempt.status === "paused";
                        const isDone = liveSecs <= 0;
                        return (
                          <span
                            className={`flex items-center gap-1 font-mono text-sm ${
                              isDone
                                ? "text-red-600 font-bold"
                                : isPaused
                                  ? "text-yellow-600"
                                  : isLow
                                    ? "text-orange-600 font-bold"
                                    : "text-foreground"
                            }`}
                          >
                            <Timer className="h-3 w-3 text-muted-foreground" />
                            {formatTime(liveSecs)}
                            {isPaused && (
                              <span className="ml-1 text-xs text-yellow-600">
                                (frozen)
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {attempt.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {attempt.deviceName ?? "—"}
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate text-xs text-muted-foreground"
                      title={attempt.userAgent ?? ""}
                    >
                      {attempt.userAgent
                        ? attempt.userAgent
                            .replace(
                              /^Mozilla\/.*?AppleWebKit\/.*?\(([^)]+)\).*$/,
                              "$1",
                            )
                            .slice(0, 40)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {attempt.status === "paused" ? (
                        <span className="flex items-center gap-1 text-xs text-yellow-600">
                          <Wifi className="h-3 w-3" />
                          Paused
                        </span>
                      ) : attempt.wsConnected ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <Wifi className="h-3 w-3" />
                          WebSocket
                        </span>
                      ) : attempt.isReconnected ? (
                        <span className="flex items-center gap-1 text-xs text-purple-600">
                          <Wifi className="h-3 w-3" />
                          Reconnected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Wifi className="h-3 w-3" />
                          REST Only
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {attempt.reconnectedCount > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-yellow-600">
                          <AlertTriangle className="h-3 w-3" />
                          {attempt.reconnectedCount}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {attempt.startedAt
                        ? new Date(attempt.startedAt).toLocaleTimeString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {attempt.status === "in_progress" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePause(attempt.id)}
                            title="Pause"
                          >
                            <Pause className="h-4 w-4" />
                          </Button>
                        )}
                        {attempt.status === "paused" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleResume(attempt.id)}
                            title="Resume"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        {(attempt.status === "in_progress" ||
                          attempt.status === "paused") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleTerminate(attempt.id)}
                            title="Terminate"
                          >
                            <Terminal className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
