import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  /** What is actually on screen once "system" is resolved. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "qs.theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    readStored() === "system" ? (systemPrefersDark() ? "dark" : "light") : (readStored() as "light" | "dark"),
  );

  useEffect(() => {
    const apply = () => {
      const next = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
      document.documentElement.classList.toggle("dark", next === "dark");
      setResolved(next);
    };
    apply();

    if (theme !== "system") return;
    // Track the OS setting only while the user has chosen to follow it.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice just won't survive a restart */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
