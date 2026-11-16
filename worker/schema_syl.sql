-- 505 音節頁（KRKBQuiz）的 memo 與 weight
-- key 是音節（예: 한），不是字母，所以與 memos / stats 分開
-- 套用同一套 weight 規則：起始 12、答錯 +3、答對 −1、夾 1–15

CREATE TABLE IF NOT EXISTS syl_memos (
  owner   TEXT NOT NULL DEFAULT 'fred0928',
  syl     TEXT NOT NULL,
  memo    TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner, syl)
);

CREATE TABLE IF NOT EXISTS syl_stats (
  owner   TEXT    NOT NULL DEFAULT 'fred0928',
  syl     TEXT    NOT NULL,
  weight  INTEGER NOT NULL DEFAULT 12,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong   INTEGER NOT NULL DEFAULT 0,
  last    TEXT,
  PRIMARY KEY (owner, syl)
);

CREATE INDEX IF NOT EXISTS idx_syl_stats_owner ON syl_stats(owner);
CREATE INDEX IF NOT EXISTS idx_syl_memos_owner ON syl_memos(owner);
