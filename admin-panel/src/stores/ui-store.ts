import { create } from "zustand";

export type ThemeMode = "dark" | "light" | "system";

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

export interface PageHeaderOverride {
  title: string;
  subtitle?: string;
}

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  customBreadcrumbs: BreadcrumbItem[] | null;
  setCustomBreadcrumbs: (crumbs: BreadcrumbItem[] | null) => void;
  pageHeaderOverride: PageHeaderOverride | null;
  setPageHeaderOverride: (header: PageHeaderOverride | null) => void;
  backAction: (() => void) | null;
  setBackAction: (action: (() => void) | null) => void;
}

const getInitialTheme = (): ThemeMode => {
  return "light";
};

const applyThemeToDOM = (_theme: ThemeMode) => {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add("light");
};

// Initial theme application on load
const initialTheme = getInitialTheme();
applyThemeToDOM(initialTheme);

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  theme: initialTheme,
  setTheme: (theme: ThemeMode) => {
    localStorage.setItem("cbe-theme", theme);
    applyThemeToDOM(theme);
    set({ theme });
  },
  customBreadcrumbs: null,
  setCustomBreadcrumbs: (customBreadcrumbs) => set({ customBreadcrumbs }),
  pageHeaderOverride: null,
  setPageHeaderOverride: (pageHeaderOverride) => set({ pageHeaderOverride }),
  backAction: null,
  setBackAction: (backAction) => set({ backAction }),
}));


