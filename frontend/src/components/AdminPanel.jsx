import { useEffect, useState } from "react";
import {
  Users, UserPlus, RotateCcw, Ban, CalendarPlus, Loader2, Copy, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  adminListLicenses, adminCreateLicense, adminRotateLicensePin,
  adminRevokeLicense, adminRenewLicense,
} from "@/lib/api";

// Master-only admin panel: create / rotate PIN / revoke / renew licensees.
// Freshly issued or rotated PINs are displayed ONCE in a modal and copied to
// clipboard — they are never stored plaintext server-side and are unrecoverable
// after dismiss. Warn the master before dismiss.
const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
};

const StatusPill = ({ status }) => {
  const map = {
    active: { bg: "bg-[#4A6741]/10", border: "border-[#4A6741]/40", color: "text-[#4A6741]", label: "Active" },
    revoked: { bg: "bg-[#B84A4A]/10", border: "border-[#B84A4A]/40", color: "text-[#B84A4A]", label: "Revoked" },
    expired: { bg: "bg-[#C87941]/10", border: "border-[#C87941]/40", color: "text-[#C87941]", label: "Expired" },
  };
  const s = map[status] || map.active;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ${s.bg} ${s.border} border px-2 py-0.5 text-[10px] font-semibold ${s.color}`}>
      {s.label}
    </span>
  );
};

// One-time PIN-reveal modal
const PinRevealDialog = ({ open, onClose, licensee }) => {
  if (!open || !licensee) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(licensee.pin);
      toast.success("PIN copied to clipboard");
    } catch {
      toast.error("Copy failed — please write it down manually");
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="pin-reveal-dialog">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold">New passcode for {licensee.email}</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          This is the only time you&apos;ll see this passcode. Copy it now and deliver it to the licensee
          via a secure channel (encrypted message, phone, in person). It is not stored plaintext and
          cannot be retrieved later — you&apos;d have to rotate the PIN again.
        </p>
        <div className="flex items-center gap-2 mb-5">
          <code className="flex-1 rounded-md bg-[#F3F1EC] border border-[#EBE8E0] px-4 py-3 text-2xl font-mono tracking-widest text-center"
                data-testid="pin-reveal-value">
            {licensee.pin}
          </code>
          <Button onClick={copy} variant="outline" size="sm" data-testid="pin-reveal-copy" className="gap-1">
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </div>
        <div className="rounded border border-[#C87941]/40 bg-[#C87941]/5 p-3 mb-4 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-[#C87941] shrink-0 mt-0.5" />
          <p className="text-xs text-[#C87941]">
            Deliver this passcode out-of-band. Do <em>not</em> paste it into email/Slack without encryption.
          </p>
        </div>
        <Button onClick={onClose} data-testid="pin-reveal-close"
                className="w-full bg-[#4A6741] hover:bg-[#3B5234] text-white">
          I&apos;ve saved it — close
        </Button>
      </div>
    </div>
  );
};

export const AdminPanel = () => {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [newExpires, setNewExpires] = useState("");   // YYYY-MM-DD or ""
  const [reveal, setReveal] = useState(null);          // { email, pin }

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await adminListLicenses();
      setLicenses(res.licenses || []);
    } catch (e) {
      toast.error("Failed to load licenses");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const isoOrNull = (dateStr) => dateStr ? new Date(dateStr + "T00:00:00Z").toISOString() : null;

  const onCreate = async () => {
    if (!newEmail.trim()) { toast.error("Enter an email address"); return; }
    setBusyId("__new__");
    try {
      const res = await adminCreateLicense(newEmail.trim(), isoOrNull(newExpires));
      setReveal({ email: res.email, pin: res.pin });
      setNewEmail("");
      setNewExpires("");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create license");
    } finally { setBusyId(null); }
  };

  const onRotate = async (lic) => {
    setBusyId(lic.license_id);
    try {
      const res = await adminRotateLicensePin(lic.license_id);
      setReveal({ email: res.email, pin: res.pin });
      await refresh();
    } catch {
      toast.error("Failed to rotate PIN");
    } finally { setBusyId(null); }
  };

  const onRevoke = async (lic) => {
    if (!window.confirm(`Revoke ${lic.email}? They will be signed out immediately on every device.`)) return;
    setBusyId(lic.license_id);
    try {
      await adminRevokeLicense(lic.license_id);
      toast.success(`Revoked ${lic.email}`);
      await refresh();
    } catch {
      toast.error("Failed to revoke");
    } finally { setBusyId(null); }
  };

  const onRenew = async (lic) => {
    const val = window.prompt(`New expiration date for ${lic.email} (YYYY-MM-DD, leave blank for no expiration)`,
                              lic.expires_at ? lic.expires_at.slice(0, 10) : "");
    if (val === null) return;  // cancelled
    setBusyId(lic.license_id);
    try {
      await adminRenewLicense(lic.license_id, isoOrNull(val));
      toast.success(`Renewed ${lic.email}`);
      await refresh();
    } catch {
      toast.error("Failed to renew");
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-6" data-testid="admin-panel">
      <PinRevealDialog open={!!reveal} licensee={reveal} onClose={() => setReveal(null)} />

      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="admin-create-card">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Issue a new license</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-2xl">
          Provisions a new licensee with a randomly-generated 6-digit PIN. The PIN is shown once
          after creation — copy and deliver it out-of-band. Expiration is optional; leave blank for
          an open-ended license.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Licensee email</Label>
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                   data-testid="admin-new-license-email" placeholder="advisor@firm.com" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Expires on (optional)</Label>
            <Input type="date" value={newExpires} onChange={(e) => setNewExpires(e.target.value)}
                   data-testid="admin-new-license-expires" className="mt-1" />
          </div>
          <Button onClick={onCreate} disabled={busyId === "__new__" || !newEmail.trim()}
                  data-testid="admin-new-license-submit"
                  className="bg-[#4A6741] hover:bg-[#3B5234] text-white gap-2">
            {busyId === "__new__" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create license
          </Button>
        </div>
      </Card>

      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="admin-licenses-card">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">All licenses</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {loading ? "Loading…" : `${licenses.length} total`}
          </span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading…
          </div>
        ) : licenses.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground" data-testid="admin-licenses-empty">
            No licenses yet — issue your first one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2">Status</th>
                  <th className="px-2">Created</th>
                  <th className="px-2">Expires</th>
                  <th className="px-2">Last login</th>
                  <th className="px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((lic, i) => {
                  const busy = busyId === lic.license_id;
                  return (
                    <tr key={lic.license_id} className="border-b border-[#F3F1EC]"
                        data-testid={`admin-license-row-${i}`}>
                      <td className="px-2 py-2 font-medium">{lic.email}</td>
                      <td className="px-2"><StatusPill status={lic.status} /></td>
                      <td className="px-2 text-muted-foreground">{fmtDate(lic.created_at)}</td>
                      <td className="px-2 text-muted-foreground">{fmtDate(lic.expires_at)}</td>
                      <td className="px-2 text-muted-foreground">{fmtDate(lic.last_login_at)}</td>
                      <td className="px-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => onRotate(lic)} disabled={busy}
                                  data-testid={`admin-license-rotate-${i}`}
                                  className="h-7 px-2 text-[11px] border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10 gap-1"
                                  title="Rotate PIN (invalidates all active sessions for this licensee)">
                            <RotateCcw className="h-3 w-3" /> Rotate
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onRenew(lic)} disabled={busy}
                                  data-testid={`admin-license-renew-${i}`}
                                  className="h-7 px-2 text-[11px] border-[#C87941] text-[#C87941] hover:bg-[#C87941]/10 gap-1"
                                  title="Change expiration date">
                            <CalendarPlus className="h-3 w-3" /> Renew
                          </Button>
                          {lic.status !== "revoked" && (
                            <Button size="sm" variant="outline" onClick={() => onRevoke(lic)} disabled={busy}
                                    data-testid={`admin-license-revoke-${i}`}
                                    className="h-7 px-2 text-[11px] border-[#B84A4A] text-[#B84A4A] hover:bg-[#B84A4A]/10 gap-1"
                                    title="Revoke immediately (signs out all their devices)">
                              <Ban className="h-3 w-3" /> Revoke
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-4">
          <ShieldCheck className="h-3 w-3 inline mr-1" />
          Revoke/rotate is instant: the licensee&apos;s active JWTs are epoch-invalidated server-side
          within a few seconds on every device.
        </p>
      </Card>
    </div>
  );
};
