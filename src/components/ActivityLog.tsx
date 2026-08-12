import { Clock, CheckCircle2, XCircle } from "lucide-react";
import type { AgentResult } from "./ResultDisplay";

interface ActivityLogProps {
  results: AgentResult[];
  onSelect: (result: AgentResult) => void;
}

const ActivityLog = ({ results, onSelect }: ActivityLogProps) => {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm">No commands executed yet</p>
        <p className="text-xs mt-1 opacity-60">Type a command or use quick actions to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {results.map((result) => (
        <button
          key={result.id}
          onClick={() => onSelect(result)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary"
        >
          {result.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{result.summary || result.command}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{result.timestamp.toLocaleTimeString()}</p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default ActivityLog;
