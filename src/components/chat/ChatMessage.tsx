import { Bot, User, CheckCircle2, XCircle, ArrowRight, Copy, Check, Volume2, VolumeX, Download, FileSpreadsheet, AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType, ImportPreviewData, ImportExecuteResult, WritePreviewData, WriteExecuteResult } from "@/hooks/useChatStore";
import { downloadAsCSV, downloadAsExcel } from "@/lib/fileTransfer";
import { speak, stopSpeaking, isSpeechSynthesisSupported } from "@/hooks/useSpeechInput";
import CodeBlock from "./CodeBlock";

interface ChatMessageProps {
  message: ChatMessageType;
  onConfirmImport: (preview: ImportPreviewData & { rows: Record<string, any>[] }) => Promise<ImportExecuteResult>;
  onConfirmWrite: (preview: WritePreviewData) => Promise<WriteExecuteResult>;
}

const TypingIndicator = () => (
  <div className="flex items-center gap-1 px-1 py-2">
    <div className="h-2 w-2 rounded-full bg-muted-foreground typing-dot" />
    <div className="h-2 w-2 rounded-full bg-muted-foreground typing-dot" />
    <div className="h-2 w-2 rounded-full bg-muted-foreground typing-dot" />
  </div>
);

const ActionBadge = ({ action }: { action?: string }) => {
  if (!action) return null;
  const colors: Record<string, string> = {
    QUERY: "bg-primary/15 text-primary",
    LIST: "bg-primary/15 text-primary",
    READ: "bg-primary/15 text-primary",
    ANSWER: "bg-muted text-muted-foreground",
    CROSS_CHECK: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    IMPORT_PLAN: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    WRITE_PLAN: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${colors[action] || "bg-muted text-muted-foreground"}`}>
      {action.replace(/_/g, " ")}
    </span>
  );
};

const DownloadButtons = ({ data, doctype }: { data: any[]; doctype?: string }) => {
  const base = `${doctype || "frappe-hr-data"}-${new Date().toISOString().slice(0, 10)}`;
  return (
    <div className="flex gap-1.5 mt-2">
      <button
        onClick={() => downloadAsCSV(data, base)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Download className="h-3 w-3" /> CSV
      </button>
      <button
        onClick={() => downloadAsExcel(data, base)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Download className="h-3 w-3" /> Excel
      </button>
    </div>
  );
};

const DataTable = ({ data, doctype }: { data: any[]; doctype?: string }) => {
  if (data.length === 0) return <p className="text-sm text-muted-foreground italic">No records found.</p>;
  const keys = Object.keys(data[0]).filter((k) => !k.startsWith("_"));
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border mt-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {keys.map((key) => (
                <th key={key} className="px-3 py-2 text-left font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {key.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                {keys.map((key) => (
                  <td key={key} className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {String(row[key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-t border-border">
          {data.length} record{data.length !== 1 ? "s" : ""}
        </div>
      </div>
      <DownloadButtons data={data} doctype={doctype} />
    </div>
  );
};

const DataObject = ({ data }: { data: Record<string, any> }) => {
  const entries = Object.entries(data).filter(
    ([k]) => !k.startsWith("_") && !["docstatus", "idx", "lft", "rgt", "old_parent"].includes(k)
  );
  const important = entries.filter(([k]) =>
    ["name", "employee", "employee_name", "first_name", "status", "company", "department", "designation", "date_of_joining", "date_of_birth", "gender"].includes(k)
  );
  const rest = entries.filter(([k]) => !important.some(([ik]) => ik === k));

  return (
    <div className="mt-2 space-y-2">
      {important.length > 0 && (
        <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 space-y-1.5">
          {important.map(([key, value]) => (
            <div key={key} className="flex items-center gap-3 text-xs">
              <span className="min-w-[120px] font-mono text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
              <span className="font-mono font-medium">{String(value ?? "—")}</span>
            </div>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
            +{rest.length} more fields
          </summary>
          <div className="mt-1.5 rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            {rest.map(([key, value]) => (
              <div key={key} className="flex gap-3 text-xs">
                <span className="min-w-[120px] font-mono text-muted-foreground">{key.replace(/_/g, " ")}</span>
                <span className="font-mono opacity-80">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

const CrossCheckView = ({ crossCheck }: { crossCheck: NonNullable<ChatMessageType["result"]>["crossCheck"] }) => {
  if (!crossCheck) return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-success/20 bg-success/5 p-2">
          <div className="text-lg font-semibold text-success">{crossCheck.matched}</div>
          <div className="text-[10px] text-muted-foreground">Matched</div>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
          <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{crossCheck.mismatched.length}</div>
          <div className="text-[10px] text-muted-foreground">Mismatches</div>
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
          <div className="text-lg font-semibold text-destructive">{crossCheck.missing_in_frappe.length}</div>
          <div className="text-[10px] text-muted-foreground">Missing in Frappe</div>
        </div>
      </div>

      {crossCheck.mismatched.length > 0 && (
        <details className="group" open>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Field mismatches
          </summary>
          <div className="mt-1.5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-2 py-1.5 text-left font-mono">key</th>
                  <th className="px-2 py-1.5 text-left font-mono">field</th>
                  <th className="px-2 py-1.5 text-left font-mono">file value</th>
                  <th className="px-2 py-1.5 text-left font-mono">frappe value</th>
                </tr>
              </thead>
              <tbody>
                {crossCheck.mismatched.slice(0, 20).map((m, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1 font-mono">{m.key}</td>
                    <td className="px-2 py-1 font-mono">{m.field}</td>
                    <td className="px-2 py-1 font-mono text-amber-600 dark:text-amber-400">{String(m.file_value ?? "—")}</td>
                    <td className="px-2 py-1 font-mono">{String(m.frappe_value ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {crossCheck.missing_in_frappe.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Not found in Frappe ({crossCheck.missing_in_frappe.length})
          </summary>
          <div className="mt-1.5 rounded-lg border border-border bg-muted/30 p-2 font-mono text-xs">
            {crossCheck.missing_in_frappe.slice(0, 50).join(", ")}
          </div>
        </details>
      )}
    </div>
  );
};

const ImportConfirmationCard = ({
  preview,
  onConfirm,
}: {
  preview: ImportPreviewData & { rows: Record<string, any>[] };
  onConfirm: (preview: ImportPreviewData & { rows: Record<string, any>[] }) => Promise<ImportExecuteResult>;
}) => {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<ImportExecuteResult | null>(null);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setState("running");
    try {
      const res = await onConfirm(preview);
      setResult(res);
      setState("done");
    } catch (e: any) {
      setError(e.message || "Import failed");
      setState("error");
    }
  };

  if (state === "done" && result) {
    return (
      <div className="mt-2 rounded-lg border border-success/20 bg-success/5 p-3 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" /> Import complete
        </div>
        <p className="text-xs text-muted-foreground">
          {result.created} created, {result.updated} updated
          {result.failed.length > 0 ? `, ${result.failed.length} failed` : ""}.
        </p>
        {result.failed.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-destructive">View failures</summary>
            <div className="mt-1 space-y-0.5 font-mono">
              {result.failed.map((f, i) => (
                <div key={i}>{f.key}: {f.error}</div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> This will write to your live Frappe site
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div><span className="font-medium text-foreground">{preview.to_create}</span> record{preview.to_create !== 1 ? "s" : ""} to create</div>
        <div><span className="font-medium text-foreground">{preview.to_update}</span> record{preview.to_update !== 1 ? "s" : ""} to update</div>
        {preview.skipped > 0 && <div>{preview.skipped} row(s) skipped (no key value)</div>}
      </div>

      {preview.sample.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Preview sample rows</summary>
          <div className="mt-1 overflow-x-auto rounded-md border border-border bg-background/50">
            <table className="w-full font-mono text-[10px]">
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className={`px-2 py-1 font-semibold ${row.action === "create" ? "text-success" : "text-amber-600 dark:text-amber-400"}`}>
                      {row.action}
                    </td>
                    <td className="px-2 py-1 truncate max-w-[300px]">{JSON.stringify(row.mapped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {state === "error" && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={state === "running" || (preview.to_create === 0 && preview.to_update === 0)}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
      >
        {state === "running" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</> : `Confirm import of ${preview.to_create + preview.to_update} record${preview.to_create + preview.to_update !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
};

const WriteConfirmationCard = ({
  preview,
  onConfirm,
}: {
  preview: WritePreviewData;
  onConfirm: (preview: WritePreviewData) => Promise<WriteExecuteResult>;
}) => {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<WriteExecuteResult | null>(null);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setState("running");
    try {
      const res = await onConfirm(preview);
      setResult(res);
      setState("done");
    } catch (e: any) {
      setError(e.message || "Write failed");
      setState("error");
    }
  };

  if (state === "done" && result) {
    return (
      <div className="mt-2 rounded-lg border border-success/20 bg-success/5 p-3 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" /> {result.record_action === "create" ? "Record created" : "Record updated"}
        </div>
        <p className="text-xs text-muted-foreground font-mono">{result.doctype}: {result.docname}</p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> This will write to your live Frappe site
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>
          <span className="font-medium text-foreground">{preview.record_action === "create" ? "Create" : "Update"}</span>
          {" "}{preview.doctype}
          {preview.matched_label && <> — <span className="font-medium text-foreground">{preview.matched_label}</span></>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-background/50">
        <table className="w-full font-mono text-[10px]">
          <tbody>
            {Object.entries(preview.field_values).map(([field, value]) => (
              <tr key={field} className="border-b border-border/50 last:border-0">
                <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{field}</td>
                <td className="px-2 py-1 truncate max-w-[300px]">{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state === "error" && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={state === "running"}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-40"
      >
        {state === "running" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : `Confirm ${preview.record_action}`}
      </button>
    </div>
  );
};

const ResultCard = ({
  result,
  onConfirmImport,
  onConfirmWrite,
}: {
  result: ChatMessageType["result"];
  onConfirmImport: ChatMessageProps["onConfirmImport"];
  onConfirmWrite: ChatMessageProps["onConfirmWrite"];
}) => {
  if (!result) return null;

  if (result.action === "ANSWER" || result.action === "CLARIFY") return null;

  if (result.action === "IMPORT_PLAN" && result.importPreview) {
    return <ImportConfirmationCard preview={result.importPreview as ImportPreviewData & { rows: Record<string, any>[] }} onConfirm={onConfirmImport} />;
  }

  if (result.action === "WRITE_PLAN" && result.writePreview) {
    return <WriteConfirmationCard preview={result.writePreview} onConfirm={onConfirmWrite} />;
  }

  return (
    <div className={`mt-2 rounded-lg border ${result.success ? "border-success/20" : "border-destructive/20"} overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/50">
        {result.success ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        )}
        <ActionBadge action={result.action} />
        {result.doctype && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{result.doctype}</span>
          </>
        )}
      </div>

      <div className="p-3">
        {result.error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 mb-2">
            <p className="text-sm text-destructive font-mono whitespace-pre-wrap">{result.error}</p>
          </div>
        )}
        {result.action === "CROSS_CHECK" && <CrossCheckView crossCheck={result.crossCheck} />}
        {result.data && Array.isArray(result.data) && <DataTable data={result.data} doctype={result.doctype} />}
        {result.data && !Array.isArray(result.data) && typeof result.data === "object" && (
          <DataObject data={result.data} />
        )}
      </div>
    </div>
  );
};

const ChatMessageBubble = ({ message, onConfirmImport, onConfirmWrite }: ChatMessageProps) => {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    speak(message.content);
    setSpeaking(true);
    // speechSynthesis has no reliable "onend" hook here across all browsers when
    // triggered this way, so just estimate — good enough for a toggle icon.
    const estMs = Math.min(20000, Math.max(1500, message.content.length * 55));
    setTimeout(() => setSpeaking(false), estMs);
  };

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div className={`group relative max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        {isUser && message.attachedFile && (
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
            <FileSpreadsheet className="h-3 w-3" />
            {message.attachedFile.name} · {message.attachedFile.rowCount} rows
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-[hsl(var(--chat-agent))] text-[hsl(var(--chat-agent-foreground))] rounded-bl-md"
          }`}
        >
          {message.isLoading ? (
            <TypingIndicator />
          ) : (
            <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Code block (agent only) */}
        {!isUser && message.result?.codeGen && (
          <CodeBlock
            title={message.result.codeGen.title}
            scriptType={message.result.codeGen.script_type}
            language={message.result.codeGen.language}
            code={message.result.codeGen.code}
            explanation={message.result.codeGen.explanation}
            usageInstructions={message.result.codeGen.usage_instructions}
          />
        )}

        {/* Result card (agent only) */}
        {!isUser && message.result && !message.result.codeGen && (
          <ResultCard result={message.result} onConfirmImport={onConfirmImport} onConfirmWrite={onConfirmWrite} />
        )}

        {/* Timestamp + copy + speak */}
        <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "justify-end" : "justify-start"}`}>
          <span className="text-[10px] text-muted-foreground">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {!isUser && !message.isLoading && (
            <>
              <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
              {isSpeechSynthesisSupported() && (
                <button onClick={handleSpeak} title="Read aloud" className="text-muted-foreground hover:text-foreground transition-colors">
                  {speaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessageBubble;
