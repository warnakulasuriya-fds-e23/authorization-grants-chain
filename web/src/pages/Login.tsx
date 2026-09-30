import { ArrowRight, BadgeCheck, Blocks, QrCode, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../components/Layout";
import { Alert, Button, Card, Field, inputCls } from "../components/ui";

interface DemoAccounts {
  password: string;
  accounts: { username: string; fullName: string; role: string; title: string }[];
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);

  useEffect(() => {
    api<DemoAccounts>("/auth/demo-accounts").then(setDemo).catch(() => {});
  }, []);

  const doLogin = async (u: string, p: string) => {
    setBusy(true);
    setError("");
    try {
      await login(u, p);
      navigate(from, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    doLogin(username, password);
  };

  const groups = [
    { role: "official", title: "Officials" },
    { role: "verifier", title: "Verifiers" },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-white/5 p-12 lg:flex">
        <Logo />
        <div className="max-w-md space-y-6">
          <h1 className="text-4xl font-semibold leading-tight text-white">
            Who authorized <span className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">whom</span>, to do{" "}
            <span className="bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">what</span>?
          </h1>
          <p className="text-slate-400">
            Official authorizations recorded on a shared, tamper-evident ledger. Scan a QR code, get the official's consent, and see the
            proof — right back to the root authority.
          </p>
          <ul className="space-y-3 text-sm text-slate-300">
            {[
              [QrCode, "Verifier shows a QR code, the official scans it"],
              [BadgeCheck, "Official consents; the chain checks their grant"],
              [Blocks, "Every grant, revocation and check lives on-chain"],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof QrCode;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-cyan-300">
                    <I className="size-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <Link to="/explorer" className="flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300">
          Browse the ledger without logging in <ArrowRight className="size-4" />
        </Link>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden">
            <Logo />
          </div>
          <Card className="p-6">
            <div className="mb-6 flex items-center gap-3">
              <ShieldCheck className="size-6 text-cyan-300" />
              <div>
                <h2 className="text-lg font-semibold text-white">Sign in</h2>
                <p className="text-sm text-slate-400">Credentials are stored off-chain.</p>
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Username">
                <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
              </Field>
              <Field label="Password">
                <input
                  className={inputCls}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              {error && <Alert>{error}</Alert>}
              <Button type="submit" loading={busy} className="w-full">
                Sign in
              </Button>
            </form>
          </Card>

          {demo && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Demo accounts · password <span className="font-mono text-slate-300">{demo.password}</span>
              </p>
              {groups.map((g) => (
                <div key={g.role} className="space-y-2">
                  <p className="text-xs text-slate-400">{g.title}</p>
                  <div className="flex flex-wrap gap-2">
                    {demo.accounts
                      .filter((a) => a.role === g.role)
                      .map((a) => (
                        <button
                          key={a.username}
                          onClick={() => doLogin(a.username, demo.password)}
                          disabled={busy}
                          className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:border-cyan-400/40 hover:bg-cyan-400/5"
                        >
                          <div className="text-sm font-medium text-slate-100">{a.fullName}</div>
                          <div className="text-xs text-slate-400">
                            {a.title} · <span className="font-mono">{a.username}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
