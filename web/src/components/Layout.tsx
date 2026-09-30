import { Blocks, Crown, LayoutDashboard, LogOut, ScanLine } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { clearDirectoryCache } from "../directory";
import { Avatar, cx } from "./ui";

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8">
        <rect x="3" y="10" width="14" height="12" rx="4" fill="none" stroke="#22d3ee" strokeWidth="2.5" />
        <rect x="15" y="10" width="14" height="12" rx="4" fill="none" stroke="#a78bfa" strokeWidth="2.5" />
      </svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">Authorization Grants</div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Chain</div>
      </div>
    </div>
  );
}

function Tab({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cx(
          "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition",
          isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200",
        )
      }
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/70 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="flex items-center gap-1">
              {user && <Tab to="/" icon={<LayoutDashboard className="size-4" />} label="Dashboard" />}
              {user?.role === "official" && <Tab to="/scan" icon={<ScanLine className="size-4" />} label="Scan QR" />}
              <Tab to="/explorer" icon={<Blocks className="size-4" />} label="Explorer" />
            </nav>
          </div>
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden text-right md:block">
                <div className="flex items-center justify-end gap-1.5 text-sm font-medium text-slate-100">
                  {user.isSuper && <Crown className="size-3.5 text-amber-300" />}
                  {user.fullName}
                </div>
                <div className="text-xs capitalize text-slate-400">
                  {user.isSuper ? "Super official" : user.role} · {user.organization}
                </div>
              </div>
              <Avatar user={user} />
              <button
                onClick={() => {
                  logout();
                  clearDirectoryCache();
                  navigate("/login");
                }}
                className="grid size-9 cursor-pointer place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
                title="Log out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="text-sm text-cyan-300 hover:text-cyan-200">
              Log in
            </NavLink>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
