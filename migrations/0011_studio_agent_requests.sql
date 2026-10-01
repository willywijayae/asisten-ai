-- Antrean "Buat dengan Claude" dari tombol Studio Konten; diambil tugas terjadwal Claude desktop di laptop pemilik.
CREATE TABLE studio_agent_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  provider TEXT NOT NULL,                 -- grok | chatgpt
  status TEXT NOT NULL DEFAULT 'pending', -- pending | claimed | done | failed | cancelled
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  claimed_at TEXT,
  finished_at TEXT
);
CREATE INDEX studio_agent_requests_status ON studio_agent_requests (status, id);
