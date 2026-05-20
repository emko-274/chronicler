import type { ActivityLog } from './api';

// ── Column definitions ─────────────────────────────────────────────────────────

export interface ExportColumn {
  key: string;
  label: string;
  getValue: (log: ActivityLog) => string | number | null;
  defaultOn: boolean;
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'activity_type',    label: 'Activity Type',   defaultOn: true,  getValue: l => l.activity_type },
  { key: 'date',             label: 'Date',             defaultOn: true,  getValue: l => localDate(l.started_at) },
  { key: 'start_time',       label: 'Start Time',       defaultOn: true,  getValue: l => localTime(l.started_at) },
  { key: 'end_time',         label: 'End Time',         defaultOn: true,  getValue: l => l.ended_at ? localTime(l.ended_at) : null },
  { key: 'duration_minutes', label: 'Duration (min)',   defaultOn: true,  getValue: l => l.duration_minutes ?? null },
  { key: 'quantity',         label: 'Quantity',         defaultOn: true,  getValue: l => (typeof l.extra_data?.quantity === 'number' ? l.extra_data.quantity as number : null) },
  { key: 'unit',             label: 'Unit',             defaultOn: true,  getValue: l => (typeof l.extra_data?.unit === 'string' ? l.extra_data.unit as string : null) },
  { key: 'tags',             label: 'Tags',             defaultOn: true,  getValue: l => { const t = l.extra_data?.tags; return Array.isArray(t) && t.length ? (t as string[]).join(', ') : null; } },
  { key: 'notes',            label: 'Notes',            defaultOn: true,  getValue: l => l.notes ?? null },
  { key: 'start_date',       label: 'Start Date',       defaultOn: false, getValue: l => localDate(l.started_at) },
  { key: 'end_date',         label: 'End Date',         defaultOn: false, getValue: l => l.ended_at ? localDate(l.ended_at) : null },
  { key: 'started_at',       label: 'Start (ISO)',      defaultOn: false, getValue: l => l.started_at },
  { key: 'ended_at',         label: 'End (ISO)',        defaultOn: false, getValue: l => l.ended_at ?? null },
];

export const DEFAULT_COLUMNS = new Set(EXPORT_COLUMNS.filter(c => c.defaultOn).map(c => c.key));

// ── CSV ────────────────────────────────────────────────────────────────────────

function escapeCSV(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCSV(logs: ActivityLog[], columns: ExportColumn[]): string {
  const header = columns.map(c => c.label).join(',');
  const rows = logs.map(log => columns.map(col => escapeCSV(col.getValue(log))).join(','));
  return [header, ...rows].join('\n');
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── XLSX ───────────────────────────────────────────────────────────────────────

export async function downloadXLSX(
  logs: ActivityLog[],
  columns: ExportColumn[],
  filename: string,
): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = logs.map(log => {
    const row: Record<string, string | number | null> = {};
    columns.forEach(col => { row[col.label] = col.getValue(log); });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Activity Logs');
  XLSX.writeFile(wb, filename);
}
