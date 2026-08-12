import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, XCircle, Unplug } from "lucide-react";
import type { Connection, SystemType, AuthMethod } from "@/hooks/useConnection";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  connection: Connection | null;
  onConnect: (conn: Connection) => void;
  onDisconnect: () => void;
}

const SettingsModal = ({ open, onClose, connection, onConnect, onDisconnect }: SettingsModalProps) => {
  const [authMethod, setAuthMethod] = useState<AuthMethod>(connection?.authMethod ?? "session");
  const [siteUrl, setSiteUrl] = useState(connection?.siteUrl ?? "");
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? "");
  const [apiSecret, setApiSecret] = useState(connection?.apiSecret ?? "");
  const [email, setEmail] = useState(connection?.email ?? "");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [hrmsDetected, setHrmsDetected] = useState<boolean | null>(null);

  const canSubmit =
    !!siteUrl && (authMethod === "apikey" ? !!apiKey && !!apiSecret : !!email && !!password);

  const resetStatus = () => {
    setStatus("idle");
    setErrorMsg("");
    setHrmsDetected(null);
  };

  const handleTest = async () => {
    if (!canSubmit) return;
    setTesting(true);
    resetStatus();

    try {
      const body: Record<string, string> =
        authMethod === "apikey"
          ? { site_url: siteUrl.replace(/\/$/, ""), api_key: apiKey, api_secret: apiSecret }
          : { site_url: siteUrl.replace(/\/$/, ""), email, password };

      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok && !data) throw new Error("Connection failed");

      if (data?.success) {
        setStatus("success");
        setHrmsDetected(!!data.hrms_detected);

        const conn: Connection =
          authMethod === "apikey"
            ? {
                siteUrl: siteUrl.replace(/\/$/, ""),
                authMethod: "apikey",
                apiKey,
                apiSecret,
                systemType: (data.system_type as SystemType) || "hrms",
                installedApps: data.installed_apps || [],
              }
            : {
                siteUrl: siteUrl.replace(/\/$/, ""),
                authMethod: "session",
                email,
                sid: data.sid,
                systemType: (data.system_type as SystemType) || "hrms",
                installedApps: data.installed_apps || [],
              };

        onConnect(conn);
        setPassword(""); // never keep raw password around longer than needed
      } else {
        setStatus("error");
        setErrorMsg(data?.error || "Connection failed");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = () => {
    onDisconnect();
    resetStatus();
    setSiteUrl("");
    setApiKey("");
    setApiSecret("");
    setEmail("");
    setPassword("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connection Settings</DialogTitle>
          <DialogDescription>Connect to your Frappe HR site.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="site-url">Site URL</Label>
            <Input
              id="site-url"
              placeholder="https://mysite.frappe.cloud"
              value={siteUrl}
              onChange={(e) => { setSiteUrl(e.target.value); resetStatus(); }}
            />
          </div>

          <Tabs
            value={authMethod}
            onValueChange={(v) => { setAuthMethod(v as AuthMethod); resetStatus(); }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="session">Email &amp; Password</TabsTrigger>
              <TabsTrigger value="apikey">API Key</TabsTrigger>
            </TabsList>

            <TabsContent value="session" className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); resetStatus(); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="your Frappe login password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); resetStatus(); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Logs in like the Frappe desk login screen. Your password is sent once to
                start a session and is never stored — only the session token is kept.
              </p>
            </TabsContent>

            <TabsContent value="apikey" className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  placeholder="your-api-key"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); resetStatus(); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-secret">API Secret</Label>
                <Input
                  id="api-secret"
                  type="password"
                  placeholder="your-api-secret"
                  value={apiSecret}
                  onChange={(e) => { setApiSecret(e.target.value); resetStatus(); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Frappe Desk → your user → API Access → Generate Keys.
              </p>
            </TabsContent>
          </Tabs>

          {status === "success" && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Connected successfully
              </div>
              {hrmsDetected === false && (
                <p className="text-xs text-muted-foreground">
                  ⚠️ Frappe HRMS wasn't detected on this site — HR queries may not return data.
                </p>
              )}
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" /> {errorMsg}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleTest} disabled={testing || !canSubmit} className="flex-1">
              {testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</> : "Test & Connect"}
            </Button>
            {connection && (
              <Button variant="destructive" size="icon" onClick={handleDisconnect} title="Disconnect">
                <Unplug className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;
