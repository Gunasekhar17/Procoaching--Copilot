import * as XLSX from "xlsx";
import type { UploadedFileData } from "@/hooks/useChatStore";

// Cap how many rows we'll ever hold in memory / send to the API in one go.
// Keeps request payloads well under Vercel's edge function body limit and
// keeps the AI's field-mapping step fast.
export const MAX_UPLOAD_ROWS = 2000;

export class FileTooLargeError extends Error {}

/** Parse an uploaded .csv/.xlsx/.xls file into headers + row objects. */
export async function parseSpreadsheetFile(file: File): Promise<UploadedFileData> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  // defval keeps sparse rows aligned to all columns instead of dropping keys
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

  if (rows.length > MAX_UPLOAD_ROWS) {
    throw new FileTooLargeError(
      `That file has ${rows.length.toLocaleString()} rows — please split it into files of ${MAX_UPLOAD_ROWS.toLocaleString()} rows or fewer.`
    );
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { name: file.name, headers, rows };
}

function toWorksheetData(data: any[]): any[] {
  // Strip Frappe's internal/meta fields so exports look like clean HR data
  const omit = new Set(["doctype", "owner", "_user_tags", "_comments", "_assign", "_liked_by", "idx", "lft", "rgt", "old_parent"]);
  return data.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (omit.has(k) || k.startsWith("_")) continue;
        clean[k] = v;
      }
      return clean;
    }
    return row;
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAsCSV(data: any[], filenameBase: string) {
  const clean = toWorksheetData(Array.isArray(data) ? data : [data]);
  const sheet = XLSX.utils.json_to_sheet(clean);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filenameBase}.csv`);
}

export function downloadAsExcel(data: any[], filenameBase: string) {
  const clean = toWorksheetData(Array.isArray(data) ? data : [data]);
  const sheet = XLSX.utils.json_to_sheet(clean);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Data");
  const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([arrayBuffer], { type: "application/octet-stream" }),
    `${filenameBase}.xlsx`
  );
}
