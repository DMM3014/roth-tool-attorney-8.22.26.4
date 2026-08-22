import { useState } from "react";
import { Leaf, Lock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { verifyPin, setAdvisorToken } from "@/lib/api";

export const LockScreen = ({ onUnlock }) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (value) => {
    const code = value ?? pin;
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await verifyPin(code);
      setAdvisorToken(res.token);
      onUnlock();
    } catch (e) {
      const status = e?.response?.status;
      setError(status === 429
        ? "Too many attempts — wait a minute and try again."
        : "Incorrect passcode. Please try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

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
            <Lock className="h-3.5 w-3.5" /> Enter your 6-digit advisor passcode
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-[#EBE8E0] bg-white/80 backdrop-blur p-6 shadow-sm">
          <div className="flex justify-center" data-testid="pin-input">
            <InputOTP
              maxLength={6}
              value={pin}
              autoFocus
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

          {error && (
            <p className="mt-3 text-center text-sm text-[#C87941]" data-testid="pin-error">{error}</p>
          )}

          <Button
            onClick={() => submit()}
            disabled={pin.length !== 6 || busy}
            data-testid="pin-unlock-btn"
            className="mt-5 w-full rounded-full bg-[#4A6741] hover:bg-[#3B5234] gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Access stays unlocked on this device for 30 days. Changing the passcode signs out all devices.
        </p>
      </div>
    </div>
  );
};
