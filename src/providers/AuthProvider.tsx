import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { isAuthRetryableFetchError, type Session, type User } from "@supabase/supabase-js";
import { readStoredSession, supabase } from "@/lib/supabase";
import { detectTimezone } from "@/lib/utils";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been restored from storage. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    // Offline at launch, the stored session is used straight away. Waiting
    // for getSession would mean sitting through supabase-js retrying a token
    // refresh with backoff — half a minute of spinner in front of content
    // that is already on disk. getSession still runs, and replaces this with
    // a refreshed session if the network turns out to be there after all.
    if (!onlineManager.isOnline()) {
      const stored = readStoredSession();
      if (stored) {
        setSession(stored);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (!data.session && error && isAuthRetryableFetchError(error)) {
        const stored = readStoredSession();
        // Couldn't refresh for want of a network: the stored session stands
        // in until the client refreshes it for real and says so.
        if (stored) {
          setSession(stored);
          setLoading(false);
          return;
        }
      }
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      // An empty initial event is getSession's answer arriving twice, and
      // getSession above is the one that knows whether it was only offline.
      // A real sign-out arrives as SIGNED_OUT and still goes through.
      if (!next && event === "INITIAL_SESSION") return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },

      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Seed the profile timezone from the machine so streak day
          // boundaries are right from the very first session.
          options: { data: { timezone: detectTimezone() } },
        });
        if (error) throw error;
        // With email confirmation enabled Supabase returns a user but no session.
        return { needsConfirmation: !data.session };
      },

      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        // The cache is persisted to disk now, so one account's progress must
        // not be left there for whoever signs in next.
        queryClient.clear();
      },
    }),
    [session, loading, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
