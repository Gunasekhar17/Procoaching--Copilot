import { useState, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  result?: AgentResultData;
  isLoading?: boolean;
  attachedFile?: UploadedFileMeta;
}

export interface UploadedFileMeta {
  name: string;
  rowCount: number;
}

export interface UploadedFileData {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

export interface CodeGenData {
  title: string;
  script_type: string;
  language: string;
  code: string;
  explanation: string;
  usage_instructions: string;
}

export interface ImportPreviewRow {
  action: "create" | "update";
  key: string;
  mapped: Record<string, any>;
}

export interface ImportPreviewData {
  doctype: string;
  field_mapping: Record<string, string>;
  match_field: string;
  file_key_column: string;
  to_create: number;
  to_update: number;
  skipped: number;
  sample: ImportPreviewRow[];
  file_name: string;
  mode: "create" | "update" | "upsert";
}

export interface ImportExecuteResult {
  created: number;
  updated: number;
  failed: Array<{ key: string; error: string }>;
}

// A single create/update the agent wants to make from a plain chat command
// (no file attached) — e.g. "update Priya Sharma's designation to Manager".
// Nothing is written until the user confirms this preview.
export interface WritePreviewData {
  doctype: string;
  record_action: "create" | "update";
  docname?: string; // resolved target document, for "update" only
  lookup_field?: string;
  lookup_value?: string;
  matched_label?: string; // human-readable label of the record that was matched
  field_values: Record<string, any>;
}

export interface WriteExecuteResult {
  record_action: "create" | "update";
  doctype: string;
  docname: string;
}

export interface CrossCheckMismatch {
  key: string;
  field: string;
  file_value: any;
  frappe_value: any;
}

export interface CrossCheckData {
  doctype: string;
  match_field: string;
  file_key_column: string;
  matched: number;
  mismatched: CrossCheckMismatch[];
  missing_in_frappe: string[];
  missing_in_file_count: number;
}

export interface AgentResultData {
  success: boolean;
  action?: string;
  doctype?: string;
  summary?: string;
  data?: any;
  error?: string;
  status?: number;
  results?: AgentResultData[]; // for MULTI action
  pendingDelete?: {
    doctype: string;
    name?: string;
    needs_employee_lookup?: boolean;
    employee_name?: string;
  };
  codeGen?: CodeGenData;
  exportFormat?: "csv" | "xlsx" | "none";
  aggregate?: "count" | "sum" | "list" | "none";
  importPreview?: ImportPreviewData;
  importResult?: ImportExecuteResult;
  crossCheck?: CrossCheckData;
  writePreview?: WritePreviewData;
  writeResult?: WriteExecuteResult;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

export function useChatStore() {
  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = localStorage.getItem("frappe-hr-chats");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
        }));
      } catch { return []; }
    }
    return [];
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    return chats.length > 0 ? chats[0].id : null;
  });

  const persist = useCallback((updatedChats: Chat[]) => {
    localStorage.setItem("frappe-hr-chats", JSON.stringify(updatedChats));
  }, []);

  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  const createChat = useCallback(() => {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
      createdAt: new Date(),
    };
    const updated = [newChat, ...chats];
    setChats(updated);
    setActiveChatId(newChat.id);
    persist(updated);
    return newChat.id;
  }, [chats, persist]);

  const deleteChat = useCallback((chatId: string) => {
    const updated = chats.filter((c) => c.id !== chatId);
    setChats(updated);
    if (activeChatId === chatId) {
      setActiveChatId(updated.length > 0 ? updated[0].id : null);
    }
    persist(updated);
  }, [chats, activeChatId, persist]);

  const addMessage = useCallback((chatId: string, message: ChatMessage) => {
    setChats((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== chatId) return c;
        const msgs = [...c.messages, message];
        const title = c.messages.length === 0 && message.role === "user"
          ? message.content.slice(0, 40) + (message.content.length > 40 ? "..." : "")
          : c.title;
        return { ...c, messages: msgs, title };
      });
      persist(updated);
      return updated;
    });
  }, [persist]);

  const updateLastAgentMessage = useCallback((chatId: string, updates: Partial<ChatMessage>) => {
    setChats((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== chatId) return c;
        const msgs = [...c.messages];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === "agent") {
            msgs[i] = { ...msgs[i], ...updates };
            break;
          }
        }
        return { ...c, messages: msgs };
      });
      persist(updated);
      return updated;
    });
  }, [persist]);

  const updateMessageById = useCallback((chatId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setChats((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== chatId) return c;
        const msgs = c.messages.map((m) => (m.id === messageId ? { ...m, ...updates } : m));
        return { ...c, messages: msgs };
      });
      persist(updated);
      return updated;
    });
  }, [persist]);

  return {
    chats,
    activeChat,
    activeChatId,
    setActiveChatId,
    createChat,
    deleteChat,
    addMessage,
    updateLastAgentMessage,
    updateMessageById,
  };
}
