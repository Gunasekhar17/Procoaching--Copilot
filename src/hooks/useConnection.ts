import { useState, useEffect, useCallback } from "react";

export type SystemType = "hrms" | "erpnext" | "full" | null;
export type AuthMethod = "apikey" | "session";

export interface Connection {
  siteUrl: string;
  authMethod: AuthMethod;
  // apikey auth
  apiKey?: string;
  apiSecret?: string;
  // session auth (email + password login)
  email?: string;
  sid?: string;
  systemType?: SystemType;
  installedApps?: string[];
}

const STORAGE_KEY = "frappe-connection";

export function useConnection() {
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setConnection(JSON.parse(saved));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connect = useCallback((conn: Connection) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
    setConnection(conn);
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setConnection(null);
  }, []);

  const siteName = connection
    ? connection.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  const systemType = connection?.systemType ?? null;

  return { connection, siteName, connect, disconnect, isConnected: !!connection, systemType };
}
