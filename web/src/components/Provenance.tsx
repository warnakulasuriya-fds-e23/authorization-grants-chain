import { ArrowUp, Crown } from "lucide-react";
import { scopeLabel, useScopes } from "../directory";
import type { Grant, User } from "../types";
import { nameOf, ScopePill, StatusPill } from "./ui";

/** The chain of grants from an official's authority back to the genesis root. */
export default function Provenance({ chain, users }: { chain: Grant[]; users: Record<string, User> }) {
  const scopes = useScopes();
  return (
    <ol className="space-y-1">
      {chain.map((g, i) => (
        <li key={g.txId}>
          {i > 0 && (
            <div className="flex justify-center py-0.5 text-slate-600">
              <ArrowUp className="size-4" />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {g.scope === "ADMIN" && <Crown className="size-3.5 text-amber-300" />}
              <span className="font-medium text-slate-100">{nameOf(users, g.grantee)}</span>
              <span className="text-slate-500">holds</span>
              <ScopePill code={g.scope} label={scopeLabel(scopes, g.scope)} />
              <span className="text-slate-500">granted by</span>
              <span className="text-slate-300">{nameOf(users, g.grantor)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500">block #{g.block}</span>
              <StatusPill status={g.status} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
