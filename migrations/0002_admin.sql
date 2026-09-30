-- Website admin: kode login via Telegram & sesi browser (disimpan sebagai hash).
CREATE TABLE login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Catatan second brain: judul opsional & waktu diubah.
ALTER TABLE notes ADD COLUMN title TEXT;
ALTER TABLE notes ADD COLUMN updated_at TEXT;
