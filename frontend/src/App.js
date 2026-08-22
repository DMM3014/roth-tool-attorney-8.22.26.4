import { useEffect, useState } from "react";
import "@/App.css";
import { Planner } from "@/components/Planner";
import { LicenseLogin } from "@/components/LicenseLogin";
import { Toaster } from "@/components/ui/sonner";
import {
  getAdvisorToken, getShareTokenFromUrl, pinStatus, clearAdvisorToken,
  setRole, setLicenseEmail, getRole, getLicenseEmail,
} from "@/lib/api";

function App() {
  // Shared read-only client links (?share=...) bypass the license gate entirely.
  const isSharedView = !!getShareTokenFromUrl();
  const [unlocked, setUnlocked] = useState(null); // null = checking stored token
  const [session, setSession] = useState({ role: getRole(), email: getLicenseEmail() });

  useEffect(() => {
    if (isSharedView) {
      setUnlocked(true);
      return;
    }
    const relock = () => setUnlocked(false);
    window.addEventListener("advisor-auth-required", relock);
    if (!getAdvisorToken()) {
      setUnlocked(false);
    } else {
      pinStatus()
        .then((s) => {
          if (!s.authenticated) {
            clearAdvisorToken();
            setUnlocked(false);
          } else {
            setRole(s.role || "master");
            setLicenseEmail(s.email || "");
            setSession({ role: s.role || "master", email: s.email || "" });
            setUnlocked(true);
          }
        })
        .catch(() => setUnlocked(false));
    }
    return () => window.removeEventListener("advisor-auth-required", relock);
  }, [isSharedView]);

  if (!isSharedView && unlocked === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse label-cap">Checking access…</div>
      </div>
    );
  }

  if (!isSharedView && !unlocked) {
    return (
      <div className="App">
        <LicenseLogin onUnlock={(s) => { setSession(s); setUnlocked(true); }} />
        <Toaster position="top-right" />
      </div>
    );
  }

  return (
    <div className="App">
      <Planner session={session} />
      <Toaster position="top-right" />
    </div>
  );
}

export default App;
