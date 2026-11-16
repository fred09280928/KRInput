-- KRInput memo store (D1 `krmemo`)
-- 一筆 = 一個韓文字母（子音／母音）的記憶法

CREATE TABLE IF NOT EXISTS memos (
  jamo    TEXT PRIMARY KEY,          -- ㅂ ㅈ ㄷ …（單一字母，不用英文字母當 key）
  memo    TEXT NOT NULL DEFAULT '',  -- 記憶法文字，可含換行
  updated TEXT NOT NULL DEFAULT ''   -- 'YYYY-MM-DD HH:MM:SS'（台北時間）
);
