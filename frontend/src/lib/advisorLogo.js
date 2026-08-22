// Shared advisor-logo store — used by Presentation and Client Report so the
// same firm logo appears on both PDFs without duplicating localStorage.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ImagePlus, Trash2, Upload } from "lucide-react";

export const ADVISOR_LOGO_KEY = "advisor_logo_v1";
const LOGO_EVENT = "advisor-logo-changed";
const MAX_BYTES = 500 * 1024; // 500 KB
// SEC-hardening: SVGs are excluded even though rendered via <img> (never inline)
// — a stray future refactor could inline the SVG, so we shut the door here.
// Client-side check is defense-in-depth; there is no server upload today.
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export const loadAdvisorLogo = () => {
  try { return window.localStorage.getItem(ADVISOR_LOGO_KEY) || null; }
  catch { return null; }
};
export const saveAdvisorLogo = (dataUrl) => {
  try {
    window.localStorage.setItem(ADVISOR_LOGO_KEY, dataUrl);
    window.dispatchEvent(new CustomEvent(LOGO_EVENT, { detail: dataUrl }));
  } catch { /* quota exceeded */ }
};
export const clearAdvisorLogo = () => {
  try {
    window.localStorage.removeItem(ADVISOR_LOGO_KEY);
    window.dispatchEvent(new CustomEvent(LOGO_EVENT, { detail: null }));
  } catch { /* noop */ }
};

// React hook: subscribes to focus + storage + custom logo events so the logo
// stays in sync across every consumer (Presentation cover, Client Report pages,
// print footer watermarks, etc.).
export const useAdvisorLogo = () => {
  const [logo, setLogo] = useState(loadAdvisorLogo);
  useEffect(() => {
    const refresh = () => setLogo(loadAdvisorLogo());
    const onCustom = (e) => setLogo(e?.detail ?? loadAdvisorLogo());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(LOGO_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LOGO_EVENT, onCustom);
    };
  }, []);
  return [logo, (v) => {
    if (v == null) { clearAdvisorLogo(); setLogo(null); }
    else { saveAdvisorLogo(v); setLogo(v); }
  }];
};

// Drop-in uploader UI for the branding forms.
export const AdvisorLogoUploader = ({ testidPrefix = "logo" }) => {
  const [logo, setLogo] = useAdvisorLogo();
  const inputRef = useRef(null);

  const onPick = () => inputRef.current?.click();

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error(`Unsupported format: ${file.type || "unknown"}. Use PNG, JPEG, or WebP.`);
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Image too large (${Math.round(file.size / 1024)} KB). Max ${MAX_BYTES / 1024} KB.`);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(reader.result);
      toast.success("Logo saved. It will appear on the Presentation and Client Report.");
    };
    reader.onerror = () => toast.error("Failed to read image.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const onClear = () => {
    setLogo(null);
    toast.info("Logo removed.");
  };

  return (
    <div data-testid={`${testidPrefix}-uploader`}>
      <Label className="text-[11px] label-cap flex items-center gap-1 mb-1">
        <ImagePlus className="inline h-3 w-3" /> Firm logo (optional)
      </Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        className="hidden"
        data-testid={`${testidPrefix}-file-input`}
      />
      {logo ? (
        <div className="flex items-center gap-3 p-2 border border-[#EBE8E0] rounded-md bg-white">
          <img
            src={logo}
            alt="Firm logo preview"
            data-testid={`${testidPrefix}-preview`}
            style={{ maxHeight: 44, maxWidth: 120, objectFit: "contain" }}
          />
          <div className="flex-1 text-[10.5px] text-muted-foreground">
            Uploaded &middot; shown on cover pages + page footers
          </div>
          <Button size="sm" variant="outline" onClick={onPick}
            data-testid={`${testidPrefix}-replace`}
            className="h-7 text-[11px] gap-1">
            <Upload className="h-3 w-3" /> Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}
            data-testid={`${testidPrefix}-clear`}
            className="h-7 w-7 p-0 text-[#B84A4A] hover:bg-[#B84A4A]/5">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={onPick}
          data-testid={`${testidPrefix}-upload`}
          className="h-9 text-sm gap-2 w-full justify-start">
          <Upload className="h-4 w-4" /> Upload PNG, JPEG or WebP (max 500 KB)
        </Button>
      )}
    </div>
  );
};

// Inline branded header used on cover pages
export const LogoHeader = ({ logo, testid = "logo-header" }) => {
  if (!logo) return null;
  return (
    <img
      src={logo}
      alt="Firm logo"
      data-testid={testid}
      style={{
        maxHeight: 48, maxWidth: 200, objectFit: "contain",
        marginBottom: 10, display: "block",
      }}
    />
  );
};

// Small footer watermark used on each print page
export const LogoWatermark = ({ logo, testid = "logo-watermark" }) => {
  if (!logo) return null;
  return (
    <img
      src={logo}
      alt=""
      data-testid={testid}
      style={{
        maxHeight: 16, maxWidth: 60, objectFit: "contain",
        verticalAlign: "middle", marginRight: 6,
      }}
    />
  );
};
