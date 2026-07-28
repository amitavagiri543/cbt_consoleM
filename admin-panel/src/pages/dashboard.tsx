import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    Building2,
    ChevronRight,
    ClipboardList,
    FileQuestion,
    GraduationCap,
    Monitor,
    ShieldAlert,
    Users,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { dashboardService } from "../services/dashboard";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  to: string;
  iconBg: string;
  iconColor: string;
  accentBorder?: string;
}

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  to,
  iconBg,
  iconColor,
  accentBorder = "hover:border-primary/50",
}: StatCardProps) {
  const navigate = useNavigate();
  return (
    <Card
      className={`group cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl border border-border/80 bg-card/85 backdrop-blur-md overflow-hidden relative ${accentBorder}`}
      onClick={() => navigate(to)}
    >
      <CardContent className="flex items-center gap-3.5 p-4.5">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg} ${iconColor} shrink-0 transition-all duration-200 group-hover:scale-105 shadow-xs`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80 leading-tight">
            {label}
          </p>
          <p className="text-2xl font-black tracking-tight text-foreground mt-1 leading-none">
            {loading ? (
              <span className="animate-pulse text-muted-foreground">...</span>
            ) : (
              value
            )}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30 transition-all duration-200 group-hover:translate-x-1 group-hover:text-foreground shrink-0" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => dashboardService.getStats(),
  });

  const { data: recentExams } = useQuery({
    queryKey: ["dashboard-recent-exams"],
    queryFn: () => dashboardService.getRecentExams(),
  });

  const { data: recentViolations } = useQuery({
    queryKey: ["dashboard-recent-violations"],
    queryFn: () => dashboardService.getRecentViolations(),
  });

  const { data: statusBreakdown } = useQuery({
    queryKey: ["dashboard-exam-status"],
    queryFn: () => dashboardService.getExamStatusBreakdown(),
  });

  const severityVariant: Record<
    string,
    "default" | "secondary" | "destructive" | "warning" | "outline"
  > = {
    low: "secondary",
    medium: "warning",
    high: "destructive",
    critical: "destructive",
  };

  const statusBadges: Record<string, { bg: string; text: string }> = {
    draft: {
      bg: "bg-slate-500/10 border-slate-500/30",
      text: "text-slate-600 dark:text-slate-400",
    },
    scheduled: {
      bg: "bg-sky-500/10 border-sky-500/30",
      text: "text-sky-600 dark:text-sky-400",
    },
    published: {
      bg: "bg-indigo-500/10 border-indigo-500/30",
      text: "text-indigo-600 dark:text-indigo-400",
    },
    active: {
      bg: "bg-emerald-500/10 border-emerald-500/30",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    paused: {
      bg: "bg-amber-500/10 border-amber-500/30",
      text: "text-amber-600 dark:text-amber-400",
    },
    submission_window: {
      bg: "bg-cyan-500/10 border-cyan-500/30",
      text: "text-cyan-600 dark:text-cyan-400",
    },
    finished: {
      bg: "bg-zinc-500/10 border-zinc-500/30",
      text: "text-zinc-600 dark:text-zinc-400",
    },
    results_published: {
      bg: "bg-purple-500/10 border-purple-500/30",
      text: "text-purple-600 dark:text-purple-400",
    },
    archived: {
      bg: "bg-zinc-400/10 border-zinc-400/30",
      text: "text-zinc-500",
    },
  };

  return (
    <div className="space-y-6">
      {/* Stat Cards Grid */}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        <StatCard
          label="Total Users"
          value={stats?.users ?? 0}
          icon={Users}
          loading={statsLoading}
          to="/users"
          iconBg="bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Institutions"
          value={stats?.institutions ?? 0}
          icon={Building2}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-indigo-500/15"
          iconColor="text-indigo-600 dark:text-indigo-400"
        />
        <StatCard
          label="Subjects"
          value={stats?.subjects ?? 0}
          icon={GraduationCap}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-purple-500/15"
          iconColor="text-purple-600 dark:text-purple-400"
        />
        <StatCard
          label="Questions"
          value={stats?.questions ?? 0}
          icon={FileQuestion}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-cyan-500/15"
          iconColor="text-cyan-600 dark:text-cyan-400"
        />
        <StatCard
          label="Exams"
          value={stats?.exams ?? 0}
          icon={ClipboardList}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-amber-500/15"
          iconColor="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Candidates"
          value={stats?.candidates ?? 0}
          icon={Users}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-pink-500/15"
          iconColor="text-pink-600 dark:text-pink-400"
        />
        <StatCard
          label="Devices"
          value={stats?.devices ?? 0}
          icon={Monitor}
          loading={statsLoading}
          to="/devices"
          iconBg="bg-teal-500/15"
          iconColor="text-teal-600 dark:text-teal-400"
        />
        <StatCard
          label="Active Sessions"
          value={stats?.activeAttempts ?? 0}
          icon={Activity}
          loading={statsLoading}
          to="/live-monitor"
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-600 dark:text-emerald-400"
          accentBorder="hover:border-emerald-500/50"
        />
        <StatCard
          label="Active Batches"
          value={stats?.activeBatches ?? 0}
          icon={Activity}
          loading={statsLoading}
          to="/live-monitor"
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Total Violations"
          value={stats?.violations ?? 0}
          icon={ShieldAlert}
          loading={statsLoading}
          to="/violations"
          iconBg="bg-rose-500/15"
          iconColor="text-rose-600 dark:text-rose-400"
          accentBorder="hover:border-rose-500/50"
        />
        <StatCard
          label="Unresolved"
          value={stats?.unresolvedViolations ?? 0}
          icon={ShieldAlert}
          loading={statsLoading}
          to="/violations"
          iconBg="bg-red-500/15"
          iconColor="text-red-600 dark:text-red-400"
          accentBorder="hover:border-red-500/50"
        />
        <StatCard
          label="Total Batches"
          value={(statusBreakdown?.data ?? []).reduce(
            (sum, s) => sum + s.count,
            0,
          )}
          icon={ClipboardList}
          loading={statsLoading}
          to="/institutions"
          iconBg="bg-slate-500/15"
          iconColor="text-slate-600 dark:text-slate-400"
        />
      </div>

      {/* Exam batch status breakdown card */}
      <Card
        className="cursor-pointer transition-all duration-200 hover:border-primary/40 border-border/80 bg-card/80 backdrop-blur-md"
        onClick={() => navigate("/live-monitor")}
      >
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-foreground tracking-tight">
              Exam Batch Status Breakdown
            </p>
            <span className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              View Live Monitor <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {(statusBreakdown?.data ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No active exam batches registered
              </span>
            ) : (
              (statusBreakdown?.data ?? []).map((s) => {
                const style = statusBadges[s.status] ?? {
                  bg: "bg-slate-500/10 border-slate-500/30",
                  text: "text-slate-600 dark:text-slate-400",
                };
                return (
                  <div
                    key={s.status}
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-semibold ${style.bg} ${style.text}`}
                  >
                    <span className="capitalize">
                      {s.status.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-bold shadow-xs">
                      {s.count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Exams & Recent Violations section */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          className="cursor-pointer border-border/80 bg-card/80 backdrop-blur-md hover:border-primary/40 transition-all duration-200"
          onClick={() => navigate("/institutions")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">Recent Exams</p>
              <span className="text-xs font-semibold text-primary hover:underline">
                Explore Exams →
              </span>
            </div>
            {(recentExams?.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No recent exams configured.
              </p>
            ) : (
              <div className="space-y-2.5">
                {(recentExams?.data ?? []).map((exam) => (
                  <div
                    key={exam.id}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-background/50 p-3 transition-all duration-200 hover:bg-accent/60 hover:border-border"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/exams/${exam.id}`);
                    }}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {exam.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] font-mono"
                        >
                          {exam.code}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground mt-0.5">
                        {exam.subjectName ?? "General"} • {exam.durationMinutes}{" "}
                        min • {exam.totalMarks} marks
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer border-border/80 bg-card/80 backdrop-blur-md hover:border-primary/40 transition-all duration-200"
          onClick={() => navigate("/violations")}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">
                Recent Violations
              </p>
              <span className="text-xs font-semibold text-primary hover:underline">
                View All Alerts →
              </span>
            </div>
            {(recentViolations?.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No security violations detected.
              </p>
            ) : (
              <div className="space-y-2.5">
                {(recentViolations?.data ?? []).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-background/50 p-3 transition-all duration-200 hover:bg-accent/60 hover:border-border"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold capitalize text-foreground">
                          {v.violationType.replace(/_/g, " ")}
                        </span>
                        <Badge
                          variant={severityVariant[v.severity] ?? "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {v.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {new Date(v.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge
                      variant={v.isResolved ? "success" : "destructive"}
                      className="shrink-0 text-[10px] ml-2"
                    >
                      {v.isResolved ? "Resolved" : "Open Alert"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
