import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Terminal } from "lucide-react";

interface CommandInputProps {
  onSubmit: (command: string) => void;
  isLoading: boolean;
}

const CommandInput = ({ onSubmit, isLoading }: CommandInputProps) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    onSubmit(value.trim());
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="glow-primary rounded-lg border border-primary/20 bg-card p-1">
      <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
        <Terminal className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs text-primary/70">frappe-hr-agent</span>
      </div>
      <div className="flex items-end gap-2 px-2 pb-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Type a command... e.g. "Show me all employees in IT department"'
          className="min-h-[48px] max-h-[120px] flex-1 resize-none bg-transparent px-2 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          rows={1}
          disabled={isLoading}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isLoading}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default CommandInput;
