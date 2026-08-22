import { useState } from "react";
import { KeyRound, Sparkles, Eye, EyeOff, Save, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// The single source-of-truth for the BYOK Gemini API key. `AIAnalysisCard`,
// `SSReport`, and `ClientReport` all read from this same localStorage slot
// (see grep for KEY_STORAGE / "gemini_api_key" if you need to trace consumers).
const KEY_STORAGE = "gemini_api_key";

const mask = (k) => {
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return `${k.slice(0, 4)}${"•".repeat(k.length - 8)}${k.slice(-4)}`;
};

export const GeminiKeyCard = () => {
  const [saved, setSaved] = useState(() => (typeof window !== "undefined"
    ? window.localStorage.getItem(KEY_STORAGE) || "" : ""));
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);

  const startEdit = () => { setDraft(saved); setEditing(true); };
  const cancelEdit = () => { setDraft(""); setEditing(false); setReveal(false); };
  const save = () => {
    const k = draft.trim();
    if (!k) return;
    // Very light sanity check — Google API keys are typically ≥ 30 chars.
    if (k.length < 30) {
      toast.error("That doesn't look like a valid Gemini API key. Keys are usually 30+ characters.");
      return;
    }
    window.localStorage.setItem(KEY_STORAGE, k);
    setSaved(k);
    setEditing(false);
    setReveal(false);
    toast.success("Gemini key saved on this device. Free-tier limits removed for AI features.");
  };
  const clear = () => {
    window.localStorage.removeItem(KEY_STORAGE);
    setSaved("");
    setDraft("");
    setEditing(false);
    setReveal(false);
    toast.success("Gemini key cleared. AI features will fall back to Claude Fable 5.");
  };

  return (
    <div className="mt-6 pt-6 border-t border-[#EBE8E0]" data-testid="advisor-info-gemini-key">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#1A1A1A]">AI Insights — bring your own Gemini key (optional)</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed max-w-2xl mt-0.5">
            The app&apos;s AI features (per-view &ldquo;Analyze with AI&rdquo; buttons on the Insights tab and
            the advisor-only Advisor Commentary on Client Report / SS Report) work out of the box on
            Claude Fable 5. If you set a personal Google
            Gemini API key here, every AI call switches to your Gemini quota — <strong>unlimited use,
            no rate limit, no cost to us</strong>. The key is stored only in this browser (localStorage).
          </p>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[#4A6741] hover:underline mt-1"
            data-testid="advisor-info-gemini-key-link"
          >
            Get a free Gemini API key at aistudio.google.com <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] label-cap text-muted-foreground">Current key</p>
              <p className="text-[13px] font-mono text-[#1A1A1A] truncate" data-testid="advisor-info-gemini-key-display">
                {saved ? (reveal ? saved : mask(saved)) : <span className="italic text-muted-foreground">Not set — using Claude Fable 5 fallback</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && (
              <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}
                data-testid="advisor-info-gemini-key-reveal"
                className="h-8 gap-1 text-[11px]">
                {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {reveal ? "Hide" : "Reveal"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={startEdit}
              data-testid="advisor-info-gemini-key-edit"
              className="h-8 gap-1 text-[11px] border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
              {saved ? "Replace" : "Add key"}
            </Button>
            {saved && (
              <Button size="sm" variant="ghost" onClick={clear}
                data-testid="advisor-info-gemini-key-clear"
                className="h-8 gap-1 text-[11px] text-[#B84A4A] hover:bg-[#B84A4A]/5">
                <RotateCcw className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[#4A6741] bg-white p-3">
          <Label className="text-[11px] label-cap text-muted-foreground">Paste your Gemini API key</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type={reveal ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancelEdit(); }}
              placeholder="AIzaSy…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              data-testid="advisor-info-gemini-key-input"
              className="h-9 text-sm font-mono flex-1"
            />
            <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}
              className="h-9 w-9 p-0" aria-label={reveal ? "Hide" : "Show"}>
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button size="sm" onClick={save}
              data-testid="advisor-info-gemini-key-save"
              className="h-9 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}
              data-testid="advisor-info-gemini-key-cancel"
              className="h-9 text-[11px]">
              Cancel
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Stored only in this browser's localStorage under <code className="text-[10px]">{KEY_STORAGE}</code>. Never
            sent to Emergent servers — the key is forwarded directly to Google when an AI request is made.
          </p>
        </div>
      )}
    </div>
  );
};
