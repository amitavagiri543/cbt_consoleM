import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    Bell,
    Building2,
    CheckCircle2,
    ChevronDown,
    GraduationCap,
    Info,
    LayoutDashboard,
    LogOut,
    Monitor,
    PanelLeft,
    PanelLeftClose,
    ScrollText,
    Settings,
    ShieldAlert,
    Users,
    X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { auditLogService } from "../../services/audit-logs";
import { useAuthStore } from "../../stores/auth-store";
import { useUIStore } from "../../stores/ui-store";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Users", icon: Users, end: false },
  { to: "/institutions", label: "Institutions", icon: Building2, end: false },
  { to: "/devices", label: "Devices", icon: Monitor, end: false },
  { to: "/live-monitor", label: "Live Monitor", icon: Activity, end: false },
  { to: "/violations", label: "Violations", icon: ShieldAlert, end: false },
  { to: "/analytics", label: "Analytics", icon: BarChart3, end: false },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText, end: false },
  {
    to: "/system-settings",
    label: "System Settings",
    icon: Settings,
    end: false,
  },
];

const segmentTitles: Record<string, string> = {
  "": "Dashboard",
  users: "Users",
  institutions: "Institutions",
  devices: "Devices",
  "live-monitor": "Live Monitor",
  results: "Results & Grading",
  violations: "Violations",
  analytics: "Analytics",
  "audit-logs": "Audit Logs",
  "system-settings": "System Settings",
  exams: "Exams",
};

const segmentSubtitles: Record<string, string> = {
  "": "System overview & real-time examination metrics",
  users: "Manage system administrator users, proctors, and access roles",
  institutions:
    "Manage educational institutions, departments, and exam centers",
  devices: "Register, monitor, and manage exam client devices",
  "live-monitor": "Real-time active examination sessions & proctoring console",
  results: "Candidate performance, test scores, and grading reports",
  violations: "Security violation alerts and incident proctoring logs",
  analytics: "System performance analytics & examination statistics",
  "audit-logs": "Track system security, authentication, and admin audit events",
  "system-settings":
    "Global platform configuration, security rules, and system defaults",
  exams:
    "Configure computer-based examinations, subject papers, and question banks",
};

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const customBreadcrumbs = useUIStore((s) => s.customBreadcrumbs);
  const setCustomBreadcrumbs = useUIStore((s) => s.setCustomBreadcrumbs);
  const pageHeaderOverride = useUIStore((s) => s.pageHeaderOverride);
  const setPageHeaderOverride = useUIStore((s) => s.setPageHeaderOverride);
  const backAction = useUIStore((s) => s.backAction);

  // Clear custom breadcrumbs and page header override when route pathname changes
  useEffect(() => {
    setCustomBreadcrumbs(null);
    setPageHeaderOverride(null);
  }, [location.pathname, setCustomBreadcrumbs, setPageHeaderOverride]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const initials = user?.role?.charAt(0).toUpperCase() ?? "A";

  // Build full dynamic path segments for navbar breadcrumbs
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const currentSegment = pathSegments[0] ?? "";

  const defaultBreadcrumbs = [
    { label: "Console", path: "/" },
    ...pathSegments.map((segment, index) => {
      const path = "/" + pathSegments.slice(0, index + 1).join("/");
      const title =
        segmentTitles[segment] ??
        (segment.length > 12 ? `#${segment.slice(0, 8)}...` : segment);
      return { label: title, path };
    }),
  ];

  const breadcrumbs = customBreadcrumbs
    ? [{ label: "Console", path: "/" }, ...customBreadcrumbs]
    : defaultBreadcrumbs;

  const currentPageTitle =
    pageHeaderOverride?.title ??
    breadcrumbs[breadcrumbs.length - 1]?.label ??
    "Dashboard";
  const currentPageSubtitle =
    pageHeaderOverride?.subtitle ??
    segmentSubtitles[currentSegment] ??
    "CBE Console Admin Workspace";

  interface NotificationItem {
    id: string;
    title: string;
    message: string;
    time: string;
    type: "warning" | "success" | "info";
    read: boolean;
  }

  const NOTIFS_STORAGE_KEY = "cbe_console_notifications_list_v1";
  const REMOVED_NOTIFS_KEY = "cbe_console_removed_notifications_v1";

  const getRemovedIds = (): Set<string> => {
    try {
      const raw = localStorage.getItem(REMOVED_NOTIFS_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) {
      console.error(e);
    }
    return new Set<string>();
  };

  const getSavedNotifications = (): NotificationItem[] => {
    try {
      const raw = localStorage.getItem(NOTIFS_STORAGE_KEY);
      if (raw !== null) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  };

  const [notifications, setNotifications] = useState<NotificationItem[]>(
    getSavedNotifications,
  );
  const [removedIds, setRemovedIds] = useState<Set<string>>(getRemovedIds);

  // Sync notifications & removed IDs to localStorage immediately
  useEffect(() => {
    try {
      localStorage.setItem(NOTIFS_STORAGE_KEY, JSON.stringify(notifications));
      localStorage.setItem(
        REMOVED_NOTIFS_KEY,
        JSON.stringify(Array.from(removedIds)),
      );
    } catch (e) {
      console.error(e);
    }
  }, [notifications, removedIds]);

  // Fetch real system audit logs to populate live system notifications
  const { data: auditLogsData } = useQuery({
    queryKey: ["audit-logs-notifications"],
    queryFn: () => auditLogService.list({ page: 1, pageSize: 10 }),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Automatically map real system activity into notifications without re-adding removed ones
  useEffect(() => {
    if (!auditLogsData?.data || auditLogsData.data.length === 0) return;

    setNotifications((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const newItems: NotificationItem[] = [];

      auditLogsData.data.forEach((log) => {
        if (existingIds.has(log.id) || removedIds.has(log.id)) return;

        const actionText = log.action.replace(/_/g, " ").toUpperCase();
        const isViolation =
          log.action.toLowerCase().includes("violation") ||
          log.action.toLowerCase().includes("failed") ||
          log.action.toLowerCase().includes("error");
        const isSuccess =
          log.action.toLowerCase().includes("completed") ||
          log.action.toLowerCase().includes("created") ||
          log.action.toLowerCase().includes("login");

        newItems.push({
          id: log.id,
          title: actionText,
          message: `${log.userFullName || log.userEmail || "System User"}: ${log.resourceType}${log.resourceId ? ` (#${log.resourceId.slice(0, 6)})` : ""}`,
          time: new Date(log.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          type: isViolation ? "warning" : isSuccess ? "success" : "info",
          read: false,
        });
      });

      if (newItems.length === 0) return prev;
      return [...newItems, ...prev];
    });
  }, [auditLogsData, removedIds]);

  const removeNotification = (id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAllNotifications = () => {
    setNotifications((prev) => {
      const ids = prev.map((item) => item.id);
      setRemovedIds((rPrev) => {
        const next = new Set(rPrev);
        ids.forEach((i) => next.add(i));
        return next;
      });
      return [];
    });
  };

  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Modern Floating Glass Sidebar */}
      <aside
        className={`flex flex-col border-r border-border bg-card transition-[width] duration-200 z-20 shrink-0 ${
          collapsed ? "w-18" : "w-64"
        }`}
      >
        {/* Brand Logo Header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-4 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-sm">
            <GraduationCap className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-base font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
                CBE Console
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Enterprise Admin
              </span>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto">
          {!collapsed && (
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Menu
            </div>
          )}
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors group ${
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`
              }
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Right Content Panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Navbar Header */}
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeft className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>

            {/* Dynamic Full Sub-Path Breadcrumbs */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium">
              {breadcrumbs.map((crumb, idx) => (
                <div
                  key={(crumb.path || crumb.label) + idx}
                  className="flex items-center gap-1.5"
                >
                  {idx > 0 && (
                    <span className="text-muted-foreground/40 font-mono">
                      /
                    </span>
                  )}
                  {crumb.path && idx < breadcrumbs.length - 1 ? (
                    <NavLink
                      to={crumb.path}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {crumb.label}
                    </NavLink>
                  ) : (
                    <span className="font-bold text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-3">
            {/* Notification Bell Dropdown */}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="relative h-9 w-9 rounded-lg"
                >
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                      {unreadCount}
                    </span>
                  )}
                  <span className="sr-only">Notifications</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 sm:w-96 p-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/80 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-foreground">
                      Notifications
                    </h4>
                    {unreadCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0.2"
                      >
                        {unreadCount} new
                      </Badge>
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={clearAllNotifications}
                    >
                      Clear All
                    </Button>
                  )}
                </div>

                <div className="max-h-[340px] overflow-y-auto divide-y divide-border/50">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      <Bell className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                      No notifications
                    </div>
                  ) : (
                    notifications.map((item) => (
                      <div
                        key={item.id}
                        className={`group relative flex items-start gap-3 p-3.5 transition-colors hover:bg-accent/50 ${
                          !item.read ? "bg-accent/20" : ""
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {item.type === "warning" && (
                            <ShieldAlert className="h-4 w-4 text-amber-500" />
                          )}
                          {item.type === "success" && (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          )}
                          {item.type === "info" && (
                            <Info className="h-4 w-4 text-blue-500" />
                          )}
                        </div>

                        <div className="flex-1 pr-6 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold text-foreground truncate">
                              {item.title}
                            </p>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                            {item.message}
                          </p>
                          <span className="text-[10px] text-muted-foreground/70 font-mono mt-1 block">
                            {item.time}
                          </span>
                        </div>

                        {/* REMOVE / CROSS BUTTON */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(item.id);
                          }}
                          className="absolute top-3 right-3 p-1 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors cursor-pointer"
                          title="Remove notification"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Theme Toggle Removed - Light mode only */}

            {/* User Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2.5 p-1 px-2 rounded-xl hover:bg-accent/60"
                >
                  <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="text-xs font-semibold leading-tight text-foreground">
                      {user?.role ?? "Admin"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                      {user?.id ?? "administrator"}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-semibold leading-none">
                      {user?.role ?? "Admin Account"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground font-mono">
                      {user?.id}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Sticky Prominent Page Header Bar with Title and Subtitle */}
        <div className="sticky top-0 z-10 flex py-2.5 px-6 sm:px-8 items-center justify-between border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            {backAction && (
              <button
                onClick={backAction}
                className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground truncate">
                {currentPageTitle}
              </h1>
              <p className="text-[11px] font-medium text-muted-foreground/80 truncate">
                {currentPageSubtitle}
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs font-semibold shrink-0">
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-3 py-1 font-mono text-[11px] shadow-2xs">
              LIVE SYSTEM
            </span>
          </div>
        </div>

        {/* Dynamic Route Content Outlet */}

        <main className="flex-1 overflow-auto p-6 md:p-8">
          <div className="mx-auto max-w-7xl w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
