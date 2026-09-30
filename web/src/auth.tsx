import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { Profile } from "./types";

interface AuthState {
  user: Profile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Profile>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      setUser(await api<Profile>("/auth/me"));
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string; user: Profile }>("/auth/login", {
      method: "POST",
      json: { username, password },
    });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
