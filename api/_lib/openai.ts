// Thin wrapper around the OpenAI Chat Completions API.
// Swap OPENAI_API_KEY / OPENAI_MODEL env vars for another OpenAI-compatible
// provider (Groq, Azure OpenAI, OpenRouter, a self-hosted vLLM endpoint, etc.)
// without touching any other code — they all speak this same request format.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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

export class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function callOpenAI({ messages, tools, toolChoice, model }: CallOptions) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAIError("Missing AI configuration (OPENAI_API_KEY not set).", 500);
  }

  const body: Record<string, unknown> = {
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? "auto";
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("OpenAI error:", res.status, errText);
    if (res.status === 429) throw new OpenAIError("Rate limit exceeded. Please try again shortly.", 429);
    if (res.status === 401) throw new OpenAIError("Invalid OPENAI_API_KEY.", 500);
    if (res.status === 402 || res.status === 403) throw new OpenAIError("AI credits/quota exhausted.", 402);
    throw new OpenAIError("AI request failed.", 500);
  }

  return res.json();
}

export function firstToolCallArgs(data: any): any | null {
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return null;
  }
}

export function messageText(data: any): string | null {
  return data.choices?.[0]?.message?.content ?? null;
}
