// Thin wrapper around Anthropic's Messages API (Claude).
// Mirrors the shape of the old OpenAI wrapper (ChatMessage in, tool-call args
// out) so the rest of the app doesn't need to know which provider is behind it.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Kept in the OpenAI function-calling shape (type/function/parameters) since
// that's how callers already define their tools — we translate it to
// Anthropic's name/description/input_schema shape internally.
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface CallOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
  model?: string;
}

export class ClaudeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function callClaude({ messages, tools, toolChoice, model }: CallOptions) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("Missing AI configuration (ANTHROPIC_API_KEY not set).", 500);
  }

  // Anthropic wants system prompt(s) pulled out into a top-level `system`
  // field, and the remaining messages must alternate user/assistant starting
  // with user. We also collapse any accidental consecutive same-role turns
  // (e.g. from trimmed conversation history) since the API rejects those.
  const systemParts: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      last.content += "\n\n" + m.content;
    } else {
      turns.push({ role: m.role, content: m.content });
    }
  }
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "(no message)" });
  }

  const body: Record<string, unknown> = {
    model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
    messages: turns,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (toolChoice === "auto" || !toolChoice) {
      body.tool_choice = { type: "auto" };
    } else if (typeof toolChoice === "object") {
      body.tool_choice = { type: "tool", name: toolChoice.function.name };
    }
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic error:", res.status, errText);
    if (res.status === 429) throw new ClaudeError("Rate limit exceeded. Please try again shortly.", 429);
    if (res.status === 401) throw new ClaudeError("Invalid ANTHROPIC_API_KEY.", 500);
    if (res.status === 402 || res.status === 403) throw new ClaudeError("AI credits/quota exhausted.", 402);
    if (res.status === 529) throw new ClaudeError("AI service is temporarily overloaded. Please try again shortly.", 529);
    throw new ClaudeError("AI request failed.", 500);
  }

  return res.json();
}

export function firstToolCallArgs(data: any): any | null {
  const block = data?.content?.find((c: any) => c.type === "tool_use");
  return block?.input ?? null;
}

export function messageText(data: any): string | null {
  const block = data?.content?.find((c: any) => c.type === "text");
  return block?.text ?? null;
}
