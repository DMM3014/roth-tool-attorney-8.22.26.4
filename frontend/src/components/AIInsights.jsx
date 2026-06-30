import { useState, useRef, useEffect } from "react";
import { Sparkles, Loader2, Send, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API } from "@/lib/api";

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

let _msgId = 0;
const nextMsgId = () => (_msgId += 1);

const SUGGESTIONS = [
  { label: "Why 24%?", q: "Why convert to the 24% bracket and not 32%?" },
  { label: "IRMAA risk?", q: "What is my IRMAA exposure, and how do my conversions affect my Medicare surcharges?" },
  { label: "Survivor impact?", q: "How does the death-of-spouse transition to single filing status affect this plan?" },
  { label: "Net to family?", q: "How much more do my heirs receive with these conversions, and how much of it is tax-free?" },
];

export const AIInsights = ({ summary, testid }) => {
  const [messages, setMessages] = useState([]); // {role:'assistant'|'user', content}
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const threadRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, streaming]);

  const generate = async () => {
    if (!summary || streaming) return;
    const id = nextMsgId();
    setMessages([{ id, role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch(`${API}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      await readStream(res, (acc) => setMessages([{ id, role: "assistant", content: acc }]));
    } catch (e) {
      setMessages([{ id, role: "assistant", content: "Could not generate insights right now. Please try again." }]);
    } finally {
      setStreaming(false);
    }
  };

  const send = async () => {
    const q = input.trim();
    if (!q || streaming || !summary) return;
    setInput("");
    await sendMessage(q);
  };

  const sendMessage = async (q) => {
    if (!q || streaming || !summary) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const aid = nextMsgId();
    setMessages((m) => [...m, { id: nextMsgId(), role: "user", content: q }, { id: aid, role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch(`${API}/insights/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, history, message: q }),
      });
      await readStream(res, (acc) =>
        setMessages((m) => {
          const c = m.slice();
          c[c.length - 1] = { id: aid, role: "assistant", content: acc };
          return c;
        })
      );
    } catch (e) {
      setMessages((m) => {
        const c = m.slice();
        c[c.length - 1] = { id: aid, role: "assistant", content: "Sorry — I couldn't answer that just now. Please try again." };
        return c;
      });
    } finally {
      setStreaming(false);
    }
  };

  const reset = () => { setMessages([]); setInput(""); };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ---- Empty state: intro + generate ----
  if (messages.length === 0) {
    return (
      <div data-testid={testid}>
        <p className="text-sm text-muted-foreground mb-4 max-w-2xl leading-relaxed">
          Get a CFP-level read on this plan — bracket-fill efficiency, IRMAA/NIIT exposure, RMD timing, and survivor (filing-status) impact — then ask follow-up questions.
        </p>
        <Button onClick={generate} disabled={streaming || !summary} data-testid="generate-insights-button"
          className="bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
          {streaming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {streaming ? "Analyzing…" : "Generate AI Insights"}
        </Button>
      </div>
    );
  }

  // ---- Conversation state: thread + chat input ----
  const lastIsEmptyAssistant = streaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content;

  return (
    <div data-testid={testid}>
      <div ref={threadRef} className="space-y-4 max-h-[460px] overflow-y-auto pr-1 mb-4" data-testid="ai-chat-thread">
        {messages.map((m, i) => (
          <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`ai-msg-${i}`}>
            {m.role === "assistant" && (
              <div className="h-7 w-7 shrink-0 rounded-full bg-[#4A6741] flex items-center justify-center mt-0.5">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap max-w-[88%] ${
              m.role === "user"
                ? "bg-[#4A6741] text-white rounded-br-sm"
                : "bg-white border border-[#EBE8E0] text-[#1A1A1A] rounded-bl-sm"
            }`}>
              {m.content || (i === messages.length - 1 && streaming ? <span className="inline-flex gap-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> thinking…</span> : "")}
            </div>
            {m.role === "user" && (
              <div className="h-7 w-7 shrink-0 rounded-full bg-[#C87941] flex items-center justify-center mt-0.5">
                <User className="h-3.5 w-3.5 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      {!streaming && (
        <div className="flex flex-wrap gap-2 mb-3" data-testid="ai-suggestions">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => sendMessage(s.q)}
              disabled={!summary}
              data-testid={`ai-suggestion-${i}`}
              className="rounded-full border border-[#D9D4C8] bg-white px-3 py-1.5 text-xs font-medium text-[#4A6741] transition-colors duration-200 hover:bg-[#4A6741] hover:text-white hover:border-[#4A6741] disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming}
          placeholder="Ask a follow-up… e.g. ‘Why convert to the 24% bracket and not 32%?’"
          className="bg-white border-[#EBE8E0]"
          data-testid="ai-chat-input"
        />
        <Button onClick={send} disabled={streaming || !input.trim()} data-testid="ai-chat-send"
          className="bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full shrink-0">
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
        <Button onClick={reset} disabled={streaming} variant="ghost" size="icon" data-testid="ai-chat-reset"
          title="Start over" className="shrink-0 text-muted-foreground">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      {lastIsEmptyAssistant && <div className="sr-only">streaming</div>}
    </div>
  );
};
