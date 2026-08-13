// Server-side write safety guards. These are enforced here — not just
// described in the AI's prompt — so a bad plan (whether from a model
// mistake or a crafted prompt) can never actually reach Frappe.
//
// Scope: create + update are allowed everywhere the user's own Frappe
// permissions allow. Two things are hard-blocked regardless of what the
// AI plans:
//   1. Cancelling a document (docstatus -> 2, or Frappe's dedicated cancel
//      action) — this app never cancels or deletes anything.
//   2. Writing to framework/security doctypes (users, roles, permissions,
//      scripts, site config, etc.) — these control the site itself, not
//      business data, and were never meant to be edited by a Q&A assistant.

export const RESTRICTED_WRITE_DOCTYPES = new Set([
  // Users & access control
  "User", "Role", "Has Role", "Role Profile", "User Permission",
  "Role Permission for Page and Report", "DocPerm", "Custom DocPerm",
  "Module Profile", "Session Default", "Session Default Settings",
  // Schema / customization (can alter how the whole site behaves)
  "DocType", "DocField", "Custom Field", "Property Setter", "DocType Link",
  "DocType Action", "DocType State",
  // Code execution / automation
  "Server Script", "Client Script", "Scheduled Job Type", "Webhook",
  "Automation Rule",
  // Integrations & credentials
  "OAuth Client", "OAuth Provider Settings", "OAuth Bearer Token",
  "Integration Request", "Social Login Key", "Connected App",
  "Email Account", "SMTP Server", "LDAP Settings", "Google Settings",
  // Site configuration
  "System Settings", "Workflow", "Workflow State", "Workflow Action Master",
  "Print Format", "Report", "Page", "Workspace", "Module Def", "Domain",
]);

export function isRestrictedDoctype(doctype: string | undefined | null): boolean {
  if (!doctype) return false;
  return RESTRICTED_WRITE_DOCTYPES.has(doctype);
}

// Frappe represents a cancelled document as docstatus = 2. Blocking that
// value (in addition to there being no delete/cancel action anywhere in
// this app's API surface) is the actual enforcement point — the prompt
// telling the model not to do this is a second layer, not the only one.
export function isCancelAttempt(fieldValues: Record<string, any> | null | undefined): boolean {
  if (!fieldValues) return false;
  return String(fieldValues.docstatus) === "2";
}

export function restrictedDoctypeError(doctype: string): string {
  return `Writing to "${doctype}" isn't allowed — this assistant only manages business data, not site users, permissions, or configuration. Please make that change directly in Frappe.`;
}

export const CANCEL_ATTEMPT_ERROR =
  "Cancelling or un-submitting records isn't supported by this assistant. Please cancel it directly in Frappe if that's what you need.";
