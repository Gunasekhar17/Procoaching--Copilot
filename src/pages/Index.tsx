import { useState, useCallback, useRef, useEffect } from "react";
import { Bot, Menu, Sun, Moon, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { useChatStore, type ChatMessage, type UploadedFileData, type ImportPreviewData, type ImportExecuteResult, type WritePreviewData, type WriteExecuteResult } from "@/hooks/useChatStore";
import { useConnection } from "@/hooks/useConnection";
import { downloadAsCSV, downloadAsExcel } from "@/lib/fileTransfer";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessageBubble from "@/components/chat/ChatMessage";
import ChatInput from "@/components/chat/ChatInput";
import EmptyChat from "@/components/chat/EmptyChat";
import SettingsModal from "@/components/chat/SettingsModal";

const Index = () => {
  const { theme, toggle: toggleTheme } = useTheme();
  const { connection, siteName, isConnected, connect, disconnect, systemType } = useConnection();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    chats,
    activeChat,
    activeChatId,
    setActiveChatId,
    createChat,
    deleteChat,
    addMessage,
    updateLastAgentMessage,
  } = useChatStore();

  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeChat?.messages.length, scrollToBottom]);

  const buildAuthPayload = useCallback(() => {
    if (!connection) return null;
    return connection.authMethod === "session"
      ? { auth_method: "session" as const, sid: connection.sid }
      : { auth_method: "apikey" as const, api_key: connection.apiKey, api_secret: connection.apiSecret };
  }, [connection]);

  // Executes a confirmed import against /api/frappe-hr-import. Passed down to
  // the ConfirmationCard rendered inside a chat message.
  const confirmImport = useCallback(
    async (preview: ImportPreviewData & { rows: Record<string, any>[] }): Promise<ImportExecuteResult> => {
      if (!connection) throw new Error("Not connected");
      const res = await fetch("/api/frappe-hr-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          site_url: connection.siteUrl,
          ...buildAuthPayload(),
          doctype: preview.doctype,
          field_mapping: preview.field_mapping,
          match_field: preview.match_field,
          file_key_column: preview.file_key_column,
          mode: preview.mode,
          rows: preview.rows,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Import failed");
      return data.importResult as ImportExecuteResult;
    },
    [connection, buildAuthPayload]
  );

  // Executes a confirmed single create/update against /api/frappe-hr-write.
  // Passed down to the WriteConfirmationCard rendered inside a chat message.
  const confirmWrite = useCallback(
    async (preview: WritePreviewData): Promise<WriteExecuteResult> => {
      if (!connection) throw new Error("Not connected");
      const res = await fetch("/api/frappe-hr-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          site_url: connection.siteUrl,
          ...buildAuthPayload(),
          doctype: preview.doctype,
          record_action: preview.record_action,
          docname: preview.docname,
          field_values: preview.field_values,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Write failed");
      return data.writeResult as WriteExecuteResult;
    },
    [connection, buildAuthPayload]
  );

  const executeCommand = useCallback(
    async (command: string, file: UploadedFileData | null = null) => {
      let chatId = activeChatId;
      if (!chatId) {
        chatId = createChat();
      }

      setSidebarOpen(false);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: command,
        timestamp: new Date(),
        attachedFile: file ? { name: file.name, rowCount: file.rows.length } : undefined,
      };
      addMessage(chatId, userMsg);

      const loadingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        content: "",
        timestamp: new Date(),
        isLoading: true,
      };
      addMessage(chatId, loadingMsg);
      setIsLoading(true);

      if (!connection) {
        updateLastAgentMessage(chatId, {
          content: "You're not connected yet. Open Settings and connect your Frappe site.",
          isLoading: false,
          result: {
            success: false,
            action: "CLARIFY",
            summary: "Connection required before running commands.",
            error: "Not connected",
          },
        });
        setIsLoading(false);
        setSettingsOpen(true);
        toast.info("Connect your Frappe site to continue");
        return;
      }

      const currentChat = chats.find(c => c.id === chatId);
      const history = (currentChat?.messages || [])
        .filter(m => !m.isLoading)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch("/api/frappe-hr-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command,
            conversation_history: history,
            site_url: connection.siteUrl,
            ...buildAuthPayload(),
            file: file ? { name: file.name, headers: file.headers, rows: file.rows } : undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok && data.error) throw new Error(data.error);
        if (data.error) throw new Error(data.error);

        if (data.action === "CLARIFY" || data.needs_input) {
          updateLastAgentMessage(chatId, {
            content: data.summary || "I need more information to proceed.",
            isLoading: false,
          });
          return;
        }

        // Merge the row data back in for IMPORT_PLAN previews — for a file
        // upload this is just the rows already on the client; for records
        // pasted directly into the chat (no file), the backend echoes back
        // the rows it extracted, since the client never had them.
        const importPreview = data.importPreview
          ? { ...data.importPreview, rows: data.importPreview.rows || file?.rows || [] }
          : undefined;

        const resultData = {
          success: data.success ?? false,
          action: data.action,
          doctype: data.doctype,
          summary: data.summary,
          data: data.data,
          error: data.error,
          status: data.status,
          results: data.results,
          exportFormat: data.exportFormat,
          importPreview,
          crossCheck: data.crossCheck,
          writePreview: data.writePreview,
        };

        updateLastAgentMessage(chatId, {
          content: resultData.summary || (resultData.success ? "Done." : resultData.error || "Command failed."),
          isLoading: false,
          result: resultData,
        });

        if (resultData.success && resultData.error) {
          toast.error(resultData.error);
        }

        // Auto-download when the user explicitly asked for a file export
        if (resultData.exportFormat && resultData.exportFormat !== "none" && Array.isArray(resultData.data) && resultData.data.length > 0) {
          const filenameBase = `${resultData.doctype || "frappe-hr-data"}-${new Date().toISOString().slice(0, 10)}`;
          if (resultData.exportFormat === "csv") downloadAsCSV(resultData.data, filenameBase);
          else downloadAsExcel(resultData.data, filenameBase);
        }
      } catch (err: any) {
        updateLastAgentMessage(chatId, {
          content: err.message || "Failed to execute command",
          isLoading: false,
          result: {
            success: false,
            error: err.message || "Failed to execute command",
          },
        });
        toast.error(err.message || "Failed to execute command");
      } finally {
        setIsLoading(false);
      }
    },
    [activeChatId, createChat, addMessage, updateLastAgentMessage, connection, chats, buildAuthPayload]
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Chat history overlay */}
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onNewChat={createChat}
        onDeleteChat={deleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Area - Full width */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur-sm px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-sm font-semibold">
              Frappe HR <span className="text-gradient">Copilot</span>
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Chats button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="Chat history"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Chats</span>
            </button>
            {/* New Chat button */}
            <button
              onClick={() => { createChat(); setSidebarOpen(false); }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="New Chat"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            {/* Connection status */}
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-accent transition-colors cursor-pointer">
              {isConnected ? (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-slow" />
                  <span className="text-[10px] font-medium text-success hidden sm:inline">{siteName}</span>
                </>
              ) : (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  <span className="text-[10px] font-medium text-destructive hidden sm:inline">Not connected</span>
                </>
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Chat Area */}
        {!activeChat || activeChat.messages.length === 0 ? (
          <EmptyChat onAction={executeCommand} systemType={systemType} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
              {activeChat.messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  onConfirmImport={confirmImport}
                  onConfirmWrite={confirmWrite}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input */}
        <ChatInput onSubmit={executeCommand} isLoading={isLoading} />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        connection={connection}
        onConnect={(c) => { connect(c); toast.success("Connected!"); }}
        onDisconnect={() => { disconnect(); toast.info("Disconnected"); }}
      />
    </div>
  );
};

export default Index;
