#!/usr/bin/env python3
"""Generate mnemonics for the 505-syllable drill, easy (2-key) set only.

Reads ../KRChars505.txt, keeps rows whose Dubeolsik combo is 2 letters,
asks DeepSeek for a one-line Traditional-Chinese memory hook, caches it, and
optionally writes SQL that upserts into D1 `syl_memos` for owner fred0928.

Usage:
  python3 tools/gen_syl_memo.py --dry-run --limit 1     # one batch of 20
  python3 tools/gen_syl_memo.py --dry-run               # all batches
  python3 tools/gen_syl_memo.py --write                 # write worker/syl_memos_seed.sql
Then:
  cd worker && npx --yes wrangler@latest d1 execute krmemo --remote --file=syl_memos_seed.sql
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "KRChars505.txt"
CACHE = ROOT / "worker" / "syl_memo_cache.json"
OUT_SQL = ROOT / "worker" / "syl_memos_seed.sql"
OWNER = "fred0928"
EASY_KEYS = 2
BATCH = 20

API = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

PROMPT = """You write very short memory hooks for Korean Dubeolsik typing practice.

For each item you get: the syllable, the key sequence on a QWERTY keyboard (uppercase means Shift), and the romanization.

Rules:
- Say how the key sequence builds the syllable: initial + vowel (+ final).
- Add one tiny hook so it sticks: a sound-alike, an English word, or a very common Korean word using it.
- Traditional Chinese. At most 40 characters, ONE line, no markdown, no emoji, no quotes.
- Shape: "<keys> = <initial>+<vowel>(+<final>) <hook>"
- Example: "dms = ㅇ+ㅡ+ㄴ eun，像『恩』"

Return ONLY a JSON array, no prose:
[{"i": 1, "memo": "..."}]

Items:
"""


def api_key() -> str:
    key = os.popen("source ~/.zshrc 2>/dev/null && echo $DEEPSEEK_API_KEY").read().strip()
    if not key:
        raise SystemExit("DEEPSEEK_API_KEY not found in ~/.zshrc")
    return key


def read_rows():
    rows = []
    for line in DATA.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        no, syl, combo, roma = parts[0].strip(), parts[1].strip(), parts[2].strip(), parts[3].strip()
        if not (syl and combo and roma):
            continue
        rows.append({"no": no, "syl": syl, "combo": combo, "roma": roma})
    return rows


def call(batch, key, tries=3):
    items = "\n".join(
        f'{i}. syllable {c["syl"]} | keys {c["combo"]} | romanization {c["roma"]}'
        for i, c in enumerate(batch, 1)
    )
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": PROMPT + items}],
        "temperature": 0.4,
        "max_tokens": 1800,
    }).encode()
    for t in range(tries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            resp = json.loads(urllib.request.urlopen(req, timeout=120).read())
            text = resp["choices"][0]["message"]["content"]
            m = re.search(r"\[.*\]", text, re.S)
            if not m:
                raise ValueError("no JSON array in reply")
            got = {}
            for d in json.loads(m.group(0)):
                idx = int(d.get("i", 0))
                memo = (d.get("memo") or "").strip().strip('"').replace("\n", " ")
                if 1 <= idx <= len(batch) and memo:
                    got[batch[idx - 1]["syl"]] = memo
            if got:
                return got
        except Exception as e:  # noqa: BLE001
            print(f"  retry {t + 1}: {e}", flush=True)
            time.sleep(3 * (t + 1))
    return {}


def load_cache():
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only this many batches")
    ap.add_argument("--write", action="store_true", help="write worker/syl_memos_seed.sql")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = read_rows()
    easy = [r for r in rows if len(r["combo"]) == EASY_KEYS]
    print(f"total {len(rows)} | easy {len(easy)} (combo length {EASY_KEYS})")

    cache = load_cache()
    todo = [r for r in easy if r["syl"] not in cache]
    print(f"cached {len(cache)} | to generate {len(todo)}")

    if todo and not args.dry_run:
        key = api_key()
        batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
        if args.limit:
            batches = batches[:args.limit]
        for n, b in enumerate(batches, 1):
            print(f"batch {n}/{len(batches)} ({len(b)} items)…", flush=True)
            got = call(b, key)
            cache.update(got)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  got {len(got)}/{len(b)}", flush=True)
            time.sleep(1.0)

    missing = [r["syl"] for r in easy if r["syl"] not in cache]
    print(f"memos ready {len(cache)}/{len(easy)} | missing {len(missing)}")
    for r in easy[:5]:
        print(f"  {r['syl']} ({r['combo']}, {r['roma']}): {cache.get(r['syl'], '—')}")

    if args.write:
        lines = ["-- 505 音節 drill：easy（2 鍵）音節的記憶法，owner = fred0928",
                 "-- 由 tools/gen_syl_memo.py 產生；重跑會覆蓋同一個音節的 memo",
                 "DELETE FROM syl_memos WHERE owner = 'fred0928' AND syl IN (" +
                 ",".join("'" + r["syl"].replace("'", "''") + "'" for r in easy if r["syl"] in cache) + ");"]
        for r in easy:
            memo = cache.get(r["syl"])
            if not memo:
                continue
            memo_sql = memo.replace("'", "''")
            lines.append(
                f"INSERT OR REPLACE INTO syl_memos (owner, syl, memo, updated) "
                f"VALUES ('{OWNER}', '{r['syl'].replace(chr(39), chr(39) * 2)}', '{memo_sql}', '2026-11-17 00:00:00');"
            )
        OUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {OUT_SQL} ({len(lines) - 2} memos)")


if __name__ == "__main__":
    main()
