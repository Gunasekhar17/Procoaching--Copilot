import { corsHeaders, json } from "./_lib/cors";
import { callOpenAI, firstToolCallArgs, OpenAIError, type ChatMessage } from "./_lib/openai";

export const config = { runtime: "edge" };

const systemPrompt = `You are an expert Frappe/ERPNext code generator. Generate clean, production-ready code based on the user's request.

## CRITICAL RULE: NO IMPORT STATEMENTS

Frappe does NOT use import statements. The \`frappe\` module is GLOBALLY available in all contexts.

❌ NEVER generate:
- import frappe
- from frappe import _
- from frappe.model import ...
- import json (use frappe.parse_json or frappe.as_json instead)

✅ CORRECT — frappe is globally available:
- frappe.db.get_all(...)
- frappe.get_doc(...)
- frappe.throw(...)
- doc = frappe.new_doc(...)

## Script Types

### Server Script (API / DocType Event / Scheduler)
- API type: use \`frappe.response["message"] = result\` to return data
- DocType Event type: \`doc\` variable is available automatically
- Scheduler type: runs periodically
- Always use \`frappe.db\` for database operations
- Use \`frappe.throw()\` for errors, \`frappe.msgprint()\` for messages
- Use \`frappe.utils\` for date/number utilities (e.g., \`frappe.utils.now()\`, \`frappe.utils.getdate()\`)

### Client Script
- Use \`frappe.ui.form.on()\` for form events
- Use \`frm.set_value()\`, \`frm.toggle_display()\`, \`frm.add_custom_button()\`
- Use \`frappe.call()\` for server calls
- Use \`frappe.msgprint()\`, \`frappe.confirm()\` for UI
- Wrap in appropriate event: setup, refresh, validate, before_save, etc.

### Print Format (Jinja)
- Use Jinja2 templating: {{ doc.field_name }}
- Available: doc, frappe, frappe.utils
- For loops: {% for item in doc.items %} ... {% endfor %}
- Filters: {{ doc.grand_total | fmt_money }}

### Web Page (HTML/JS/CSS)
- Use \`frappe.call()\` for data fetching
- Use \`frappe.web_form\` for interactive forms
- Use standard HTML/CSS/JS
- frappe.ready() for page load events

## Response Format

Return the code using the generate_code tool. Always include:
1. The code itself (clean, commented, no imports)
2. The script type
3. A title describing what it does
4. Clear usage instructions explaining WHERE and HOW to use it in Frappe`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { command, conversation_history } = await req.json();
    if (!command) {
      return json({ error: "Command is required" }, 400);
    }

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

    if (conversation_history && Array.isArray(conversation_history)) {
      for (const msg of conversation_history.slice(-6)) {
        messages.push({
          role: msg.role === "agent" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }
    messages.push({ role: "user", content: command });

    let aiData;
    try {
      aiData = await callOpenAI({
        messages,
        tools: [
          {
            type: "function",
            function: {
              name: "generate_code",
              description: "Generate Frappe code with metadata",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short title for the code snippet" },
                  script_type: {
                    type: "string",
                    enum: ["Server Script", "Client Script", "Print Format", "Web Page"],
                    description: "Type of Frappe script",
                  },
                  language: {
                    type: "string",
                    enum: ["python", "javascript", "html", "css"],
                    description: "Programming language of the code",
                  },
                  code: { type: "string", description: "The generated code — MUST NOT contain any import statements" },
                  explanation: { type: "string", description: "Brief explanation of what the code does" },
                  usage_instructions: {
                    type: "string",
                    description: "Step-by-step instructions on where and how to use this code in Frappe/ERPNext",
                  },
                },
                required: ["title", "script_type", "language", "code", "explanation", "usage_instructions"],
              },
            },
          },
        ],
        toolChoice: { type: "function", function: { name: "generate_code" } },
      });
    } catch (e) {
      if (e instanceof OpenAIError) return json({ error: e.message }, e.status);
      throw e;
    }

    const parsed = firstToolCallArgs(aiData);
    if (!parsed) {
      return json({ error: "Could not generate code for this request" }, 400);
    }

    // Safety check: strip any import lines that slipped through
    let cleanCode: string = parsed.code;
    cleanCode = cleanCode
      .split("\n")
      .filter((line: string) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("import frappe") &&
          !trimmed.startsWith("from frappe") &&
          !trimmed.startsWith("import json") &&
          !trimmed.startsWith("from __future__")
        );
      })
      .join("\n");

    return json({
      success: true,
      action: "CODE_GEN",
      title: parsed.title,
      script_type: parsed.script_type,
      language: parsed.language,
      code: cleanCode,
      explanation: parsed.explanation,
      usage_instructions: parsed.usage_instructions,
    });
  } catch (e) {
    console.error("Code gen error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
