export interface Task {
  id: number;
  title: string;
  notes: string | null;
  person: string | null;
  priority: "low" | "normal" | "high";
  status: "pending" | "open" | "done" | "cancelled";
  source: string;
  due_at: string | null;
  remind_at: string | null;
  created_at: string;
  done_at: string | null;
}

export interface Note {
  id: number;
  title: string | null;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Summary {
  counts: { open: number; today: number; overdue: number; pending: number; doneWeek: number; notes: number };
  today: Task[];
  overdue: Task[];
  pending: Task[];
  recentNotes: Note[];
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SystemInfo {
  bot: string | null;
  webhook: { pending: number; lastError: string | null; lastErrorAt: string | null } | null;
  modelFast: string;
  modelSmart: string;
  fallbackModel: string;
  puterConnected: boolean;
  timezone: string;
}

export interface GoogleStatus {
  configured: boolean;
  email: string | null;
  connectedAt: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("auth:logout"));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Gagal (${res.status})`);
  return data as T;
}

/** Tugas baru / perubahan tugas. Waktu dalam format input lokal "YYYY-MM-DDTHH:mm". */
export interface TaskInput {
  title?: string;
  notes?: string;
  person?: string;
  priority?: Task["priority"];
  status?: Task["status"];
  due?: string;
  remind?: string;
}
