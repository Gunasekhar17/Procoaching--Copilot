import { Plus, MessageSquare, Trash2, Settings, X, Search } from "lucide-react";
import { useState } from "react";
import type { Chat } from "@/hooks/useChatStore";

interface ChatSidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onOpenSettings: () => void;
  open: boolean;
  onClose: () => void;
}

const ChatSidebar = ({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onOpenSettings,
  open,
  onClose,
}: ChatSidebarProps) => {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
    : chats;

  if (!open) return null;

  return (
    <>
      {/* Full-screen overlay */}
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Centered panel like Claude's chat history */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
        <div
          className="w-full max-w-2xl mx-4 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">Chats</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { onNewChat(); onClose(); }}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-border">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your chats..."
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Chat count */}
          <div className="px-6 py-2 text-xs text-muted-foreground">
            {filtered.length} chat{filtered.length !== 1 ? "s" : ""}
          </div>

          {/* Chat List */}
          <div className="max-h-[50vh] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                {search ? "No chats found" : "No conversations yet"}
              </p>
            )}
            {filtered.map((chat) => (
              <button
                key={chat.id}
                onClick={() => { onSelectChat(chat.id); onClose(); }}
                className={`group flex w-full items-center gap-3 px-6 py-3 text-left transition-colors border-b border-border/30 last:border-0 ${
                  chat.id === activeChatId
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-foreground">{chat.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {chat.messages.length > 0
                      ? `Last message ${chat.createdAt.toLocaleDateString()}`
                      : chat.createdAt.toLocaleDateString()
                    }
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3">
            <button
              onClick={() => { onOpenSettings(); onClose(); }}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ChatSidebar;
