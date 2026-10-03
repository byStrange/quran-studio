import React from "react";
import ReactDOM from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { I18nProvider } from "./providers/I18nProvider";
import { ToastProvider } from "./components/ui/toast";
import "./index.css";

import { persistOptions, queryClient } from "./lib/queryClient";
import { loadManifest } from "./lib/offline/packs";

// Which offline packs are installed, read before the first content query asks.
void loadManifest();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      // Marks made offline in an earlier session go out once the cache (and
      // the queue inside it) is back.
      onSuccess={() => void queryClient.resumePausedMutations()}
    >
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
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
