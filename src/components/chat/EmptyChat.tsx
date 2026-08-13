import {
  Bot, Users, CalendarClock, Receipt, Clock, Briefcase,
  HelpCircle, BarChart3,
  type LucideIcon,
} from "lucide-react";
import type { SystemType } from "@/hooks/useConnection";

interface EmptyChatProps {
  onAction: (command: string) => void;
  systemType: SystemType;
}

interface Suggestion {
  icon: LucideIcon;
  label: string;
  command: string;
}

const suggestions: Suggestion[] = [
  { icon: Users, label: "How many employees?", command: "How many employees do I have?" },
  { icon: CalendarClock, label: "Today's shift roster", command: "Who's on shift today?" },
  { icon: Clock, label: "Pending timesheets", command: "Show me pending timesheets" },
  { icon: Receipt, label: "Expense claims to approve", command: "What expense claims are pending approval?" },
];

const disconnectedSuggestions: Suggestion[] = [
  { icon: HelpCircle, label: "What can you do?", command: "What kind of questions can you answer?" },
  { icon: BarChart3, label: "Example queries", command: "Show me some example questions I can ask" },
];

const EmptyChat = ({ onAction, systemType }: EmptyChatProps) => {
  const isConnected = !!systemType;
  const items = isConnected ? suggestions : disconnectedSuggestions;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
        <Bot className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        HR <span className="text-gradient">Q&A</span>
      </h2>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
        {isConnected
          ? "Ask me anything about your HR data. I'll query your Frappe HRMS site and give you clear answers."
          : "Connect your Frappe HRMS site to start asking questions about your HR data."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {items.map((s) => (
          <button
            key={s.label}
            onClick={() => onAction(s.command)}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent hover:border-primary/20"
          >
            <s.icon className="h-4 w-4 text-primary shrink-0" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default EmptyChat;
