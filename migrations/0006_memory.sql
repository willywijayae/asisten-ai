-- Memori jangka panjang: fakta yang diambil otomatis dari obrolan (ala mem0, ADD-only).
-- Vektornya disimpan di Vectorize (id "m:<id>"); catatan juga diindeks di sana (id "n:<id>").
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  entities TEXT,              -- nama orang/brand/tempat, huruf kecil, dipisah ", "
  source TEXT NOT NULL,       -- chat | voice | photo | forward | web | claude | manual
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX memories_created ON memories (created_at);
