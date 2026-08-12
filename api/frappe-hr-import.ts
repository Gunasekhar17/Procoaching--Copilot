import { corsHeaders, json } from "./_lib/cors";

export const config = { runtime: "edge" };

// How many create/update requests to fire at once against the Frappe site.
// Keeps us well inside the Edge Function time limit without hammering the site.
const CONCURRENCY = 8;
const BATCH_SIZE = 100;

interface ImportRow {
  action: "create" | "update";
  key: string;
  mapped: Record<string, any>;
  docname?: string;
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
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
      field_mapping,
      match_field,
      file_key_column,
      mode,
      rows,
    }: {
      confirm?: boolean;
      site_url: string;
      api_key?: string;
      api_secret?: string;
      sid?: string;
      auth_method?: string;
      doctype: string;
      field_mapping: Record<string, string>;
      match_field: string;
      file_key_column: string;
      mode: "create" | "update" | "upsert";
      rows: Record<string, any>[];
    } = await req.json();

    if (!confirm) {
      return json({ success: false, error: "Import was not confirmed." }, 400);
    }

    const usingSession = auth_method === "session" || !!sid;
    if (!site_url || (usingSession ? !sid : !api_key || !api_secret)) {
      return json({ success: false, error: "Not connected. Please add a connection in Settings first." });
    }
    if (!doctype || !field_mapping || !match_field || !file_key_column || !Array.isArray(rows)) {
      return json({ success: false, error: "Missing import parameters." }, 400);
    }
    if (rows.length === 0) {
      return json({ success: false, error: "No rows to import." }, 400);
    }

    const baseUrl = site_url.replace(/\/$/, "");
    const authHeaders: Record<string, string> = usingSession
      ? { Cookie: `sid=${sid}` }
      : { Authorization: `token ${api_key}:${api_secret}` };
    const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

    // 1. Figure out which rows already exist (need their Frappe docname to PUT to)
    const keys = Array.from(
      new Set(rows.map((r) => String(r[file_key_column] ?? "").trim()).filter(Boolean))
    );
    const existingByKey = new Map<string, string>(); // matchField value -> docname

    if (mode !== "create") {
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const chunk = keys.slice(i, i + BATCH_SIZE);
        const params = new URLSearchParams();
        params.set("filters", JSON.stringify([[match_field, "in", chunk]]));
        params.set("fields", JSON.stringify(["name", match_field]));
        params.set("limit_page_length", "0");
        const resp = await fetch(`${baseUrl}/api/resource/${doctype}?${params.toString()}`, { headers: authHeaders });
        if (resp.ok) {
          const data = await resp.json();
          for (const rec of data.data || []) {
            const k = String(rec[match_field] ?? "").trim();
            if (k) existingByKey.set(k, rec.name);
          }
        }
      }
    }

    // 2. Build the list of rows to write, each tagged create/update
    const plan: ImportRow[] = [];
    for (const row of rows) {
      const key = String(row[file_key_column] ?? "").trim();
      if (!key) continue;
      const docname = existingByKey.get(key);
      const rowAction: "create" | "update" | null =
        mode === "create" ? (docname ? null : "create")
        : mode === "update" ? (docname ? "update" : null)
        : (docname ? "update" : "create");
      if (!rowAction) continue;

      const mapped: Record<string, any> = {};
      for (const [fileCol, frappeField] of Object.entries(field_mapping)) {
        if (!frappeField) continue;
        if (rowAction === "update" && frappeField === "name") continue; // never try to rename via update
        mapped[frappeField] = row[fileCol];
      }
      plan.push({ action: rowAction, key, mapped, docname });
    }

    // 3. Execute, with limited concurrency
    const failed: Array<{ key: string; error: string }> = [];
    let created = 0;
    let updated = 0;

    await runWithConcurrency(plan, CONCURRENCY, async (item) => {
      try {
        const url = item.action === "create"
          ? `${baseUrl}/api/resource/${doctype}`
          : `${baseUrl}/api/resource/${doctype}/${encodeURIComponent(item.docname!)}`;
        const resp = await fetch(url, {
          method: item.action === "create" ? "POST" : "PUT",
          headers: jsonHeaders,
          body: JSON.stringify(item.mapped),
        });
        if (resp.ok) {
          if (item.action === "create") created++; else updated++;
        } else {
          const text = await resp.text();
          let msg = `HTTP ${resp.status}`;
          try {
            const parsed = JSON.parse(text);
            if (parsed._server_messages) {
              const msgs = JSON.parse(parsed._server_messages);
              msg = msgs.map((m: string) => { try { return JSON.parse(m).message; } catch { return m; } }).join("; ");
            } else if (parsed.exception) {
              msg = parsed.exception;
            }
          } catch { /* keep default msg */ }
          msg = msg.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
          failed.push({ key: item.key, error: msg });
        }
      } catch (e) {
        failed.push({ key: item.key, error: e instanceof Error ? e.message : "Request failed" });
      }
    });

    return json({
      success: true,
      importResult: { created, updated, failed: failed.slice(0, 50) },
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
