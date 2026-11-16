CREATE TABLE IF NOT EXISTS memos_v2 (
  owner   TEXT NOT NULL DEFAULT 'fred0928',
  jamo    TEXT NOT NULL,
  memo    TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner, jamo)
);

CREATE TABLE IF NOT EXISTS stats_v2 (
  owner   TEXT NOT NULL DEFAULT 'fred0928',
  jamo    TEXT NOT NULL,
  weight  INTEGER NOT NULL DEFAULT 12,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong   INTEGER NOT NULL DEFAULT 0,
  last    TEXT,
  PRIMARY KEY (owner, jamo)
);

INSERT OR IGNORE INTO memos_v2 (owner, jamo, memo, updated)
  SELECT 'fred0928', jamo, memo, updated FROM memos;

INSERT OR IGNORE INTO stats_v2 (owner, jamo, weight, correct, wrong, last)
  SELECT 'fred0928', jamo, weight, correct, wrong, last FROM stats;
