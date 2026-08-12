import { corsHeaders, json } from "./_lib/cors";
import { callClaude, firstToolCallArgs, messageText, ClaudeError, type ChatMessage } from "./_lib/anthropic";

export const config = { runtime: "edge" };

interface UploadedFile {
  name: string;
  headers: string[];
  rows: Record<string, any>[];
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

    // ============ STEP 1: AI parses the question into a query plan ============
    const parsePrompt = `You are the Frappe HR Copilot — a Q&A and data-management assistant for Frappe HRMS (Human Resource Management).
Users ask questions about their HR / people data, and can attach a CSV/Excel file to cross-check against Frappe or to create/update records in bulk.

CURRENT DATE: ${today}
${fileContext}

ACTIONS you can choose:
- "QUERY": look up / list / count / sum data already in Frappe. No file needed.
- "ANSWER": answer a conceptual question, or something outside HR scope, directly in "summary". No data lookup.
- "CLARIFY": you need more detail before you can act. Ask in "summary".
- "CROSS_CHECK": only when a file is attached. Compare the uploaded file's rows against existing Frappe records to find mismatches or records missing from Frappe. Read-only — does not change any data.
- "IMPORT_PLAN": only when a file is attached AND the user is asking to create and/or update Frappe records from the file (e.g. "add these employees", "update salaries from this file", "import this"). This only PLANS the import (no writes happen yet) — a confirmation step happens after.
- "WRITE_PLAN": the user wants to create ONE new record, or update ONE existing record, directly from their message — no file involved (e.g. "add a new employee named Priya Sharma in Engineering", "set John's designation to Manager", "mark EMP-0004 as Left"). This only PLANS the write (nothing is saved yet) — a confirmation step happens after, same as IMPORT_PLAN.

COMMON QUERY PATTERNS (for QUERY):
- "how many" → aggregate: "count"
- "total/sum of" → aggregate: "sum", specify aggregate_field
- "list/show/what are" → aggregate: "list"
- "details of" → aggregate: "none" (single record lookup)

DOCTYPES (use exact names — Frappe HRMS only, this assistant does not handle Sales/Purchase/Stock/Accounting data):
- Employees → "Employee"
- Employee Onboarding → "Employee Onboarding"
- Employee Separation / exits → "Employee Separation"
- Employee Grievance → "Employee Grievance"
- Employee Referral → "Employee Referral"
- Leave Applications → "Leave Application"
- Leave Allocation / leave balances → "Leave Allocation"
- Leave Types → "Leave Type"
- Compensatory Leave Requests → "Compensatory Leave Request"
- Attendance → "Attendance"
- Attendance Requests → "Attendance Request"
- Shift Types → "Shift Type"
- Shift Assignments → "Shift Assignment"
- Holiday Lists → "Holiday List"
- Departments → "Department"
- Designations → "Designation"
- Branches → "Branch"
- Employee Grades → "Employee Grade"
- Salary Slips → "Salary Slip"
- Salary Structures → "Salary Structure"
- Salary Structure Assignments → "Salary Structure Assignment"
- Payroll Entries → "Payroll Entry"
- Additional Salary → "Additional Salary"
- Employee Advances → "Employee Advance"
- Expense Claims → "Expense Claim"
- Loans (employee loans) → "Loan"
- Appraisals / performance reviews → "Appraisal"
- Appraisal Cycles → "Appraisal Cycle"
- Goals / KRAs → "Goal"
- Training Events → "Training Event"
- Training Programs → "Training Program"
- Job Openings → "Job Opening"
- Job Applicants → "Job Applicant"
- Job Offers → "Job Offer"
- Interviews → "Interview"
- Travel Requests → "Travel Request"

FILTER FORMAT: Use Frappe filter syntax: [["field","operator","value"]]
Common operators: =, !=, >, <, >=, <=, like, between, in

DATE FILTERS: Use YYYY-MM-DD format. For "this month", use >= first day of current month. For "today", use = ${today}.

FIELDS: Request only relevant fields. Always include "name" field. For Employee queries, prefer fields like employee_name, department, designation, status, date_of_joining. For lists, pick 3-5 most useful fields.

LIMIT: Default to 20. Use 0 for count queries. Use higher limits for "all" queries.

EXPORT: If the user explicitly asks for the data as a downloadable file ("give me all employee data in excel", "export this as csv", "send me a spreadsheet of..."), set export_format to "csv" or "xlsx" (match whichever they asked for; default to "xlsx" if unspecified). Otherwise set export_format to "none".

FOR CROSS_CHECK AND IMPORT_PLAN (only when a file is attached):
- doctype: the Frappe HRMS doctype the file rows correspond to
- file_key_column: the column in the uploaded file that uniquely identifies each record (e.g. an employee ID, email, or name column)
- match_field: the Frappe field that corresponds to file_key_column (e.g. "employee", "name", "personal_email") — this is what's used to find the matching Frappe record
- field_mapping: an object mapping EVERY relevant uploaded file column name to the corresponding Frappe field name for that doctype
- import_mode (IMPORT_PLAN only): "create" if rows should only be created, "update" if only updated, "upsert" if it should create-or-update depending on whether a match is found (use "upsert" unless the user specifies otherwise)

FOR WRITE_PLAN (single record, no file):
- doctype: the Frappe HRMS doctype to write to
- record_action: "create" for a brand new record, "update" for changing an existing one
- lookup_field + lookup_value (update only): the Frappe field and value that identifies WHICH existing record to update (e.g. lookup_field "employee_name", lookup_value "Priya Sharma"). Prefer a human name/email over a raw ID unless the user gave an ID.
- field_values: an object of Frappe field name -> new value, containing every field the user wants set (for create: all the fields they described; for update: only the field(s) they want changed — never include lookup_field/lookup_value's own field here unless they're also changing it)
If the user's request is too vague to know which fields to set, use CLARIFY instead.

This site is connected as a Frappe HRMS instance. If the question is outside HR (e.g. about sales, purchasing, or accounting), politely say so in "summary" and set action to "ANSWER".
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
              name: "query_frappe_hr",
              description: "Query Frappe HRMS data, cross-check or import an uploaded file, answer an HR knowledge question, or ask for clarification.",
              parameters: {
                type: "object",
                properties: {
                  action: { type: "string", enum: ["QUERY", "ANSWER", "CLARIFY", "CROSS_CHECK", "IMPORT_PLAN", "WRITE_PLAN"] },
                  doctype: { type: "string", description: "Frappe HRMS DocType to query/cross-check/import" },
                  filters: { type: "array", description: "Frappe filters array (QUERY only)" },
                  fields: { type: "array", items: { type: "string" }, description: "Fields to retrieve (QUERY only)" },
                  limit_page_length: { type: "number", description: "Number of records, 0 for all (QUERY only)" },
                  aggregate: { type: "string", enum: ["count", "sum", "list", "none"], description: "How to process results (QUERY only)" },
                  aggregate_field: { type: "string", description: "Field to sum, for aggregate=sum (QUERY only)" },
                  name: { type: "string", description: "Specific document name for single record lookup (QUERY only)" },
                  summary: { type: "string", description: "For ANSWER/CLARIFY: the text response" },
                  export_format: { type: "string", enum: ["csv", "xlsx", "none"], description: "Set when the user wants the result as a downloadable file" },
                  file_key_column: { type: "string", description: "Uploaded file column used as the unique key (CROSS_CHECK/IMPORT_PLAN)" },
                  match_field: { type: "string", description: "Frappe field matching file_key_column (CROSS_CHECK/IMPORT_PLAN)" },
                  field_mapping: { type: "object", description: "File column -> Frappe field name map (CROSS_CHECK/IMPORT_PLAN)" },
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
          "I'm not sure how to answer that. Try asking about your employees, leave, attendance, payroll, or expense claims.",
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
          content: `You are the Frappe HR Copilot. Summarize a cross-check between an uploaded file and live Frappe data in 2-4 sentences, conversational, markdown ok. Mention counts of matched, mismatched fields, and records missing from Frappe.`,
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
      if (!file) {
        return json({ success: true, action: "ANSWER", summary: "Attach a CSV or Excel file first, then tell me what to import." });
      }
      const fileKeyColumn = plan.file_key_column;
      const matchField = plan.match_field;
      const fieldMapping: Record<string, string> = plan.field_mapping || {};
      const importMode: "create" | "update" | "upsert" = plan.import_mode || "upsert";
      if (!fileKeyColumn || !matchField || Object.keys(fieldMapping).length === 0) {
        return json({ success: true, action: "CLARIFY", summary: "Which file column uniquely identifies each record, and which Frappe fields should the other columns map to?", needs_input: true });
      }

      const keyValues = file.rows.map((r) => String(r[fileKeyColumn] ?? "").trim()).filter(Boolean);
      const existing = importMode === "create"
        ? []
        : await fetchRecordsByKeys(baseUrl, frappeAuthHeaders, plan.doctype, matchField, [], keyValues);
      const existingKeys = new Set(existing.map((r) => String(r[matchField] ?? "").trim()));

      let toCreate = 0;
      let toUpdate = 0;
      let skipped = 0;
      const sample: Array<{ action: "create" | "update"; key: string; mapped: Record<string, any> }> = [];

      for (const row of file.rows) {
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
        file_name: file.name,
        mode: importMode,
      };

      const summary = `Ready to import **${file.name}** into **${plan.doctype}**: ${toCreate} new record${toCreate !== 1 ? "s" : ""} to create, ${toUpdate} to update${skipped ? `, ${skipped} skipped (no key)` : ""}. Nothing has been written yet — review the preview and confirm below.`;

      return json({ success: true, action: "IMPORT_PLAN", doctype: plan.doctype, summary, importPreview });
    }

    // ============ WRITE_PLAN: preview a single create/update, nothing saved yet ============
    if (plan.action === "WRITE_PLAN") {
      const recordAction: "create" | "update" = plan.record_action === "update" ? "update" : "create";
      const fieldValues: Record<string, any> = plan.field_values || {};

      if (!plan.doctype || Object.keys(fieldValues).length === 0) {
        return json({ success: true, action: "CLARIFY", summary: "What fields should I set, and on which record?", needs_input: true });
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
        errorMessage = "⚠️ Invalid API credentials.";
      }
      if (frappeResponse.status === 403 && usingSession) {
        errorMessage = "⚠️ Your session has expired. Please reconnect in Settings.";
      }

      return json({ success: false, error: errorMessage, action: "QUERY", doctype: plan.doctype });
    }

    const rawData = responseData?.data;

    // ============ AI generates a human-readable answer ============
    const answerMessages: ChatMessage[] = [
      {
        role: "system",
        content: `You are the Frappe HR Copilot. The user asked a question and we fetched data from their Frappe HRMS site.
Generate a clear, concise, human-readable answer based on the data.

Rules:
- Be conversational and helpful
- Use markdown formatting for readability
- For counts, state the number clearly
- For lists, format as a numbered or bulleted list with key details
- For totals/sums, calculate and present the result
- If no data was found, say so helpfully
- Include relevant details but don't dump raw JSON
- Keep currency values formatted nicely
- Keep it concise — no more than a few paragraphs`,
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

    return json({
      success: true,
      action: "QUERY",
      doctype: plan.doctype,
      summary: humanAnswer,
      data: rawData,
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
