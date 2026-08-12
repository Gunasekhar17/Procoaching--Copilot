import { UserPlus, CalendarCheck, ClipboardList, Users, FileText } from "lucide-react";

interface QuickActionsProps {
  onAction: (command: string) => void;
  isLoading: boolean;
}

const actions = [
  { icon: UserPlus, label: "New Employee", command: "Create a new Employee (I'll provide the details)" },
  { icon: FileText, label: "New Leave App", command: "Create a new Leave Application (I'll provide the details)" },
  { icon: CalendarCheck, label: "Mark Attendance", command: "Mark attendance for today" },
  { icon: Users, label: "View Employees", command: "List all employees" },
  { icon: ClipboardList, label: "View Leaves", command: "Show all pending Leave Applications" },
];

const QuickActions = ({ onAction, isLoading }: QuickActionsProps) => {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.command)}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground transition-all hover:border-primary/30 hover:bg-secondary/80 disabled:opacity-50"
        >
          <action.icon className="h-3.5 w-3.5 text-primary" />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default QuickActions;
