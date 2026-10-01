-- Konten baru tim marketing yang meniru pola iklan kompetitor pemenang ("Bikin 5 konten mirip").
CREATE TABLE competitor_remixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | error
  specialist TEXT,                         -- konten | copywriter
  data TEXT,                               -- JSON {summary, ideas:[...]}
  note_id INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at TEXT
);
CREATE INDEX competitor_remixes_ad ON competitor_remixes (ad_id, id);
