import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { useState } from "react";

export interface AgentResult {
  id: string;
  command: string;
  timestamp: Date;
  success: boolean;
  action?: string;
  doctype?: string;
  summary?: string;
  data?: any;
  error?: string;
  status?: number;
}

interface ResultDisplayProps {
  result: AgentResult;
  isLatest?: boolean;
}

const ActionBadge = ({ action }: { action?: string }) => {
  if (!action) return null;
  const colors: Record<string, string> = {
    CREATE: "bg-success/15 text-success border-success/20",
    LIST: "bg-primary/15 text-primary border-primary/20",
    READ: "bg-primary/15 text-primary border-primary/20",
    UPDATE: "bg-warning/15 text-warning border-warning/20",
    DELETE: "bg-destructive/15 text-destructive border-destructive/20",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${colors[action] || "bg-muted text-muted-foreground border-border"}`}>
      {action}
    </span>
  );
};

const ResultDisplay = ({ result, isLatest }: ResultDisplayProps) => {
  const [expanded, setExpanded] = useState(isLatest ?? false);

  const renderData = (data: any) => {
    if (!data) return null;

    if (Array.isArray(data)) {
      if (data.length === 0) return <p className="text-sm text-muted-foreground italic">No records found.</p>;
      const keys = Object.keys(data[0]).filter(k => !k.startsWith("_"));
      return (
        <div className="overflow-x-auto rounded-md border border-border">
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
                    <td key={key} className="px-3 py-2 font-mono text-xs text-foreground whitespace-nowrap">
                      {String(row[key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-t border-border">
            {data.length} record{data.length !== 1 ? "s" : ""} returned
          </div>
        </div>
      );
    }

    if (typeof data === "object" && data !== null) {
      const entries = Object.entries(data).filter(([k]) => !k.startsWith("_") && !k.startsWith("docstatus") && !["idx", "lft", "rgt", "old_parent"].includes(k));
      const important = entries.filter(([k]) => ["name", "employee", "employee_name", "first_name", "status", "company", "department", "designation", "date_of_joining", "date_of_birth"].includes(k));
      const rest = entries.filter(([k]) => !important.some(([ik]) => ik === k));

      return (
        <div className="space-y-2">
          {important.length > 0 && (
            <div className="grid gap-1.5 rounded-md border border-primary/10 bg-primary/5 p-3">
              {important.map(([key, value]) => (
                <div key={key} className="flex items-center gap-3 text-xs">
                  <span className="min-w-[130px] font-mono text-primary/70 capitalize">{key.replace(/_/g, " ")}</span>
                  <span className="font-mono font-medium text-foreground">{String(value ?? "—")}</span>
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                Show {rest.length} more fields
              </summary>
              <div className="mt-2 grid gap-1 rounded-md border border-border bg-muted/30 p-3">
                {rest.map(([key, value]) => (
                  <div key={key} className="flex gap-3 text-xs">
                    <span className="min-w-[130px] font-mono text-muted-foreground">{key.replace(/_/g, " ")}</span>
                    <span className="font-mono text-foreground/80">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      );
    }

    return <p className="font-mono text-sm text-foreground">{String(data)}</p>;
  };

  return (
    <div className={`animate-fade-in rounded-lg border ${result.success ? 'border-success/20' : 'border-destructive/20'} bg-card overflow-hidden`}>
      {/* Parsed Intent Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 border-b border-border/50 flex-wrap">
        <ActionBadge action={result.action} />
        {result.doctype && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono text-xs text-foreground/80">{result.doctype}</span>
          </>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{result.timestamp.toLocaleTimeString()}</span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {result.success ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{result.summary || result.command}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            <span className="font-mono truncate">$ {result.command}</span>
          </div>
          {result.error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
              <p className="text-sm text-destructive font-mono">{result.error}</p>
            </div>
          )}
          {result.data && renderData(result.data)}
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
