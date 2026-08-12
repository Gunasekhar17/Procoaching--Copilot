import { useState } from "react";
import { Copy, Check, FileCode, BookOpen } from "lucide-react";

interface CodeBlockProps {
  title: string;
  scriptType: string;
  language: string;
  code: string;
  explanation: string;
  usageInstructions: string;
}

// Simple keyword-based syntax highlighting
const highlightCode = (code: string, language: string) => {
  if (language === "python") {
    return code
      .replace(/\b(def|class|if|elif|else|for|while|return|try|except|finally|with|as|raise|pass|True|False|None|and|or|not|in|is|lambda)\b/g, '<span class="text-primary font-semibold">$1</span>')
      .replace(/\b(frappe)\b/g, '<span class="text-accent-foreground font-semibold">$1</span>')
      .replace(/(#.*$)/gm, '<span class="text-muted-foreground italic">$1</span>')
      .replace(/(&quot;[^&]*&quot;|"[^"]*"|'[^']*')/g, '<span class="text-chart-4">$1</span>');
  }
  if (language === "javascript") {
    return code
      .replace(/\b(function|const|let|var|if|else|for|while|return|try|catch|finally|new|this|class|async|await|typeof|instanceof)\b/g, '<span class="text-primary font-semibold">$1</span>')
      .replace(/\b(frappe|frm|cur_frm)\b/g, '<span class="text-accent-foreground font-semibold">$1</span>')
      .replace(/(\/\/.*$)/gm, '<span class="text-muted-foreground italic">$1</span>')
      .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, '<span class="text-chart-4">$1</span>');
  }
  if (language === "html") {
    return code
      .replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;|<\/?[a-zA-Z][^>]*?>)/g, '<span class="text-primary">$1</span>')
      .replace(/({{.*?}}|{%.*?%})/g, '<span class="text-chart-4 font-semibold">$1</span>')
      .replace(/(<!--.*?-->)/gs, '<span class="text-muted-foreground italic">$1</span>');
  }
  return code;
};

const CodeBlock = ({ title, scriptType, language, code, explanation, usageInstructions }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const escapeHtml = (str: string) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const highlighted = highlightCode(escapeHtml(code), language);

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border">
        <div className="flex items-center gap-2">
          <FileCode className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">{title}</span>
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-primary">
            {scriptType}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Explanation */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border/50">
        <p className="text-xs text-muted-foreground">{explanation}</p>
      </div>

      {/* Code */}
      <div className="overflow-x-auto bg-card">
        <pre className="px-4 py-3 text-sm font-mono leading-relaxed">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>

      {/* Usage instructions toggle */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowInstructions(!showInstructions)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <BookOpen className="h-3 w-3" />
          {showInstructions ? "Hide" : "Show"} Usage Instructions
        </button>
        {showInstructions && (
          <div className="px-4 py-3 bg-muted/20 border-t border-border/50">
            <div className="text-xs leading-relaxed space-y-1 whitespace-pre-wrap text-muted-foreground">
              {usageInstructions}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeBlock;
