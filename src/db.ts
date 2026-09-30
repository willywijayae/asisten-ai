import { formatLocal } from "./time";

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
  reminded: number;
  created_at: string;
  done_at: string | null;
}

export type NewTask = Pick<Task, "title"> &
  Partial<Pick<Task, "notes" | "person" | "priority" | "status" | "source" | "due_at" | "remind_at">>;

export async function addTask(db: D1Database, t: NewTask): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO tasks (title, notes, person, priority, status, source, due_at, remind_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      t.title,
      t.notes ?? null,
      t.person ?? null,
      t.priority ?? "normal",
      t.status ?? "open",
      t.source ?? "chat",
      t.due_at ?? null,
      t.remind_at ?? null,
    )
    .first<{ id: number }>();
  return row!.id;
}

export async function getTask(db: D1Database, id: number): Promise<Task | null> {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<Task>();
}

const UPDATABLE = ["title", "notes", "person", "priority", "status", "due_at", "remind_at"] as const;

export async function updateTask(
  db: D1Database,
  id: number,
  patch: Partial<Pick<Task, (typeof UPDATABLE)[number]>>,
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of UPDATABLE) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(patch[k]);
    }
  }
  // Jadwal berubah → pengingat boleh bunyi lagi.
  if (patch.due_at !== undefined || patch.remind_at !== undefined) sets.push("reminded = 0");
  if (patch.status === "done") sets.push("done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  if (!sets.length) return false;
  const res = await db
    .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals, id)
    .run();
  return res.meta.changes > 0;
}

export interface TaskFilter {
  statuses?: Task["status"][];
  dueFrom?: string;
  dueTo?: string;
  overdueBefore?: string;
  doneFrom?: string;
  limit?: number;
}

export async function listTasks(db: D1Database, f: TaskFilter = {}): Promise<Task[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (f.statuses?.length) {
    where.push(`status IN (${f.statuses.map(() => "?").join(",")})`);
    vals.push(...f.statuses);
  }
  if (f.dueFrom) (where.push("due_at >= ?"), vals.push(f.dueFrom));
  if (f.dueTo) (where.push("due_at < ?"), vals.push(f.dueTo));
  if (f.overdueBefore) (where.push("due_at IS NOT NULL AND due_at < ?"), vals.push(f.overdueBefore));
  if (f.doneFrom) (where.push("done_at >= ?"), vals.push(f.doneFrom));
  const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY due_at IS NULL, due_at, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id
    LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...vals, f.limit ?? 50).all<Task>();
  return results;
}

/** Tugas yang pengingatnya sudah waktunya. Tanpa remind_at, default 60 menit sebelum due. */
export async function dueReminders(db: D1Database, now: Date): Promise<Task[]> {
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + 60 * 60_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT * FROM tasks WHERE status = 'open' AND reminded = 0 AND (
         (remind_at IS NOT NULL AND remind_at <= ?) OR
         (remind_at IS NULL AND due_at IS NOT NULL AND due_at <= ?)
       ) ORDER BY due_at LIMIT 20`,
    )
    .bind(nowIso, soonIso)
    .all<Task>();
  return results;
}

export async function markReminded(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE tasks SET reminded = 1 WHERE id = ?").bind(id).run();
}

export function formatTask(t: Task, tz: string): string {
  const flags = [t.status !== "open" ? t.status : "", t.priority === "high" ? "‼️penting" : ""]
    .filter(Boolean)
    .join(" ");
  const parts = [`#${t.id} ${t.title}`];
  if (flags) parts.push(`[${flags}]`);
  if (t.due_at) parts.push(`— due ${formatLocal(t.due_at, tz)}`);
  if (t.remind_at) parts.push(`(ingatkan ${formatLocal(t.remind_at, tz)})`);
  if (t.person) parts.push(`👤 ${t.person}`);
  if (t.notes) parts.push(`📝 ${t.notes}`);
  return parts.join(" ");
}

// --- Notes (second brain) ---

export async function addNote(db: D1Database, content: string, tags?: string | null): Promise<number> {
  const row = await db
    .prepare("INSERT INTO notes (content, tags) VALUES (?, ?) RETURNING id")
    .bind(content, tags ?? null)
    .first<{ id: number }>();
  return row!.id;
}

export async function searchNotes(
  db: D1Database,
  query: string,
  limit = 15,
): Promise<{ id: number; content: string; tags: string | null; created_at: string }[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
  if (!words.length) {
    const { results } = await db
      .prepare("SELECT * FROM notes ORDER BY id DESC LIMIT ?")
      .bind(limit)
      .all<{ id: number; content: string; tags: string | null; created_at: string }>();
    return results;
  }
  // Cocok kalau salah satu kata ada; urutkan berdasarkan jumlah kata yang cocok.
  const score = words.map(() => "(instr(lower(content || ' ' || coalesce(tags, '')), ?) > 0)").join(" + ");
  const { results } = await db
    .prepare(`SELECT *, (${score}) AS score FROM notes WHERE (${score}) > 0 ORDER BY score DESC, id DESC LIMIT ?`)
    .bind(...words, ...words, limit)
    .all<{ id: number; content: string; tags: string | null; created_at: string }>();
  return results;
}

// --- Riwayat obrolan ---

export async function getHistory(db: D1Database, limit = 16): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { results } = await db
    .prepare("SELECT role, content FROM history ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<{ role: "user" | "assistant"; content: string }>();
  return results.reverse();
}

export async function appendHistory(db: D1Database, role: "user" | "assistant", content: string): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO history (role, content) VALUES (?, ?)").bind(role, content),
    // Simpan secukupnya.
    db.prepare("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 200)"),
  ]);
}

export async function clearHistory(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM history").run();
}

/** true kalau update ini baru pertama kali diproses. */
export async function claimUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const res = await db.prepare("INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)").bind(updateId).run();
  return res.meta.changes > 0;
}
