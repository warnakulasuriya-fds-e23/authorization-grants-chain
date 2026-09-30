import { ChevronRight, QrCode, ScrollText } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Alert, Button, Card, CardHeader, Field, fmtTime, inputCls, nameOf, ScopePill, StatusPill } from "../components/ui";
import { scopeLabel, usePoll, useScopes, useUsers } from "../directory";
import type { Verification, VerificationDetail } from "../types";

export default function VerifierHome() {
  const scopes = useScopes().filter((s) => s.code !== "ADMIN");
  const users = useUsers();
  const navigate = useNavigate();
  const [scope, setScope] = useState("VEHICLE_SEARCH");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data: history } = usePoll(() => api<Verification[]>("/verifications"), 4000);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<VerificationDetail>("/verifications", { method: "POST", json: { scope, purpose } });
      navigate(`/verify/${res.request.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader icon={<QrCode className="size-5" />} title="Verify an official" subtitle="Generate a QR code for the official to scan" />
        <form onSubmit={submit} className="space-y-4 p-5">
          <Field label="What are they about to do?">
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label} — {s.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Context (optional)" hint="Shown to the official when they scan.">
            <input className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Roadside stop on the A1" />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} className="w-full">
            <QrCode className="size-4" /> Generate QR code
          </Button>
        </form>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader icon={<ScrollText className="size-5" />} title="My verifications" subtitle="Your recent requests and their outcomes" />
        <ul className="divide-y divide-white/5">
          {history?.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No verification requests yet.</li>}
          {history?.map((v) => (
            <li key={v.id}>
              <Link to={`/verify/${v.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-white/[0.03]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ScopePill code={v.scope} label={scopeLabel(scopes, v.scope)} />
                    <span className="font-mono text-xs text-slate-500">{v.id}</span>
                  </div>
                  <div className="truncate text-sm text-slate-400">
                    {v.officialId ? nameOf(users, v.officialId) : "Awaiting official"} · {fmtTime(v.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={v.status} />
                  <ChevronRight className="size-4 text-slate-600" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
