-- Koneksi Google (satu akun pemilik). Token disimpan terenkripsi (AES-GCM).
CREATE TABLE google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at TEXT,
  scopes TEXT,
  folder_id TEXT,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- State OAuth sekali pakai (anti-CSRF pada callback).
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
