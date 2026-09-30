import { Blocks, CircleCheck, CircleX, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Avatar, Button, Card, fmtTime, ScopePill, Spinner, StatusPill } from "../components/ui";
import { scopeLabel, useScopes } from "../directory";
import type { Grant, VerificationDetail } from "../types";

export default function Consent() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const scopes = useScopes();
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [held, setHeld] = useState<Grant | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "decline">("");

  useEffect(() => {
    api<VerificationDetail>(`/verifications/${id}`)
      .then(async (d) => {
        setDetail(d);
        const grants = await api<Grant[]>(`/grants?subject=${user!.id}&scope=${d.request.scope}`);
        setHeld(grants.find((g) => g.status === "active") ?? null);
      })
      .catch((e) => setError(e.message));
  }, [id, user]);

  const decide = async (action: "approve" | "decline") => {
    setBusy(action);
    setError("");
    try {
      setDetail(await api<VerificationDetail>(`/verifications/${id}/${action}`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (error && !detail) return <div className="mx-auto max-w-xl"><Alert>{error}</Alert></div>;
  if (!detail) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const { request: req, verifier } = detail;
  const label = scopeLabel(scopes, req.scope);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card className="overflow-hidden">
        <div className="border-b border-white/5 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Verification request · {req.id}</p>
          <h1 className="mt-2 text-xl font-semibold text-white">Someone wants to verify your authority</h1>
        </div>
        <div className="space-y-5 p-6">
          {verifier && (
            <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-4">
              <Avatar user={verifier} />
              <div>
                <div className="flex items-center gap-1.5 font-medium text-slate-100">
                  <UserRound className="size-3.5 text-slate-400" /> {verifier.fullName}
                </div>
                <div className="text-sm text-slate-400">
                  {verifier.title} · {verifier.organization}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">Authority requested</div>
            <div className="flex flex-wrap items-center gap-2">
              <ScopePill code={req.scope} label={label} />
              <span className="text-sm text-slate-400">{scopes.find((s) => s.code === req.scope)?.description}</span>
            </div>
            {req.purpose && <p className="text-sm text-slate-300">“{req.purpose}”</p>}
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">What will be shared</div>
            <p className="text-sm text-slate-300">
              Your name, title, organisation and badge number, plus the on-chain proof of your authorization. A{" "}
              <span className="font-mono text-sky-300">VERIFY</span> record is added to the ledger.
            </p>
          </div>

          {req.status === "pending" && held !== undefined && (
            held ? (
              <Alert tone="info">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4" /> You hold this authority (granted in block #{held.block}).
                </span>
              </Alert>
            ) : (
              <Alert>
                <span className="flex items-center gap-2">
                  <ShieldAlert className="size-4" /> You do not hold this authority. If you consent, the verifier will be told you are not
                  authorized.
                </span>
              </Alert>
            )
          )}
          {error && <Alert>{error}</Alert>}
        </div>

        {req.status === "pending" ? (
          <div className="grid grid-cols-2 gap-3 border-t border-white/5 p-6">
            <Button variant="ghost" loading={busy === "decline"} disabled={!!busy} onClick={() => decide("decline")}>
              <CircleX className="size-4" /> Decline
            </Button>
            <Button variant="success" loading={busy === "approve"} disabled={!!busy} onClick={() => decide("approve")}>
              <CircleCheck className="size-4" /> Consent & share
            </Button>
          </div>
        ) : (
          <div className="space-y-3 border-t border-white/5 p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Outcome</span>
              <StatusPill status={req.status} />
            </div>
            {req.status === "approved" && req.proof && (
              <p className="text-sm text-slate-300">
                Shared with {verifier?.fullName} at {fmtTime(req.proof.checkedAt)}. Recorded in{" "}
                <Link to="/explorer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200">
                  <Blocks className="size-3.5" /> block #{req.proof.blockIndex}
                </Link>
                .
              </p>
            )}
            {req.status === "unauthorized" && (
              <p className="text-sm text-rose-300">The chain holds no active {label} authorization for you. The verifier has been told.</p>
            )}
            <Link to="/" className="block pt-2 text-center text-sm text-slate-400 hover:text-white">
              Back to dashboard
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
