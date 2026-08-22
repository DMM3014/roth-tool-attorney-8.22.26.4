import { useState } from "react";
import { Sparkles, Loader2, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { API, authHeaders } from "@/lib/api";

// Compact one-shot AI analysis card. Streams a paragraph-style write-up of
// whatever `summary` object the parent passes into the existing /api/insights
// endpoint — same backend and API key semantics as the full AIInsights chat,
// but without the follow-up thread. Designed to be dropped onto pages that
// benefit from a single "here's what these numbers mean" analysis (Strategy
// Optimizer, SS Optimizer, Monte Carlo, Compare, Presentation).
//
// Props:
//   title    — H3 label, e.g. "AI analysis of this strategy"
//   focus    — context string prepended to the summary so Claude knows what
//              page the summary came from and what angle to prioritize.
//   summary  — the JSON payload of relevant numbers/settings for the page.
//   testid   — data-testid prefix. Buttons get -run, -reset; text pane gets -text.
const KEY_STORAGE = "gemini_api_key";

const readStream = async (res, onToken) => {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onToken(acc);
  }
  return acc;
};

const AIAnalysisCard = ({ title, focus, summary, testid = "ai-analysis" }) => {
  const [analysis, setAnalysis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!summary || streaming) return;
    setStreaming(true); setAnalysis(""); setError("");
    // BYOK Gemini key if the user set one on the AI Insights tab; otherwise
    // backend falls back to the server-side Claude/Gemini fallback chain.
    const apiKey = window.localStorage.getItem(KEY_STORAGE) || "";
    // Wrap the raw summary with a focus preamble so Claude tailors the
    // analysis to this specific page. The /api/insights endpoint accepts any
    // JSON in `summary` — we just push our focus string into a `_focus` key
    // so it survives serialization.
    const payload = { summary: { _focus: focus, ...summary }, api_key: apiKey };
    try {
      const res = await fetch(`${API}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = "AI analysis failed. Please try again.";
        try {
          const j = await res.json();
          if (typeof j.detail === "string") detail = j.detail;
        } catch (parseErr) { console.debug("AIAnalysisCard: non-JSON error body", parseErr); }
        throw new Error(detail);
      }
      await readStream(res, setAnalysis);
    } catch (e) {
      setError(e?.message || "AI analysis failed. Please try again.");
    } finally {
      setStreaming(false);
    }
  };

  const reset = () => { setAnalysis(""); setError(""); };

  return (
    <Card className="p-5 border-[#4A6741]/25 bg-gradient-to-br from-[#F5F7F1] to-[#FAF6EE] shadow-none"
          data-testid={`${testid}-card`}>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-sm font-bold tracking-tight" data-testid={`${testid}-title`}>
            {title}
          </h3>
        </div>
        <div className="flex gap-2">
          {analysis && !streaming && (
            <Button size="sm" variant="outline" onClick={reset}
                    data-testid={`${testid}-reset`}
                    className="h-8 gap-1 border-[#4A6741]/40 text-[#4A6741] text-[11px]">
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
          )}
          <Button size="sm" onClick={generate} disabled={streaming || !summary}
                  data-testid={`${testid}-run`}
                  className="h-8 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white text-[11px]">
            {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {streaming ? "Analyzing…" : (analysis ? "Regenerate" : "Analyze with AI")}
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-[11px] text-[#B84A4A] mb-2" data-testid={`${testid}-error`}>{error}</p>
      )}
      {analysis ? (
        <div className="text-[12px] leading-relaxed text-[#1A1A1A] whitespace-pre-wrap"
             data-testid={`${testid}-text`}>
          {analysis}
        </div>
      ) : (
        !streaming && !error && (
          <p className="text-[11px] text-muted-foreground italic" data-testid={`${testid}-placeholder`}>
            Click <span className="font-medium">Analyze with AI</span> for a plain-English write-up of what these numbers mean for your plan. Uses Claude Fable 5 by default — bring your own Gemini key on the AI Insights tab for unlimited use.
          </p>
        )
      )}
    </Card>
  );
};

export default AIAnalysisCard;
