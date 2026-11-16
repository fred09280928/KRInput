-- KRInput memo store (D1 `krmemo`)
-- 一筆 = 一個韓文字母（子音／母音）的記憶法

CREATE TABLE IF NOT EXISTS memos (
  jamo    TEXT PRIMARY KEY,          -- ㅂ ㅈ ㄷ …（單一字母，不用英文字母當 key）
  memo    TEXT NOT NULL DEFAULT '',  -- 記憶法文字，可含換行
  updated TEXT NOT NULL DEFAULT ''   -- 'YYYY-MM-DD HH:MM:SS'（台北時間）
);

-- 出題權重（與 ESFlash 同一套：答錯 +3、答對 -1，夾 1-15，新項目 12）
CREATE TABLE IF NOT EXISTS stats (
  jamo    TEXT PRIMARY KEY,           -- ㅂ ㅈ ㄷ …
  weight  INTEGER NOT NULL DEFAULT 12,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong   INTEGER NOT NULL DEFAULT 0,
  last    TEXT
);
