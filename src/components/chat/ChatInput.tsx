import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Mic, Paperclip, X, FileSpreadsheet } from "lucide-react";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { parseSpreadsheetFile, FileTooLargeError } from "@/lib/fileTransfer";
import type { UploadedFileData } from "@/hooks/useChatStore";
import { toast } from "sonner";

interface ChatInputProps {
  onSubmit: (message: string, file: UploadedFileData | null) => void;
  isLoading: boolean;
}

const ChatInput = ({ onSubmit, isLoading }: ChatInputProps) => {
  const [value, setValue] = useState("");
  const [attachedFile, setAttachedFile] = useState<UploadedFileData | null>(null);
  const [parsingFile, setParsingFile] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [value]);

  const { isListening, isSupported: micSupported, toggle: toggleMic } = useSpeechInput((transcript) => {
    setValue((prev) => (prev ? prev + " " + transcript : transcript));
  });

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    onSubmit(value.trim(), attachedFile);
    setValue("");
    setAttachedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;

    setParsingFile(true);
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.rows.length === 0) {
        toast.error("That file doesn't have any rows.");
        return;
      }
      setAttachedFile(parsed);
      toast.success(`Attached ${file.name} · ${parsed.rows.length} rows`);
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        toast.error(err.message);
      } else {
        toast.error("Couldn't read that file. Make sure it's a valid CSV or Excel file.");
      }
    } finally {
      setParsingFile(false);
    }
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-medium truncate">{attachedFile.name}</span>
            <span className="text-muted-foreground shrink-0">{attachedFile.rows.length} rows</span>
            <button
              onClick={() => setAttachedFile(null)}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
              title="Remove attachment"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-2 shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFilePick}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || parsingFile}
            title="Attach a CSV or Excel file"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            {parsingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : "Ask a question about your HR data..."}
            className="flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none"
            rows={1}
            disabled={isLoading}
          />

          {micSupported && (
            <button
              onClick={toggleMic}
              disabled={isLoading}
              title={isListening ? "Stop listening" : "Ask by voice"}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-30 ${
                isListening
                  ? "bg-destructive/15 text-destructive animate-pulse"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          Press <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">Enter</kbd> to send, <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px]">Shift+Enter</kbd> for new line
          {micSupported ? " · click the mic to ask by voice" : ""}
        </p>
      </div>
    </div>
  );
};

export default ChatInput;
