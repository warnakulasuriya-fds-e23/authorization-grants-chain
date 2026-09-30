import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Consent from "./pages/Consent";
import Explorer from "./pages/Explorer";
import Login from "./pages/Login";
import OfficialHome from "./pages/OfficialHome";
import Scan from "./pages/Scan";
import VerificationView from "./pages/VerificationView";
import VerifierHome from "./pages/VerifierHome";

function RequireAuth({ role, children }: { role?: "official" | "verifier"; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  return user?.role === "official" ? <OfficialHome /> : <VerifierHome />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/verify/:id" element={<RequireAuth role="verifier"><VerificationView /></RequireAuth>} />
        <Route path="/scan" element={<RequireAuth role="official"><Scan /></RequireAuth>} />
        <Route path="/consent/:id" element={<RequireAuth role="official"><Consent /></RequireAuth>} />
        <Route path="/explorer" element={<Explorer />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
