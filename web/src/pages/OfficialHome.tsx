import { ArrowRight, BadgeCheck, Crown, KeyRound, ScanLine, ScrollText, Undo2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Avatar, Button, Card, CardHeader, cx, Field, fmtTime, inputCls, nameOf, ScopePill, StatusPill } from "../components/ui";
import { scopeLabel, usePoll, useScopes, useUsers } from "../directory";
import type { Grant, User, Verification } from "../types";

interface Mined {
  block: { index: number; miner: string };
}

function GrantForm({ users, onDone }: { users: Record<string, User>; onDone: () => void }) {
  const { user } = useAuth();
  const scopes = useScopes();
  const officials = Object.values(users).filter((u) => u.role === "official" && u.id !== user?.id);
  const [grantee, setGrantee] = useState("");
  const [scope, setScope] = useState("VEHICLE_SEARCH");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<Mined>("/grants", {
        method: "POST",
        json: { granteeId: grantee, scope, note, expiresAt: expires ? Math.floor(new Date(expires).getTime() / 1000) : 0 },
      });
      setMsg({ ok: true, text: `Granted — mined into block #${res.block.index} by ${res.block.miner}.` });
      setNote("");
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Official">
        <select className={inputCls} value={grantee} onChange={(e) => setGrantee(e.target.value)} required>
          <option value="">Select an official…</option>
          {officials.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} — {u.title}, {u.organization}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Authority">
        <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
          {scopes.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
              {s.code === "ADMIN" ? " (makes them a super official)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Expires (optional)">
        <input className={inputCls} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
      <Field label="Note">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Operation Nightfall" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={busy}>
          <KeyRound className="size-4" /> Grant on-chain
        </Button>
        {msg && (
          <span className={cx("text-sm", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}

function Registry({ grants, users, onDone }: { grants: Grant[]; users: Record<string, User>; onDone: () => void }) {
  const scopes = useScopes();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const revoke = async (g: Grant) => {
    setBusy(g.txId);
    setError("");
    try {
      await api(`/grants/${g.txId}/revoke`, { method: "POST" });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="overflow-x-auto">
      {error && <div className="p-4"><Alert>{error}</Alert></div>}
      <table className="w-full min-w-160 text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Official</th>
            <th className="px-3 py-3 font-medium">Authority</th>
            <th className="px-3 py-3 font-medium">Granted by</th>
            <th className="px-3 py-3 font-medium">Block</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {grants.map((g) => (
            <tr key={g.txId} className={cx(g.status !== "active" && "opacity-50")}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar user={users[g.grantee] ?? { id: g.grantee, fullName: "?" }} size="sm" />
                  <span className="text-slate-100">{nameOf(users, g.grantee)}</span>
                </div>
              </td>
              <td className="px-3 py-3"><ScopePill code={g.scope} label={scopeLabel(scopes, g.scope)} /></td>
              <td className="px-3 py-3 text-slate-300">{nameOf(users, g.grantor)}</td>
              <td className="px-3 py-3 font-mono text-slate-400">#{g.block}</td>
              <td className="px-3 py-3"><StatusPill status={g.status} /></td>
              <td className="px-5 py-3 text-right">
                {g.status === "active" && g.grantor !== "genesis" && (
                  <Button variant="danger" className="px-3 py-1.5 text-xs" loading={busy === g.txId} onClick={() => revoke(g)}>
                    <Undo2 className="size-3.5" /> Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OfficialHome() {
  const { user, refresh } = useAuth();
  const users = useUsers();
  const scopes = useScopes();
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    refresh(); // super-official status may have changed on chain
  }, [refresh, tick]);

  const mine = usePoll(() => api<Grant[]>(`/grants?subject=${user!.id}`), 5000, [tick]);
  const all = usePoll(() => (user?.isSuper ? api<Grant[]>("/grants") : Promise.resolve([])), 5000, [tick, user?.isSuper]);
  const consents = usePoll(() => api<Verification[]>("/verifications"), 5000);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<BadgeCheck className="size-5" />} title="My authorizations" subtitle="Read live from the chain" />
          <ul className="divide-y divide-white/5">
            {mine.data?.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-slate-500">No authorizations have been granted to you yet.</li>
            )}
            {mine.data?.map((g) => (
              <li key={g.txId} className={cx("flex flex-wrap items-center justify-between gap-3 px-5 py-3.5", g.status !== "active" && "opacity-50")}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {g.scope === "ADMIN" && <Crown className="size-4 text-amber-300" />}
                    <ScopePill code={g.scope} label={scopeLabel(scopes, g.scope)} />
                  </div>
                  <div className="text-xs text-slate-400">
                    Granted by {nameOf(users, g.grantor)} · block #{g.block} · {fmtTime(g.grantedAt)}
                    {g.expiresAt ? ` · expires ${fmtTime(g.expiresAt)}` : ""}
                    {g.note ? ` · “${g.note}”` : ""}
                  </div>
                </div>
                <StatusPill status={g.status} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Link to="/scan" className="group block">
            <Card className="relative overflow-hidden p-6 transition group-hover:border-cyan-400/30">
              <div className="absolute -right-6 -top-6 size-32 rounded-full bg-cyan-500/10 blur-2xl" />
              <ScanLine className="size-8 text-cyan-300" />
              <div className="mt-4 text-lg font-semibold text-white">Scan a verifier's QR</div>
              <div className="mt-1 flex items-center gap-1 text-sm text-slate-400">
                Share your authority with consent <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </div>
            </Card>
          </Link>
          <Card>
            <CardHeader icon={<ScrollText className="size-5" />} title="Recent responses" />
            <ul className="divide-y divide-white/5 text-sm">
              {consents.data?.length === 0 && <li className="px-5 py-6 text-center text-slate-500">Nothing yet.</li>}
              {consents.data?.slice(0, 6).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-slate-200">{nameOf(users, v.verifierId)}</div>
                    <div className="text-xs text-slate-500">{scopeLabel(scopes, v.scope)}</div>
                  </div>
                  <StatusPill status={v.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {user?.isSuper && (
        <>
          <Card>
            <CardHeader
              icon={<Crown className="size-5 text-amber-300" />}
              title="Grant an authorization"
              subtitle="You hold ADMIN on-chain. Every grant is mined into a block both nodes replicate."
            />
            <GrantForm users={users} onDone={reload} />
          </Card>
          <Card>
            <CardHeader icon={<KeyRound className="size-5" />} title="Authorization registry" subtitle="All grants derived from the ledger" />
            <Registry grants={all.data ?? []} users={users} onDone={reload} />
          </Card>
        </>
      )}
    </div>
  );
}
