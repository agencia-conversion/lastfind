-- One free read of a brand's home page: whether the site answered, where it led and the names it gives itself
-- (title, og:site_name). It confirms that a suggested domain exists and is the brand's, and lets the brand's name as a `.com`
-- stand as a domain to confirm. Public facts about a site, shared by every account like the favicon copy in the bucket;
-- nothing in a row says who asked. Written by domain discovery (never by reading a report), read again after 30 days.
CREATE TABLE IF NOT EXISTS site_checks (
  host TEXT PRIMARY KEY,
  reachable INTEGER NOT NULL CHECK(reachable IN (0,1)),
  final_host TEXT,
  title TEXT,
  site_name TEXT,
  checked_at TEXT NOT NULL
);
