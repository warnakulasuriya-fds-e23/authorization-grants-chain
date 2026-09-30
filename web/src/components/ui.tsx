import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Grant, User, VerificationStatus } from "../types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-2xl border border-white/8 bg-slate-900/60 backdrop-blur-sm shadow-xl shadow-black/20", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: string; subtitle?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
      <div className="flex items-center gap-3">
        {icon && <div className="grid size-9 place-items-center rounded-xl bg-white/5 text-cyan-300">{icon}</div>}
        <div>
          <h2 className="font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

type Variant = "primary" | "ghost" | "danger" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20 hover:brightness-110",
  ghost: "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
  danger: "border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
  success: "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400",
};

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx("size-5 animate-spin text-cyan-300", className)} />;
}

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  return (
    <div
      className={cx(
        "rounded-xl border px-3.5 py-2.5 text-sm",
        tone === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
      )}
    >
      {children}
    </div>
  );
}

// --- identity -------------------------------------------------------------------

const gradients = [
  "from-cyan-400 to-blue-500",
  "from-violet-400 to-fuchsia-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
  "from-sky-400 to-indigo-500",
];

export function Avatar({ user, size = "md" }: { user?: Pick<User, "fullName" | "id">; size?: "sm" | "md" | "lg" }) {
  const name = user?.fullName ?? "?";
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const g = gradients[(user?.id ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % gradients.length];
  const s = { sm: "size-7 text-[11px]", md: "size-10 text-sm", lg: "size-16 text-xl" }[size];
  return <div className={cx("grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white", g, s)}>{initials}</div>;
}

export function shortId(id: string) {
  return id === "genesis" ? "genesis" : id.slice(-4);
}

/** Resolves an on-chain user id to a display name via the off-chain directory. */
export function nameOf(users: Record<string, User>, id: string) {
  if (id === "genesis") return "Genesis";
  return users[id]?.fullName ?? `user …${shortId(id)}`;
}

// --- chain bits -------------------------------------------------------------------

/** A stable hue per hash, so matching hash/prevHash pairs share a colour. */
export function hashHue(hash: string) {
  const body = hash.replace(/^0+/, "").slice(0, 6) || "0";
  return parseInt(body, 16) % 360;
}

export function HashChip({ hash, label, full }: { hash: string; label?: string; full?: boolean }) {
  const hue = hashHue(hash);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-slate-300">
      <span className="size-2 shrink-0 rounded-full" style={{ background: `hsl(${hue} 85% 60%)`, boxShadow: `0 0 8px hsl(${hue} 85% 60%)` }} />
      {label && <span className="text-slate-500">{label}</span>}
      <span className={full ? "break-all" : "truncate"}>{full ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`}</span>
    </span>
  );
}

const txTone: Record<string, string> = {
  GRANT: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  REVOKE: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
  VERIFY: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
  GENESIS: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
};

export function TxBadge({ type }: { type: string }) {
  return <span className={cx("rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ring-1", txTone[type])}>{type}</span>;
}

export function ScopePill({ code, label }: { code: string; label?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
        code === "ADMIN" ? "bg-amber-500/10 text-amber-300 ring-amber-400/30" : "bg-cyan-500/10 text-cyan-200 ring-cyan-400/25",
      )}
    >
      {label ?? code}
    </span>
  );
}

const statusTone: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  pending: "bg-amber-500/15 text-amber-300",
  revoked: "bg-rose-500/15 text-rose-300",
  declined: "bg-slate-500/20 text-slate-300",
  unauthorized: "bg-rose-500/15 text-rose-300",
  expired: "bg-slate-500/20 text-slate-400",
};

export function StatusPill({ status }: { status: VerificationStatus | Grant["status"] }) {
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium capitalize", statusTone[status])}>{status}</span>;
}

export function fmtTime(unixOrIso: number | string) {
  const d = typeof unixOrIso === "number" ? new Date(unixOrIso * 1000) : new Date(unixOrIso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
