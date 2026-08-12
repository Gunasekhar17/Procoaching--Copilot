import { corsHeaders, json } from "./_lib/cors";

export const config = { runtime: "edge" };

function parseFrappeError(text: string, status: number): string {
  let msg = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(text);
    if (parsed._server_messages) {
      const msgs = JSON.parse(parsed._server_messages);
      msg = msgs
        .map((m: string) => {
          try {
            return JSON.parse(m).message;
          } catch {
            return m;
          }
        })
        .join("; ");
    } else if (parsed.exception) {
      msg = parsed.exception;
    } else if (parsed.message) {
      msg = parsed.message;
    }
  } catch {
    /* keep default msg */
  }
  return msg.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      confirm,
      site_url,
      api_key,
      api_secret,
      sid,
      auth_method,
      doctype,
      record_action,
      docname,
      field_values,
    }: {
      confirm?: boolean;
      site_url: string;
      api_key?: string;
      api_secret?: string;
      sid?: string;
      auth_method?: string;
      doctype: string;
      record_action: "create" | "update";
      docname?: string;
      field_values: Record<string, any>;
    } = await req.json();

    if (!confirm) {
      return json({ success: false, error: "Write was not confirmed." }, 400);
    }

    const usingSession = auth_method === "session" || !!sid;
    if (!site_url || (usingSession ? !sid : !api_key || !api_secret)) {
      return json({ success: false, error: "Not connected. Please add a connection in Settings first." });
    }
    if (!doctype || !record_action || !field_values || Object.keys(field_values).length === 0) {
      return json({ success: false, error: "Missing write parameters." }, 400);
    }
    if (record_action === "update" && !docname) {
      return json({ success: false, error: "Missing target record for update." }, 400);
    }

    const baseUrl = site_url.replace(/\/$/, "");
    const authHeaders: Record<string, string> = usingSession
      ? { Cookie: `sid=${sid}` }
      : { Authorization: `token ${api_key}:${api_secret}` };
    const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

    const url =
      record_action === "create"
        ? `${baseUrl}/api/resource/${doctype}`
        : `${baseUrl}/api/resource/${doctype}/${encodeURIComponent(docname!)}`;

    const resp = await fetch(url, {
      method: record_action === "create" ? "POST" : "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(field_values),
    });

    const text = await resp.text();

    if (!resp.ok) {
      let errorMessage = parseFrappeError(text, resp.status);
      if (errorMessage.includes("decrypt key") || errorMessage.includes("Encryption key is invalid")) {
        errorMessage = "⚠️ Invalid API credentials.";
      }
      if (resp.status === 403 && usingSession) {
        errorMessage = "⚠️ Your session has expired. Please reconnect in Settings.";
      }
      return json({ success: false, error: errorMessage });
    }

    let savedName = docname || "";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.data?.name) savedName = parsed.data.name;
    } catch {
      /* keep docname fallback */
    }

    return json({
      success: true,
      writeResult: { record_action, doctype, docname: savedName },
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
