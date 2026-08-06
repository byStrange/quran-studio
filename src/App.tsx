import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./providers/AuthProvider";
import { AppShell } from "./components/layout/AppShell";
import { WindowFrame } from "./components/layout/TitleBar";
import { AuthScreen } from "./routes/AuthScreen";
import { Dashboard } from "./routes/Dashboard";
import { Browse } from "./routes/Browse";
import { Reader } from "./routes/Reader";
import { MushafReader } from "./routes/MushafReader";
import { Vocabulary } from "./routes/Vocabulary";
import { Quiz } from "./routes/Quiz";
import { Memorization } from "./routes/Memorization";
import { Settings } from "./routes/Settings";
import { About } from "./routes/About";
import { Spinner } from "./components/ui/feedback";

export default function App() {
  const { session, loading } = useAuth();

  // The title bar wraps every state — the window still needs to be draggable
  // and closable while the session is loading or the user is signed out.
  return (
    <WindowFrame>
      {loading ? (
        <div className="grid h-full place-items-center bg-bg">
          <Spinner className="size-6" />
        </div>
      ) : !session ? (
        <AuthScreen />
      ) : (
        <AppShell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/browse" element={<Browse />} />
            {/* Ordered before the ruku route so "page" is never read as one. */}
            <Route path="/read/page/:pageNumber" element={<MushafReader />} />
            <Route path="/read/:rukuNumber" element={<Reader />} />
            <Route path="/vocabulary" element={<Vocabulary />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/memorization" element={<Memorization />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      )}
    </WindowFrame>
  );
}
