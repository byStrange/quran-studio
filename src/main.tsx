import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { I18nProvider } from "./providers/I18nProvider";
import { ToastProvider } from "./components/ui/toast";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Quran content is immutable once seeded, so refetching it is pure waste.
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          {/* Inside AuthProvider and the query client, because the chosen
              language lives in the profile; outside everything that renders
              a string, because all of them ask it for one. */}
          <I18nProvider>
            <ToastProvider>
              {/* Hash routing avoids deep-link 404s under Tauri's asset protocol. */}
              <HashRouter>
                <App />
              </HashRouter>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
