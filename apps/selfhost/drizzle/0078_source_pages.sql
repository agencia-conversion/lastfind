-- One shared store of the public pages Lastfind reads, for every project: the pages AI answers cite (read when the project's
-- own brand stays unclear after its questions and its tie-breaker) and the pages the agent reads (`read_page`), so a page
-- already read is neither fetched nor paid for again until it expires. Keyed by the digest of the normalized address. The
-- content (title, language, text by block and links, bounded) is kept here for internal analysis only and never published
-- as is. A page read lives 30 days by default (a server setting, up to 90); one that could not be read (robots.txt,
-- noindex, too large, not a web page, failed) 7 days. A robots.txt is kept the same way, under its origin.
CREATE TABLE IF NOT EXISTS source_pages (
  url_key TEXT PRIMARY KEY,
  url TEXT NOT NULL CHECK(length(url)<=2000),
  final_url TEXT CHECK(final_url IS NULL OR length(final_url)<=2000),
  title TEXT CHECK(title IS NULL OR length(title)<=300),
  language TEXT CHECK(language IS NULL OR length(language)<=8),
  status TEXT NOT NULL CHECK(status IN ('ok','robots','noindex','too_large','not_html','failed')),
  -- fetch: read by Lastfind itself (text and links); agent: the text the agent's page reader returned (no links).
  origin TEXT NOT NULL DEFAULT 'fetch' CHECK(origin IN ('fetch','agent')),
  bytes INTEGER CHECK(bytes IS NULL OR bytes>=0),
  content_sha256 TEXT,
  content_json TEXT CHECK(content_json IS NULL OR length(content_json)<=400000),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_source_pages_expires ON source_pages(expires_at);
-- Each time a stored page served a reading instead of a new fetch or a paid read: by whom and for which project.
CREATE TABLE IF NOT EXISTS source_page_uses (
  url_key TEXT NOT NULL,
  used_at TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('mentions','agent')),
  project_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_page_uses_page ON source_page_uses(url_key,used_at);
