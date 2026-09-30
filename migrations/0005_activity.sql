-- Jejak kerja tiap "karyawan" AI, untuk Kantor 3D di website admin.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,          -- haiku | opus | gemma | whisper | pengingat | briefing | claude
  kind TEXT NOT NULL,           -- start | step | done | error
  summary TEXT NOT NULL,
  spot TEXT,                    -- tempat yang didatangi di kantor: board | cabinet | mail | profile
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_created ON activity (created_at);
CREATE INDEX activity_agent ON activity (agent, id);
