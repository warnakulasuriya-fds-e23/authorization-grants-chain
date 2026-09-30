import { ArrowLeft, Blocks, CircleCheck, CircleX, Clock, ShieldAlert } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Provenance from "../components/Provenance";
import { Alert, Avatar, Card, fmtTime, HashChip, ScopePill, Spinner } from "../components/ui";
import { scopeLabel, usePoll, useScopes, useUsers } from "../directory";
import type { User, VerificationDetail } from "../types";

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return (
    <span className="font-mono">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

function OfficialCard({ official }: { official: User }) {
  return (
    <div className="flex items-center gap-4">
      <Avatar user={official} size="lg" />
      <div>
        <div className="text-xl font-semibold text-white">{official.fullName}</div>
        <div className="text-slate-300">
          {official.title} · {official.organization}
        </div>
        {official.badgeNo && <div className="mt-1 font-mono text-sm text-slate-400">Badge {official.badgeNo}</div>}
      </div>
    </div>
  );
}

export default function VerificationView() {
  const { id = "" } = useParams();
  const scopes = useScopes();
  const users = useUsers();
  const [done, setDone] = useState(false);
  const { data, error } = usePoll(
    () => api<VerificationDetail>(`/verifications/${id}`),
    done ? 3_600_000 : 1500,
    [id, done],
  );

  const status = data?.request.status;
  useEffect(() => {
    if (status && status !== "pending") setDone(true);
  }, [status]);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const { request: req, official } = data;
  const label = scopeLabel(scopes, req.scope);
  const consentUrl = `${window.location.origin}/consent/${req.id}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" /> Back
      </Link>

      {req.status === "pending" && (
        <Card className="p-8 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Ask the official to scan</p>
          <div className="mt-2 flex items-center justify-center gap-2 text-lg text-slate-200">
            Verifying authority for <ScopePill code={req.scope} label={label} />
          </div>
          {req.purpose && <p className="mt-1 text-sm text-slate-400">“{req.purpose}”</p>}
          <div className="pulse-ring mx-auto mt-8 w-fit rounded-3xl bg-white p-5">
            <QRCodeSVG value={consentUrl} size={240} level="M" />
          </div>
          <div className="mt-6 font-mono text-3xl tracking-[0.3em] text-white">
            {req.id.slice(0, 4)}-{req.id.slice(4)}
          </div>
          <p className="mt-1 text-xs text-slate-500">Code for manual entry</p>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400">
            <Spinner className="size-4" /> Waiting for consent · expires in <Countdown until={data.expiresAt} />
          </div>
        </Card>
      )}

      {req.status === "approved" && official && req.proof && (
        <>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 bg-emerald-500/15 px-6 py-4 text-emerald-200">
              <CircleCheck className="size-6" />
              <div>
                <div className="font-semibold">Authorized</div>
                <div className="text-sm text-emerald-200/80">
                  This official holds an active authorization for <b>{label}</b>.
                </div>
              </div>
            </div>
            <div className="space-y-6 p-6">
              <OfficialCard official={official} />
              <div className="grid gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">Consent recorded in</div>
                  <Link to="/explorer" className="mt-1 inline-flex items-center gap-1.5 font-medium text-cyan-300 hover:text-cyan-200">
                    <Blocks className="size-4" /> Block #{req.proof.blockIndex} · mined by {req.proof.minedBy}
                  </Link>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">Checked at</div>
                  <div className="mt-1 text-slate-200">{fmtTime(req.proof.checkedAt)}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">Block hash</div>
                  <div className="mt-1">
                    <HashChip hash={req.proof.blockHash!} full />
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium text-slate-300">Chain of authority</h3>
                <Provenance chain={req.proof.provenance ?? []} users={users} />
              </div>
            </div>
          </Card>
        </>
      )}

      {req.status === "unauthorized" && official && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 bg-rose-500/15 px-6 py-4 text-rose-200">
            <ShieldAlert className="size-6" />
            <div>
              <div className="font-semibold">Not authorized</div>
              <div className="text-sm text-rose-200/80">
                The chain holds no active <b>{label}</b> authorization for this official.
              </div>
            </div>
          </div>
          <div className="p-6">
            <OfficialCard official={official} />
          </div>
        </Card>
      )}

      {(req.status === "declined" || req.status === "expired") && (
        <Card className="flex items-center gap-4 p-6">
          {req.status === "declined" ? <CircleX className="size-8 text-slate-400" /> : <Clock className="size-8 text-slate-400" />}
          <div>
            <div className="font-semibold text-white">{req.status === "declined" ? "The official declined to share" : "Request expired"}</div>
            <div className="text-sm text-slate-400">
              {req.status === "declined" && official ? `${official.fullName} · ${official.organization}. ` : ""}
              Create a new request to try again.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
