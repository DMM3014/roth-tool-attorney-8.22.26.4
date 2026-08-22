import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { changePin, setAdvisorToken } from "@/lib/api";

const PinField = ({ id, label, value, onChange, testid }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id} className="text-xs">{label}</Label>
    <Input
      id={id}
      type="password"
      inputMode="numeric"
      maxLength={6}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      data-testid={testid}
      placeholder="••••••"
    />
  </div>
);

export const ChangePasscodeDialog = () => {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setCur(""); setNext(""); setConfirm(""); setError(""); };
  const valid6 = (v) => /^\d{6}$/.test(v);

  const submit = async () => {
    if (!valid6(cur)) { setError("Enter your current 6-digit passcode."); return; }
    if (!valid6(next)) { setError("New passcode must be exactly 6 digits."); return; }
    if (next !== confirm) { setError("New passcodes do not match."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await changePin(cur, next);
      setAdvisorToken(res.token); // fresh token on the new epoch keeps THIS device signed in
      setOpen(false);
      reset();
      toast.success("Passcode changed — all other devices have been signed out.");
    } catch (e) {
      const status = e?.response?.status;
      setError(status === 401
        ? "Current passcode is incorrect."
        : status === 429
          ? "Too many attempts — wait a minute and try again."
          : "Could not change the passcode. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="change-pin-btn"
          className="gap-1.5 rounded-full border-[#EBE8E0] text-muted-foreground hover:bg-[#F3F1EC] hover:text-[#1A1A1A]">
          <KeyRound className="h-3.5 w-3.5" /> Passcode
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" data-testid="change-pin-dialog">
        <DialogHeader>
          <DialogTitle>Change advisor passcode</DialogTitle>
          <DialogDescription>
            Pick a new 6-digit passcode. Every other signed-in device will be locked out immediately;
            this device stays signed in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <PinField id="cur-pin" label="Current passcode" value={cur} onChange={setCur} testid="current-pin-input" />
          <PinField id="new-pin" label="New passcode (6 digits)" value={next} onChange={setNext} testid="new-pin-input" />
          <PinField id="confirm-pin" label="Confirm new passcode" value={confirm} onChange={setConfirm} testid="confirm-pin-input" />
          {error && <p className="text-sm text-[#C87941]" data-testid="change-pin-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} data-testid="change-pin-submit"
            className="w-full rounded-full bg-[#4A6741] hover:bg-[#3B5234] gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Changing…" : "Change passcode"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
