import { useEffect, useState } from "react";
import { api } from "./api";
import type { Scope, User } from "./types";

// Off-chain lookups: the chain only knows user ids, the directory knows names.
let usersCache: Promise<User[]> | null = null;
let scopesCache: Promise<Scope[]> | null = null;

export function useUsers(enabled = true) {
  const [users, setUsers] = useState<Record<string, User>>({});
  useEffect(() => {
    if (!enabled) return;
    usersCache ??= api<User[]>("/users").catch((e) => {
      usersCache = null;
      throw e;
    });
    usersCache.then((list) => setUsers(Object.fromEntries(list.map((u) => [u.id, u])))).catch(() => {});
  }, [enabled]);
  return users;
}

export function clearDirectoryCache() {
  usersCache = null;
}

export function useScopes() {
  const [scopes, setScopes] = useState<Scope[]>([]);
  useEffect(() => {
    scopesCache ??= api<Scope[]>("/scopes");
    scopesCache.then(setScopes).catch(() => (scopesCache = null));
  }, []);
  return scopes;
}

export function scopeLabel(scopes: Scope[], code: string) {
  return scopes.find((s) => s.code === code)?.label ?? code;
}

/** Polls `fn` every `ms` while mounted. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fn()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message));
    tick();
    const t = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, setData };
}
