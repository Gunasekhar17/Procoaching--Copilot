import { corsHeaders, json } from "./_lib/cors";

export const config = { runtime: "edge" };

type SystemType = "hrms" | "erpnext" | "full";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { site_url, api_key, api_secret, email, password } = await req.json();
    const usingSession = !!(email && password);

    if (!site_url || (!usingSession && (!api_key || !api_secret))) {
      return json({ success: false, error: "Missing credentials" }, 400);
    }

    let authHeaders: Record<string, string>;
    let sid: string | null = null;

    if (usingSession) {
      // Email + password → log in and get a session cookie (sid)
      const loginResp = await fetch(`${site_url}/api/method/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ usr: email, pwd: password }).toString(),
      });

      const loginText = await loginResp.text();

      if (!loginResp.ok) {
        let msg = `Login failed (${loginResp.status})`;
        try {
          const parsed = JSON.parse(loginText);
          if (parsed.message) msg = parsed.message;
        } catch {
          /* ignore */
        }
        return json({ success: false, error: msg });
      }

      const setCookie = loginResp.headers.get("set-cookie") || "";
      const sidMatch = setCookie.match(/sid=([^;]+)/);
      sid = sidMatch ? sidMatch[1] : null;

      if (!sid || sid === "Guest") {
        return json({ success: false, error: "Invalid email or password." });
      }

      authHeaders = { Cookie: `sid=${sid}` };
    } else {
      authHeaders = { Authorization: `token ${api_key}:${api_secret}` };
    }

    // 1. Verify auth
    const authResp = await fetch(`${site_url}/api/method/frappe.auth.get_logged_user`, {
      headers: authHeaders,
    });

    if (!authResp.ok) {
      await authResp.text();
      return json({ success: false, error: `Authentication failed (${authResp.status})` });
    }

    const authData = await authResp.json();
    const user = authData.message;

    // 2. Detect installed apps
    let installedApps: string[] = [];
    let systemType: SystemType = "erpnext";

    try {
      const appsResp = await fetch(`${site_url}/api/method/frappe.client.get_list`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          doctype: "Installed Application",
          fields: ["app_name"],
          limit_page_length: 100,
        }),
      });

      if (appsResp.ok) {
        const appsData = await appsResp.json();
        installedApps = (appsData.message || []).map((a: any) => a.app_name?.toLowerCase() || "");
      } else {
        await appsResp.text();
        // Fallback: try Module Def to detect
        const modResp = await fetch(
          `${site_url}/api/resource/Module Def?fields=["name"]&limit_page_length=200`,
          { headers: authHeaders }
        );
        if (modResp.ok) {
          const modData = await modResp.json();
          const modules = (modData.data || []).map((m: any) => m.name?.toLowerCase() || "");
          if (modules.some((m: string) => m.includes("hr") || m.includes("payroll"))) {
            installedApps.push("hrms");
          }
          if (modules.some((m: string) => m.includes("selling") || m.includes("buying") || m.includes("stock"))) {
            installedApps.push("erpnext");
          }
        } else {
          await modResp.text();
        }
      }
    } catch {
      // If detection fails, default to erpnext
    }

    const hasHrms = installedApps.some((a) => a === "hrms" || a === "erpnext_hrms" || a.includes("hrms"));

    // This build is HR-only — we don't branch behavior on ERPNext/full detection,
    // but we still warn the caller if HRMS doesn't look installed on the site.
    systemType = "hrms";

    return json({
      success: true,
      user,
      system_type: systemType,
      hrms_detected: hasHrms,
      installed_apps: installedApps,
      sid: usingSession ? sid : undefined,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
