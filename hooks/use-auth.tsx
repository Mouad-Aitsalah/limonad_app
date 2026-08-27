"use client";

import * as React from "react";

import type { CurrentUser } from "@/types/auth";

type LoginResult =
  | { success: true; user: CurrentUser }
  | { success: false; error: string };

type AuthContextValue = {
  currentUser: CurrentUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

async function fetchSessionUser(): Promise<CurrentUser | null> {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = (await response.json()) as { user: CurrentUser | null };
  return payload.user;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = React.useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const refreshSession = React.useCallback(async () => {
    try {
      setCurrentUser(await fetchSessionUser());
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;

    fetchSessionUser()
      .then((user) => {
        if (!active) return;
        setCurrentUser(user);
      })
      .catch(() => {
        if (!active) return;
        setCurrentUser(null);
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = React.useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as {
        user?: CurrentUser;
        message?: string;
      };

      if (!response.ok || !payload.user) {
        return {
          success: false,
          error: payload.message ?? "Email ou mot de passe incorrect.",
        };
      }

      setCurrentUser(payload.user);
      return { success: true, user: payload.user };
    },
    [],
  );

  const logout = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setCurrentUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ currentUser, isLoading, login, logout, refreshSession }),
    [currentUser, isLoading, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
