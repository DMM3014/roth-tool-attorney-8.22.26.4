import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";

export const AIInsights = ({ summary, testid }) => {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!summary) return;
    setText("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
    } catch (e) {
      setText("Could not generate insights right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = () => {
    if (loading) return "Analyzing…";
    return text ? "Regenerate" : "Generate AI Insights";
  };

  return (
    <div data-testid={testid}>
      {!text && (
        <p className="text-sm text-muted-foreground mb-4 max-w-2xl leading-relaxed">
          Get a CFP-level read on this plan — bracket-fill efficiency, IRMAA/NIIT exposure, RMD timing, and survivor (filing-status) impact.
        </p>
      )}
      {text && (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A1A] mb-4" data-testid="ai-insights-text">
          {text}
        </div>
      )}
      <Button
        onClick={generate} disabled={loading || !summary}
        data-testid="generate-insights-button"
        className="bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full"
      >
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        {buttonLabel()}
      </Button>
    </div>
  );
};
