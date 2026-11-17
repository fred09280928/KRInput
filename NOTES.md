# KRInput · 筆記（memo 與難度）

兩個練習頁：`KRKBBasic.html`（26 個字母）、`KRKBQuiz.html`（505 個音節）。
memo 與 weight 都存在 Cloudflare D1 `krmemo`（Worker：`https://krmemo.fred0928.workers.dev`）。

## memo 是什麼

不是字典義，是「怎麼記住這個輸入」的鉤子：

```
zl = ㅋ+ㅣ ki，像『奇』        ← 音節頁（KRKBQuiz）
q: ㅂ boutique                 ← 字母頁（KRKBBasic，KRMemo.txt 的格式）
```

- 一個單位一條、單行、≤40 字；音節頁格式 `<keys> = <初聲>+<母音> <羅馬字>，<掛鉤>`
- 同一張卡只顯示自己的 memo；`?owner=xxx` 切換身分（預設 `fred0928`，owner 只是標籤不是密碼）

## 存在哪

| 頁面 | 表 | key |
|---|---|---|
| KRKBBasic（26 字母） | `memos` / `stats` | `jamo` |
| KRKBQuiz（505 音節） | `syl_memos` / `syl_stats` | `syl` |

兩張表都是 `PRIMARY KEY (owner, <key>)`，`owner TEXT NOT NULL DEFAULT 'fred0928'`。
內容（memo）與行為統計（weight、correct、wrong）分開放。

API：
```
GET  /api/memos?owner=           字母頁用
GET  /api/syl?owner=             音節頁用（回 items: { 音節: {memo, weight, ...} }）
POST /api/memo  {owner,jamo,memo}
POST /api/syl/memo {owner,syl,memo}
POST /api/review / /api/syl/review  {result: correct|wrong}
```

## weight（全站同一套）

起始 12、答錯 +3、答對 −1、夾 1–15；出題用 weight 當輪盤，上一題權重設 0 避免連出。

## 難度（KRKBQuiz）

- `🎯 Easy (115)` 預設勾選 → 只抽 **2 鍵**音節（이·도·수…）
- 取消勾選 → 全部 505（2 鍵 115、3 鍵 376、4 鍵 14）
- 勾選狀態記在 `localStorage['kr_easy']`

## 重生成 easy 的 memo

```bash
cd ~/Documents/myCode/KRInput
python3 tools/gen_syl_memo.py            # 只補還沒有的（快取：worker/syl_memo_cache.json）
python3 tools/gen_syl_memo.py --write    # 產 worker/syl_memos_seed.sql
cd worker && npx --yes wrangler@latest d1 execute krmemo --remote --file=syl_memos_seed.sql
```

- 模型 `deepseek-chat`，一次 20 筆，115 筆約 1 分鐘
- `syl_memos_seed.sql` 開頭有一行 `DELETE … WHERE owner='fred0928' AND syl IN (<easy 清單>)`，
  重跑會蓋掉這些音節的 memo（手改過的也會被蓋，改之前先備份）
- 要做 3 鍵／4 鍵：把 `tools/gen_syl_memo.py` 的 `EASY_KEYS` 篩選改掉即可

## 資料檔

`KRChars505.txt`：`# 韓文  두벌식組合  羅馬字`，Tab 分隔，505 列。
**大寫字母代表 Shift**（싸=`Tk`、쁜=`Qms`），頁面比對不分大小寫——否則 85 個雙子音音節打不出來。
