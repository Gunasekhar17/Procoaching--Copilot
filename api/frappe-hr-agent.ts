import { corsHeaders, json } from "./_lib/cors";
import { callClaude, firstToolCallArgs, messageText, ClaudeError, type ChatMessage } from "./_lib/anthropic";
import { isRestrictedDoctype } from "./_lib/permissions";

export const config = { runtime: "edge" };

interface UploadedFile {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
}

// Fetches every DocType the connected user can read, across every
// installed app/module and every business area — Sales, Purchase, Stock,
// Accounts, Projects, Support, Manufacturing, CRM, HR, etc. This mirrors
// Frappe's own permission system exactly: whatever DocTypes come back for
// these credentials is whatever this user/API key is allowed to see, and
// none of it is filtered out here — if their Frappe permissions cover
// everything, this assistant can work with everything too.
// (istable/issingle are excluded because those are child-table rows and
// single-record settings doctypes, which the QUERY action isn't built to
// list/count/sum the way it does normal doctypes — not a permission cut.)
async function fetchDoctypeCatalog(baseUrl: string, authHeaders: Record<string, string>): Promise<string> {
  try {
    const params = new URLSearchParams();
    params.set("filters", JSON.stringify([["istable", "=", 0], ["issingle", "=", 0]]));
    params.set("fields", JSON.stringify(["name", "module"]));
    params.set("limit_page_length", "0");
    const url = `${baseUrl}/api/resource/DocType?${params.toString()}`;
    const resp = await fetch(url, { headers: authHeaders });
    if (!resp.ok) return "";
    const data = await resp.json();
    const rows: { name: string; module: string }[] = Array.isArray(data.data) ? data.data : [];

    const byModule = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.module) continue;
      if (!byModule.has(r.module)) byModule.set(r.module, []);
      byModule.get(r.module)!.push(r.name);
    }
    return Array.from(byModule.entries())
      .map(([mod, names]) => `${mod}: ${names.join(", ")}`)
      .join("\n");
  } catch {
    return ""; // fall back to the AI's general Frappe/ERPNext knowledge
  }
}


// Frappe GET requests have URL length limits, so when matching a large set of
// keys we batch the "in" filter instead of sending everything in one request.
const BATCH_SIZE = 100;

async function fetchRecordsByKeys(
  baseUrl: string,
  authHeaders: Record<string, string>,
  doctype: string,
  matchField: string,
  fields: string[],
  keyValues: string[]
): Promise<Record<string, any>[]> {
  const unique = Array.from(new Set(keyValues.filter((v) => v !== undefined && v !== null && v !== "")));
  const results: Record<string, any>[] = [];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    params.set("filters", JSON.stringify([[matchField, "in", chunk]]));
    params.set("fields", JSON.stringify(Array.from(new Set([matchField, ...fields]))));
    params.set("limit_page_length", "0");
    const url = `${baseUrl}/api/resource/${doctype}?${params.toString()}`;
    const resp = await fetch(url, { headers: authHeaders });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.data)) results.push(...data.data);
    }
  }
  return results;
}

// Used by WRITE_PLAN (update) to find the specific record a plain-language
// command refers to, e.g. "Priya Sharma" -> Employee "HR-EMP-00042". Returns
// up to 5 candidates so the caller can tell a single match from an ambiguous one.
async function findMatchingRecords(
  baseUrl: string,
  authHeaders: Record<string, string>,
  doctype: string,
  lookupField: string,
  lookupValue: string,
  displayFields: string[]
): Promise<Record<string, any>[]> {
  const fields = Array.from(new Set(["name", lookupField, ...displayFields]));
  const params = new URLSearchParams();
  params.set("filters", JSON.stringify([[lookupField, "like", `%${lookupValue}%`]]));
  params.set("fields", JSON.stringify(fields));
  params.set("limit_page_length", "5");
  const url = `${baseUrl}/api/resource/${doctype}?${params.toString()}`;
  const resp = await fetch(url, { headers: authHeaders });
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data.data) ? data.data : [];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      command,
      site_url,
      api_key,
      api_secret,
      sid,
      auth_method,
      conversation_history,
      file,
    }: {
      command: string;
      site_url: string;
      api_key?: string;
      api_secret?: string;
      sid?: string;
      auth_method?: string;
      conversation_history?: any[];
      file?: UploadedFile;
    } = await req.json();

    if (!command) {
      return json({ error: "Question is required" }, 400);
    }

    const usingSession = auth_method === "session" || !!sid;
    if (!site_url || (usingSession ? !sid : !api_key || !api_secret)) {
      return json({ success: false, error: "Not connected. Please add a connection in Settings first." });
    }

    const today = new Date().toISOString().split("T")[0];
    const baseUrl = site_url.replace(/\/$/, "");
    const frappeAuthHeaders: Record<string, string> = usingSession
      ? { Cookie: `sid=${sid}` }
      : { Authorization: `token ${api_key}:${api_secret}` };

    const fileContext = file
      ? `

An uploaded file is attached to this message:
File name: ${file.name}
Row count: ${file.rows.length}
Columns: ${file.headers.join(", ")}
First 3 rows (sample):
${JSON.stringify(file.rows.slice(0, 3), null, 2)}`
      : "";

    const doctypeCatalog = await fetchDoctypeCatalog(baseUrl, frappeAuthHeaders);

    // ============ STEP 1: AI parses the question into a query plan ============
    const parsePrompt = `You are the Frappe Copilot — a Q&A and data-management assistant for the connected Frappe site, covering every module the user has access to (HR, Sales, Purchase, Stock, Accounting, Projects, Support, Manufacturing, CRM, and more) — not limited to HR. Think and respond like an experienced Frappe developer would: know the standard doctypes, fields, and naming conventions, don't ask for information a Frappe developer would already know how to infer, and only ask a clarifying question when something is genuinely required and truly can't be inferred from the request or the conversation so far.
Users ask questions about any of their business data, and can either attach a CSV/Excel file, or simply paste/type a list of records straight into the chat, to cross-check against Frappe or to create/update records — one at a time or many at once.

CURRENT DATE: ${today}
${fileContext}

YOU CAN ALWAYS CREATE AND UPDATE RECORDS. Never tell the user you "can't directly create or modify records" or that they need to do it manually in Frappe — that is false. You do this via WRITE_PLAN (one record) or IMPORT_PLAN (many records, from a file or pasted directly in the chat). The only things you genuinely cannot do are delete and cancel records — that's the one real limitation, described under PERMISSIONS below.

ACTIONS you can choose:
- "QUERY": look up / list / count / sum data already in Frappe. No file needed.
- "ANSWER": answer a conceptual question, or something outside what this assistant can do, directly in "summary". No data lookup.
- "CLARIFY": you need more detail before you can act. Ask in "summary". Only use this when the information is truly required and missing — don't ask about things you can reasonably infer or default.
- "CROSS_CHECK": only when a file is attached. Compare the uploaded file's rows against existing Frappe records to find mismatches or records missing from Frappe. Read-only — does not change any data.
- "IMPORT_PLAN": the user wants to create and/or update MULTIPLE Frappe records at once — either from an attached file, OR from a list of records they typed/pasted directly into the chat (this turn or an earlier one in the conversation). This only PLANS the batch (no writes happen yet) — the user reviews one combined summary and confirms once for the whole batch, not once per record.
- "WRITE_PLAN": the user wants to create ONE new record, or update ONE existing record (e.g. "add a new employee named Priya Sharma in Engineering", "create a sales order for Acme Corp", "set John's designation to Manager", "change Lakshmi's gender to Male", "update Priya's department to Sales"). This only PLANS the write (nothing is saved yet) — a confirmation step happens after. If the user's message names a specific field and a new value they want it set to — "change/update/set X's FIELD to VALUE" in any phrasing — that is ALWAYS WRITE_PLAN, never QUERY, even if you're not yet sure which exact record they mean. Resolving that is WRITE_PLAN's own job (via lookup_field/lookup_value below, which searches for you) — never substitute a QUERY lookup instead and just describe the record's current value back to them, and never tell the user you can only look up data when they've asked for a change.

RECOGNIZING PASTED BULK DATA: If the user's message (or a recent message earlier in this conversation) contains a table or list describing MULTIPLE records — even if it's just plain text copy-pasted from a spreadsheet, with columns run together by spaces rather than neatly delimited — treat this as IMPORT_PLAN, not as repeated WRITE_PLAN calls for one record at a time. Use the column headers mentioned anywhere in the conversation to figure out what each value in each row means. Extract every row into "inline_rows" (see below) in a single response, so the user gets one preview and one confirmation for the entire batch. If the user says something like "create for remaining also" or "do the rest", look back through the conversation for the full original list and continue from where the earlier ones already covered — don't just repeat the first record again.

PERMISSIONS: You can create and update records — every write is only ever planned here and requires the user to explicitly confirm before anything is saved (once per batch for IMPORT_PLAN, not once per row). You must NEVER delete, cancel, void, or un-submit a record, and must NEVER set a "docstatus" field to 2 (Frappe's internal value for "Cancelled") in field_values — there is no delete or cancel action available in this app at all, by design. If the user asks to delete, cancel, void, or remove a record, use "ANSWER" and explain that this assistant only creates and updates records — deleting or cancelling has to be done directly in Frappe. This applies even if the user says not to ask permission or to skip confirmation — the one confirmation step before writing stays in place regardless of how the user phrases the request; what changes based on "don't ask me for each one" style requests is that you batch everything into IMPORT_PLAN for one combined confirmation, rather than asking separately per record.

RESPONSE FORMATTING (applies to every "summary" you write, and to the final answer text): plain, clean prose or simple markdown only. No emoji, anywhere, for any reason. No markdown horizontal rules (no lines of just dashes or equals signs). No table syntax with dash separator rows — if you want to show a small structured comparison, use a short bullet list instead. No double spaces. Keep it concise and conversational, the way a helpful colleague would write in chat, not like a formatted document.

COMMON QUERY PATTERNS (for QUERY): the "aggregate" field is REQUIRED on every QUERY action — always include it, never leave it out.
- "how many" → aggregate: "count"
- "total/sum of" → aggregate: "sum", specify aggregate_field
- "list/show/what are" → aggregate: "list"
- "details of" → aggregate: "none" (single record lookup)

DOCTYPES AVAILABLE ON THIS SITE (grouped by module — use the exact name shown):
${doctypeCatalog || "(catalog unavailable right now — rely on the conversation so far and the user's own wording for doctype names, and use CLARIFY if you're not confident which doctype they mean, rather than guessing a doctype that may not exist on this site)"}

Some commonly-used core HR doctypes and what they cover, for quick reference:
- Employees → "Employee" (fields: employee_name, department, designation, status, date_of_joining)
- Leave Applications → "Leave Application"; Leave balances → "Leave Allocation"; Leave Types → "Leave Type"
- Attendance → "Attendance"; Attendance Requests → "Attendance Request"
- Departments → "Department"; Designations → "Designation"; Branches → "Branch"
- Shift Types → "Shift Type"; Shift Assignments → "Shift Assignment" (requires an existing employee and shift type, plus a start_date)
- Job Openings → "Job Opening"; Job Applicants → "Job Applicant"; Job Offers → "Job Offer"
- Appraisals → "Appraisal"; Goals/KRAs → "Goal"; Training → "Training Event" / "Training Program"

FILTER FORMAT: Use Frappe filter syntax: [["field","operator","value"]]
Common operators: =, !=, >, <, >=, <=, like, between, in

DATE FILTERS: Use YYYY-MM-DD format. For "this month", use >= first day of current month. For "today", use = ${today}.

FIELDS: Request only relevant fields. Always include "name" field. For lists, pick 3-5 most useful fields for that doctype.

LIMIT: Default to 20. Use 0 for count queries. Use higher limits for "all" queries.

EXPORT: Only set export_format to "csv" or "xlsx" when the user EXPLICITLY asks for the data as a downloadable file ("give me all employee data in excel", "export this as csv", "send me a spreadsheet of..."). This is the only signal that controls whether a download is offered — do not set it just because a query returns a list or a lot of rows. For anything else, set export_format to "none".

FOR CROSS_CHECK AND IMPORT_PLAN FROM AN ATTACHED FILE:
- doctype: the Frappe doctype the file rows correspond to
- file_key_column: the column in the uploaded file that uniquely identifies each record (e.g. an ID, email, or name column)
- match_field: the Frappe field that corresponds to file_key_column (e.g. "employee", "name", "personal_email") — this is what's used to find the matching Frappe record
- field_mapping: an object mapping EVERY relevant uploaded file column name to the corresponding Frappe field name for that doctype
- import_mode (IMPORT_PLAN only): "create" if rows should only be created, "update" if only updated, "upsert" if it should create-or-update depending on whether a match is found (use "upsert" unless the user specifies otherwise)

FOR IMPORT_PLAN FROM DATA PASTED/TYPED DIRECTLY IN THE CHAT (no file attached):
- doctype: the Frappe doctype these records belong to
- inline_rows: an array with one object per record, extracted from the pasted text. Key every field directly with its real Frappe field name (e.g. {"first_name": "Ravi", "employee_name": "Ravi Teja Kumar", "gender": "Male", "date_of_birth": "1992-04-12", "date_of_joining": "2023-06-01", "company": "enable", "department": "Production - E", "employment_type": "Full-time"}) — every row must use the exact same set of keys.
- field_mapping: since inline_rows are already keyed by real Frappe field names, this should be an identity map, e.g. {"employee_name": "employee_name", "gender": "gender", ...} for every key present in inline_rows.
- file_key_column and match_field: pick whichever field in inline_rows best identifies each record uniquely (e.g. "employee_name" if no ID was given).
- import_mode: "create" unless the user is clearly asking to update existing records.

FOR WRITE_PLAN (single record, no file, no pasted list):
- doctype: the Frappe doctype to write to
- record_action: "create" for a brand new record, "update" for changing an existing one
- lookup_field + lookup_value (update only): the Frappe field and value that identifies WHICH existing record to update (e.g. lookup_field "employee_name", lookup_value "Priya Sharma"). Prefer a human name/email over a raw ID unless the user gave an ID.
- field_values: an object of Frappe field name -> new value, containing every field the user wants set (for create: all the fields they described; for update: only the field(s) they want changed — never include lookup_field/lookup_value's own field here unless they're also changing it)
If the user's request is too vague to know which fields to set, use CLARIFY instead.

If you can't determine what data to query or how to map the file, set action to "CLARIFY" and ask for more details.`;

    const parseMessages: ChatMessage[] = [{ role: "system", content: parsePrompt }];

    if (conversation_history && Array.isArray(conversation_history)) {
      for (const msg of conversation_history.slice(-10)) {
        parseMessages.push({
          role: msg.role === "agent" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }
    parseMessages.push({ role: "user", content: command });

    let parseData;
    try {
      parseData = await callClaude({
        messages: parseMessages,
        tools: [
          {
            type: "function",
            function: {
              name: "query_frappe",
              description: "Query Frappe data (any module), cross-check or import an uploaded file, answer a general knowledge question, or ask for clarification.",
              parameters: {
                type: "object",
                properties: {
                  action: { type: "string", enum: ["QUERY", "ANSWER", "CLARIFY", "CROSS_CHECK", "IMPORT_PLAN", "WRITE_PLAN"] },
                  doctype: { type: "string", description: "Frappe DocType to query/cross-check/import (any module)" },
                  filters: { type: "array", description: "Frappe filters array (QUERY only)" },
                  fields: { type: "array", items: { type: "string" }, description: "Fields to retrieve (QUERY only)" },
                  limit_page_length: { type: "number", description: "Number of records, 0 for all (QUERY only)" },
                  aggregate: { type: "string", enum: ["count", "sum", "list", "none"], description: "How to process results (QUERY only)" },
                  aggregate_field: { type: "string", description: "Field to sum, for aggregate=sum (QUERY only)" },
                  name: { type: "string", description: "Specific document name for single record lookup (QUERY only)" },
                  summary: { type: "string", description: "For ANSWER/CLARIFY: the text response" },
                  export_format: { type: "string", enum: ["csv", "xlsx", "none"], description: "Set when the user wants the result as a downloadable file" },
                  file_key_column: { type: "string", description: "Uniquely-identifying column/field name (CROSS_CHECK/IMPORT_PLAN)" },
                  match_field: { type: "string", description: "Frappe field matching file_key_column (CROSS_CHECK/IMPORT_PLAN)" },
                  field_mapping: { type: "object", description: "Source column -> Frappe field name map (CROSS_CHECK/IMPORT_PLAN)" },
                  inline_rows: { type: "array", items: { type: "object" }, description: "IMPORT_PLAN only, when records were pasted/typed in the chat instead of an uploaded file: one object per record, keyed by real Frappe field names" },
                  import_mode: { type: "string", enum: ["create", "update", "upsert"], description: "IMPORT_PLAN only" },
                  record_action: { type: "string", enum: ["create", "update"], description: "WRITE_PLAN only" },
                  lookup_field: { type: "string", description: "WRITE_PLAN update only: Frappe field used to find the record" },
                  lookup_value: { type: "string", description: "WRITE_PLAN update only: value to search lookup_field for" },
                  field_values: { type: "object", description: "WRITE_PLAN only: Frappe field -> new value to write" },
                },
                required: ["action"],
              },
            },
          },
        ],
        toolChoice: "auto",
      });
    } catch (e) {
      if (e instanceof ClaudeError) return json({ error: e.message }, e.status);
      throw e;
    }

    const plan = firstToolCallArgs(parseData);

    if (!plan) {
      const textContent = messageText(parseData);
      return json({
        success: true,
        action: "ANSWER",
        summary:
          textContent ||
          "I'm not sure how to answer that. Try asking about any of your Frappe data — employees, leave, sales, purchasing, stock, accounting, and more.",
      });
    }

    console.log("Query plan:", JSON.stringify(plan));

    if (plan.action === "ANSWER") {
      return json({ success: true, action: "ANSWER", summary: plan.summary });
    }

    if (plan.action === "CLARIFY") {
      return json({ success: true, action: "CLARIFY", summary: plan.summary, needs_input: true });
    }

    // ============ CROSS_CHECK: compare uploaded file against live Frappe data ============
    if (plan.action === "CROSS_CHECK") {
      if (!file) {
        return json({ success: true, action: "ANSWER", summary: "Attach a CSV or Excel file first, then ask me to cross-check it." });
      }
      const fileKeyColumn = plan.file_key_column;
      const matchField = plan.match_field;
      const fieldMapping: Record<string, string> = plan.field_mapping || {};
      if (!fileKeyColumn || !matchField) {
        return json({ success: true, action: "CLARIFY", summary: "Which column in your file uniquely identifies each record (e.g. employee ID or email)?", needs_input: true });
      }

      const compareFrappeFields = Object.values(fieldMapping).filter((f) => f && f !== matchField);
      const keyValues = file.rows.map((r) => String(r[fileKeyColumn] ?? "").trim()).filter(Boolean);

      const frappeRecords = await fetchRecordsByKeys(baseUrl, frappeAuthHeaders, plan.doctype, matchField, compareFrappeFields, keyValues);
      const byKey = new Map(frappeRecords.map((r) => [String(r[matchField] ?? "").trim(), r]));

      let matched = 0;
      const mismatched: Array<{ key: string; field: string; file_value: any; frappe_value: any }> = [];
      const missingInFrappe: string[] = [];

      for (const row of file.rows) {
        const key = String(row[fileKeyColumn] ?? "").trim();
        if (!key) continue;
        const frappeRow = byKey.get(key);
        if (!frappeRow) {
          missingInFrappe.push(key);
          continue;
        }
        matched++;
        for (const [fileCol, frappeField] of Object.entries(fieldMapping)) {
          if (!frappeField || frappeField === matchField) continue;
          const fileVal = String(row[fileCol] ?? "").trim();
          const frappeVal = String(frappeRow[frappeField] ?? "").trim();
          if (fileVal && fileVal !== frappeVal) {
            mismatched.push({ key, field: frappeField, file_value: row[fileCol], frappe_value: frappeRow[frappeField] });
          }
        }
      }

      const crossCheck = {
        doctype: plan.doctype,
        match_field: matchField,
        file_key_column: fileKeyColumn,
        matched,
        mismatched: mismatched.slice(0, 100),
        missing_in_frappe: missingInFrappe.slice(0, 200),
        missing_in_file_count: Math.max(0, frappeRecords.length - matched),
      };

      const summaryMessages: ChatMessage[] = [
        {
          role: "system",
          content: `You are the Frappe Copilot. Summarize a cross-check between an uploaded file and live Frappe data in 2-4 sentences, conversational. Mention counts of matched, mismatched fields, and records missing from Frappe. No emoji. No markdown tables or horizontal rules. No double spaces.`,
        },
        { role: "user", content: JSON.stringify(crossCheck).slice(0, 4000) },
      ];
      let summary = `Checked ${file.rows.length} rows against ${plan.doctype}: ${matched} matched, ${mismatched.length} field mismatch(es), ${missingInFrappe.length} not found in Frappe.`;
      try {
        const answerData = await callClaude({ messages: summaryMessages });
        summary = messageText(answerData) || summary;
      } catch {
        /* fall back to the plain summary above */
      }

      return json({ success: true, action: "CROSS_CHECK", doctype: plan.doctype, summary, crossCheck });
    }

    // ============ IMPORT_PLAN: preview creates/updates without writing anything ============
    if (plan.action === "IMPORT_PLAN") {
      // Rows can come from an uploaded file, or from records the AI extracted
      // directly out of pasted/typed chat text (inline_rows) — both paths
      // share every check and the same batched, single-confirmation preview
      // below, so a pasted list of 10 employees gets ONE combined write
      // confirmation instead of being handled one record at a time.
      const sourceRows: Record<string, any>[] | undefined =
        file?.rows ?? (Array.isArray(plan.inline_rows) && plan.inline_rows.length > 0 ? plan.inline_rows : undefined);
      const sourceName = file?.name || "the records you listed";

      if (!sourceRows || sourceRows.length === 0) {
        return json({ success: true, action: "ANSWER", summary: "Attach a CSV or Excel file, or list the records directly in your message, then tell me what to create or update." });
      }
      if (isRestrictedDoctype(plan.doctype)) {
        return json({ success: true, action: "ANSWER", summary: `I can't write to ${plan.doctype} — that controls site users, permissions, or configuration rather than business data. Please make that change directly in Frappe.` });
      }
      const fileKeyColumn = plan.file_key_column;
      const matchField = plan.match_field;
      const fieldMapping: Record<string, string> = plan.field_mapping || {};
      const importMode: "create" | "update" | "upsert" = plan.import_mode || "upsert";
      if (!fileKeyColumn || !matchField || Object.keys(fieldMapping).length === 0) {
        return json({ success: true, action: "CLARIFY", summary: "Which field uniquely identifies each record, and which Frappe fields should the other values map to?", needs_input: true });
      }

      const keyValues = sourceRows.map((r) => String(r[fileKeyColumn] ?? "").trim()).filter(Boolean);
      const existing = importMode === "create"
        ? []
        : await fetchRecordsByKeys(baseUrl, frappeAuthHeaders, plan.doctype, matchField, [], keyValues);
      const existingKeys = new Set(existing.map((r) => String(r[matchField] ?? "").trim()));

      let toCreate = 0;
      let toUpdate = 0;
      let skipped = 0;
      const sample: Array<{ action: "create" | "update"; key: string; mapped: Record<string, any> }> = [];

      for (const row of sourceRows) {
        const key = String(row[fileKeyColumn] ?? "").trim();
        if (!key) { skipped++; continue; }
        const exists = existingKeys.has(key);
        const rowAction: "create" | "update" | null =
          importMode === "create" ? (exists ? null : "create")
          : importMode === "update" ? (exists ? "update" : null)
          : (exists ? "update" : "create");

        if (!rowAction) { skipped++; continue; }
        if (rowAction === "create") toCreate++; else toUpdate++;

        if (sample.length < 10) {
          const mapped: Record<string, any> = {};
          for (const [fileCol, frappeField] of Object.entries(fieldMapping)) {
            if (frappeField) mapped[frappeField] = row[fileCol];
          }
          sample.push({ action: rowAction, key, mapped });
        }
      }

      const importPreview = {
        doctype: plan.doctype,
        field_mapping: fieldMapping,
        match_field: matchField,
        file_key_column: fileKeyColumn,
        to_create: toCreate,
        to_update: toUpdate,
        skipped,
        sample,
        file_name: sourceName,
        mode: importMode,
        // Always echoed back so the client can confirm the batch even when
        // there was no uploaded file to already have these rows locally.
        rows: sourceRows,
      };

      const summary = `Ready to import ${sourceName} into ${plan.doctype}: ${toCreate} new record${toCreate !== 1 ? "s" : ""} to create, ${toUpdate} to update${skipped ? `, ${skipped} skipped (no key)` : ""}. Nothing has been written yet, review the preview and confirm below.`;

      return json({ success: true, action: "IMPORT_PLAN", doctype: plan.doctype, summary, importPreview });
    }

    // ============ WRITE_PLAN: preview a single create/update, nothing saved yet ============
    if (plan.action === "WRITE_PLAN") {
      const recordAction: "create" | "update" = plan.record_action === "update" ? "update" : "create";
      const fieldValues: Record<string, any> = plan.field_values || {};

      if (!plan.doctype || Object.keys(fieldValues).length === 0) {
        return json({ success: true, action: "CLARIFY", summary: "What fields should I set, and on which record?", needs_input: true });
      }
      if (isRestrictedDoctype(plan.doctype)) {
        return json({ success: true, action: "ANSWER", summary: `I can't write to **${plan.doctype}** — that controls site users, permissions, or configuration rather than business data. Please make that change directly in Frappe.` });
      }
      if (String(fieldValues.docstatus) === "2") {
        return json({ success: true, action: "ANSWER", summary: "Cancelling or un-submitting records isn't supported by this assistant. Please cancel it directly in Frappe if that's what you need." });
      }

      if (recordAction === "create") {
        const summary = `Ready to create a new **${plan.doctype}**: ${Object.entries(fieldValues).map(([k, v]) => `${k} = ${v}`).join(", ")}. Nothing has been written yet — review and confirm below.`;
        return json({
          success: true,
          action: "WRITE_PLAN",
          doctype: plan.doctype,
          summary,
          writePreview: { doctype: plan.doctype, record_action: "create", field_values: fieldValues },
        });
      }

      // record_action === "update" — resolve exactly which existing record this refers to
      const lookupField = plan.lookup_field;
      const lookupValue = plan.lookup_value;
      if (!lookupField || !lookupValue) {
        return json({ success: true, action: "CLARIFY", summary: "Which record should I update — e.g. an employee name, ID, or email?", needs_input: true });
      }

      const displayFields = ["employee_name", "designation", "department", "status"].filter((f) => f !== lookupField);
      const candidates = await findMatchingRecords(baseUrl, frappeAuthHeaders, plan.doctype, lookupField, lookupValue, displayFields);

      if (candidates.length === 0) {
        return json({ success: true, action: "ANSWER", summary: `I couldn't find a **${plan.doctype}** record where ${lookupField} matches "${lookupValue}". Double-check the spelling, or give me the exact ID.` });
      }
      if (candidates.length > 1) {
        const options = candidates.map((c) => `- ${c.name}${c.employee_name ? ` (${c.employee_name})` : ""}`).join("\n");
        return json({ success: true, action: "CLARIFY", summary: `That matched more than one record — which one did you mean?\n${options}\n\nTell me the exact ID (the part before the parentheses).`, needs_input: true });
      }

      const match = candidates[0];
      const matchedLabel = match.employee_name ? `${match.employee_name} (${match.name})` : String(match.name);
      const summary = `Ready to update **${matchedLabel}**: ${Object.entries(fieldValues).map(([k, v]) => `${k} → ${v}`).join(", ")}. Nothing has been written yet — review and confirm below.`;

      return json({
        success: true,
        action: "WRITE_PLAN",
        doctype: plan.doctype,
        summary,
        writePreview: {
          doctype: plan.doctype,
          record_action: "update",
          docname: match.name,
          lookup_field: lookupField,
          lookup_value: lookupValue,
          matched_label: matchedLabel,
          field_values: fieldValues,
        },
      });
    }

    // ============ QUERY: Execute the Frappe HR API query ============
    let url: string;
    if (plan.name) {
      url = `${baseUrl}/api/resource/${plan.doctype}/${encodeURIComponent(plan.name)}`;
    } else {
      const params = new URLSearchParams();
      if (plan.filters && plan.filters.length > 0) params.set("filters", JSON.stringify(plan.filters));
      if (plan.fields && plan.fields.length > 0) params.set("fields", JSON.stringify(plan.fields));
      params.set("limit_page_length", String(plan.limit_page_length ?? 20));
      url = `${baseUrl}/api/resource/${plan.doctype}?${params.toString()}`;
    }

    console.log(`Frappe API: GET ${url}`);
    const frappeResponse = await fetch(url, {
      method: "GET",
      headers: { ...frappeAuthHeaders, "Content-Type": "application/json" },
    });

    const responseText = await frappeResponse.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    if (!frappeResponse.ok) {
      let errorMessage = "Failed to fetch data from Frappe.";
      if (responseData._server_messages) {
        try {
          const msgs = JSON.parse(responseData._server_messages);
          errorMessage = msgs
            .map((m: string) => {
              try {
                return JSON.parse(m).message;
              } catch {
                return m;
              }
            })
            .join("; ");
        } catch {
          /* ignore */
        }
      } else if (responseData.exception) {
        errorMessage = responseData.exception;
      }
      errorMessage = errorMessage.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
      if (errorMessage.includes("decrypt key") || errorMessage.includes("Encryption key is invalid")) {
        errorMessage = "Invalid API credentials.";
      }
      if (frappeResponse.status === 403 && usingSession) {
        errorMessage = "Your session has expired. Please reconnect in Settings.";
      }

      return json({ success: false, error: errorMessage, action: "QUERY", doctype: plan.doctype });
    }

    const rawData = responseData?.data;

    // ============ AI generates a human-readable answer ============
    const exportRequested = !!plan.export_format && plan.export_format !== "none";

    const answerMessages: ChatMessage[] = [
      {
        role: "system",
        content: `You are the Frappe Copilot. The user asked a question and we fetched data from their Frappe site.
Generate a clear, concise, human-readable answer based on the data below.

Rules:
- Be conversational and helpful
- Use simple markdown formatting for readability (bold, bullet lists) — no tables, no horizontal rules
- No emoji, anywhere, for any reason
- No double spaces
- For counts, state the number clearly
- For lists, format as a numbered or bulleted list with key details
- For totals/sums, calculate and present the result
- If no data was found, say so helpfully
- Include relevant details but don't dump raw JSON
- Keep currency values formatted nicely
- Keep it concise — no more than a few paragraphs
- Only describe the data shown to you below. Never comment on whether this app can create, update, change, or edit records, in either direction — that is completely outside what you're being asked here, an earlier step already decided how to handle the request, and this app can in fact create and update records. If the "Question" mentions wanting to change or set a value, just answer factually with what the data currently shows and stop there — do not add any disclaimer, suggestion, or instructions about updating it yourself.${
          exportRequested
            ? `
- The user explicitly asked for this as a downloadable ${plan.export_format?.toUpperCase()} file. The app is already generating and downloading that file automatically — you do not create it and must never say you can't generate or export files, because you're not being asked to and the app already does this. Your only job here is a short 1-2 sentence acknowledgment (e.g. "Here are all ${Array.isArray(rawData) ? rawData.length : ""} ${plan.doctype} records, downloaded as a ${plan.export_format?.toUpperCase()} file."). Do NOT list out individual records or their field values in this answer — the file already contains all of that, repeating it in the chat is redundant.`
            : ""
        }`,
      },
      {
        role: "user",
        content: `Question: "${command}"
DocType queried: ${plan.doctype}
Aggregate type: ${plan.aggregate || "list"}
${plan.aggregate_field ? `Aggregate field: ${plan.aggregate_field}` : ""}
Data returned (${Array.isArray(rawData) ? rawData.length + " records" : "single record"}):
${JSON.stringify(rawData, null, 2).slice(0, 4000)}`,
      },
    ];

    let humanAnswer: string;
    try {
      const answerData = await callClaude({ messages: answerMessages });
      humanAnswer = messageText(answerData) || "Here's what I found.";
    } catch {
      if (Array.isArray(rawData)) {
        humanAnswer = `Found **${rawData.length}** ${plan.doctype} record${rawData.length !== 1 ? "s" : ""}.`;
      } else {
        humanAnswer = `Here are the details for ${plan.doctype}: ${rawData?.name || ""}`;
      }
    }

    // The AI decides "aggregate" per request, and won't always fill it in.
    // Default the missing/unrecognized case to "none" (no table) rather than
    // "list" (shows a table) — an unwanted extra table is worse than a
    // plain-text-only answer. A single named-document lookup (plan.name was
    // set, so this fetched exactly one record by ID) is never a "list" no
    // matter what the model said, so that's forced regardless.
    const validAggregates = ["count", "sum", "list", "none"];
    const resolvedAggregate = plan.name
      ? "none"
      : validAggregates.includes(plan.aggregate)
      ? plan.aggregate
      : "none";

    return json({
      success: true,
      action: "QUERY",
      doctype: plan.doctype,
      summary: humanAnswer,
      data: rawData,
      aggregate: resolvedAggregate,
      exportFormat: plan.export_format && plan.export_format !== "none" ? plan.export_format : undefined,
    });
  } catch (e) {
    console.error("Agent error:", e);
    return json(
      {
        error:
          (e instanceof Error ? e.message : "Unknown error") +
          "\n\nTry rephrasing your question or check your connection settings.",
      },
      500
    );
  }
}
