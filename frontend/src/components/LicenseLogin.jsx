import { useState } from "react";
import { Leaf, Lock, Loader2, ShieldCheck, User, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  verifyPin, verifyLicense, setAdvisorToken, setRole, setLicenseEmail,
} from "@/lib/api";

// Dual-mode advisor gate — replaces the single-PIN LockScreen with:
//   • Master mode — one 6-digit PIN, owner-only, sourced from MASTER_ADMIN_PIN env
//   • Licensee mode — email + 6-digit PIN provisioned by the master via the admin panel
export const LicenseLogin = ({ onUnlock }) => {
  const [mode, setMode] = useState("licensee"); // "licensee" | "master"
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const errorMsg = (e, fallback) => {
    const status = e?.response?.status;
    if (status === 429) return "Too many attempts — wait a minute and try again.";
    if (status === 401) return fallback;
    return e?.response?.data?.detail || fallback;
  };

  const submitMaster = async (value) => {
    const code = (value ?? pin).trim();
    // Master accepts EITHER a 6-digit PIN OR a passphrase (≥ 12 chars).
    const valid = /^\d{6}$/.test(code) || code.length >= 12;
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await verifyPin(code);
      setAdvisorToken(res.token);
      setRole("master");
      setLicenseEmail("");
      onUnlock({ role: "master" });
    } catch (e) {
      setError(errorMsg(e, "Incorrect passcode. Please try again."));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const submitLicensee = async (value) => {
    const code = value ?? pin;
    if (code.length !== 6 || busy || !email) return;
    setBusy(true);
    setError("");
    try {
      const res = await verifyLicense(email.trim(), code);
      setAdvisorToken(res.token);
      setRole("licensee");
      setLicenseEmail(res.email || email.trim());
      onUnlock({ role: "licensee", email: res.email });
    } catch (e) {
      setError(errorMsg(e, "Invalid email or passcode."));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const submit = mode === "master" ? submitMaster : submitLicensee;

  return (
    <div className="min-h-screen grain flex items-center justify-center bg-[#FAF9F6] px-6" data-testid="lock-screen">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-xl bg-[#4A6741] flex items-center justify-center shadow-sm">
            <Leaf className="h-6 w-6 text-white" />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight mt-4 text-[#1A1A1A]">
            Roth Conversion &amp; Retirement Planner
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            {mode === "master" ? "Master passcode" : "Sign in with your license"}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-[#EBE8E0] p-1 text-xs font-medium" role="tablist">
          <button
            type="button"
            data-testid="login-mode-licensee"
            onClick={() => { setMode("licensee"); setPin(""); setError(""); }}
            className={`rounded-full py-1.5 transition-colors ${mode === "licensee" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-muted-foreground hover:text-[#1A1A1A]"}`}>
            <User className="h-3.5 w-3.5 inline mr-1" /> Licensee
          </button>
          <button
            type="button"
            data-testid="login-mode-master"
            onClick={() => { setMode("master"); setPin(""); setError(""); }}
            className={`rounded-full py-1.5 transition-colors ${mode === "master" ? "bg-white text-[#1A1A1A] shadow-sm" : "text-muted-foreground hover:text-[#1A1A1A]"}`}>
            <KeyRound className="h-3.5 w-3.5 inline mr-1" /> Master
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[#EBE8E0] bg-white/80 backdrop-blur p-6 shadow-sm">
          {mode === "licensee" && (
            <div className="mb-4">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                type="email"
                autoFocus
                autoComplete="email"
                data-testid="license-email-input"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="you@advisory.com"
                className="mt-1"
              />
            </div>
          )}

          <div className={mode === "licensee" ? "" : "mt-1"}>
            {mode === "licensee" ? (
              <>
                <Label className="text-xs text-muted-foreground mb-1 block">6-digit passcode</Label>
                <div className="flex justify-center" data-testid="pin-input">
                  <InputOTP
                    maxLength={6}
                    value={pin}
                    autoFocus={false}
                    onChange={(v) => {
                      setPin(v);
                      setError("");
                      if (v.length === 6) submit(v);
                    }}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} className="h-11 w-11 text-lg" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </>
            ) : (
              <>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Master passcode <span className="text-muted-foreground/70">(6-digit PIN or 12+ char passphrase)</span>
                </Label>
                <Input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  data-testid="pin-input"
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder="••••••••••••"
                  className="text-center text-lg tracking-wider h-11"
                />
              </>
            )}
          </div>

          {error && (
            <p className="mt-3 text-center text-sm text-[#C87941]" data-testid="pin-error">{error}</p>
          )}

          <Button
            onClick={() => submit()}
            disabled={
              busy
              || (mode === "licensee" && (pin.length !== 6 || !email))
              || (mode === "master" && !(/^\d{6}$/.test(pin) || pin.trim().length >= 12))
            }
            data-testid="pin-unlock-btn"
            className="mt-5 w-full rounded-full bg-[#4A6741] hover:bg-[#3B5234] gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {mode === "master"
            ? "Master access is env-controlled and cannot be rotated in the UI."
            : "Access stays unlocked on this device for up to 30 days (or until your license expires / is revoked)."}
        </p>
      </div>
    </div>
  );
};
