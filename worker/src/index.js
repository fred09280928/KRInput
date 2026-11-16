// KRInput memo + weight API
// 多使用者：每一列都帶 owner（預設 'fred0928'）。owner 可用 ?owner= 或 body.owner 指定。
// GET  /api/memos?owner=fred0928  -> { owner, memos: { "ㅂ": { memo, updated, weight }, … } }
// POST /api/memo   -> { owner?, jamo, memo }        upsert memo
// POST /api/review -> { owner?, jamo, result }      result = 'correct' | 'wrong'，回新 weight
// GET  /api/health -> { ok: true }
//
// 505 音節頁（KRKBQuiz）：key 是音節（예: 한），不是字母，所以另用一組表
// GET  /api/syl?owner=fred0928    -> { owner, items: { "한": { memo, weight, correct, wrong } }, count }
// POST /api/syl/memo   -> { owner?, syl, memo }
// POST /api/syl/review -> { owner?, syl, result }
//
// 權重規則與 ESFlash 相同：答錯 +3、答對 −1，夾在 1–15，新項目 12。

const ALLOWED_ORIGINS = [
  'https://fred09280928.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const WEIGHT_MIN = 1;
const WEIGHT_MAX = 15;
const WEIGHT_START = 12;
const WEIGHT_WRONG = 3;
const WEIGHT_CORRECT = -1;
const DEFAULT_OWNER = 'fred0928';

// owner 只是分類標籤，不是認證；限制長度與字元，避免亂塞
function normOwner(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return DEFAULT_OWNER;
  return /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : DEFAULT_OWNER;
}

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, req) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
  });
}

// 台北時間 'YYYY-MM-DD HH:MM:SS'（不要用 SQL 的 date('now')，那是 UTC）
function nowTaipei() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  return parts.replace(',', '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, ts: nowTaipei() }, 200, request);
    }

    if (url.pathname === '/api/memos' && request.method === 'GET') {
      const owner = normOwner(url.searchParams.get('owner'));
      const { results } = await env.DB.prepare(
        `SELECT m.jamo, m.memo, m.updated,
                COALESCE(s.weight, ${WEIGHT_START}) AS weight
           FROM memos m
           LEFT JOIN stats s ON s.jamo = m.jamo AND s.owner = m.owner
          WHERE m.owner = ?`
      ).bind(owner).all();
      const memos = {};
      for (const row of results || []) {
        memos[row.jamo] = {
          memo: row.memo,
          updated: row.updated,
          weight: row.weight,
        };
      }
      return json({ owner, memos, count: Object.keys(memos).length }, 200, request);
    }

    if (url.pathname === '/api/memo' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400, request);
      }
      const owner = normOwner(body.owner);
      const jamo = (body.jamo || '').trim();
      const memo = typeof body.memo === 'string' ? body.memo.trim() : '';
      if (!jamo) return json({ error: 'jamo required' }, 400, request);
      if (jamo.length > 4) return json({ error: 'jamo too long' }, 400, request);
      if (memo.length > 300) return json({ error: 'memo too long (max 300)' }, 400, request);

      const ts = nowTaipei();
      await env.DB.prepare(
        `INSERT INTO memos (owner, jamo, memo, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, jamo) DO UPDATE SET memo = excluded.memo, updated = excluded.updated`
      ).bind(owner, jamo, memo, ts).run();

      return json({ ok: true, owner, jamo, memo, updated: ts }, 200, request);
    }

    // 答題結果 → 調整 weight（與 ESFlash 同一套規則）
    if (url.pathname === '/api/review' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400, request);
      }
      const owner = normOwner(body.owner);
      const jamo = (body.jamo || '').trim();
      const result = body.result;
      if (!jamo) return json({ error: 'jamo required' }, 400, request);
      if (result !== 'correct' && result !== 'wrong') {
        return json({ error: "result must be 'correct' or 'wrong'" }, 400, request);
      }

      const ts = nowTaipei();
      const delta = result === 'wrong' ? WEIGHT_WRONG : WEIGHT_CORRECT;

      // D1 沒有交易：先確保有這一列，再更新（兩句各自 idempotent）
      await env.DB.prepare(
        'INSERT OR IGNORE INTO stats (owner, jamo, weight, correct, wrong) VALUES (?, ?, ?, 0, 0)'
      ).bind(owner, jamo, WEIGHT_START).run();

      await env.DB.prepare(
        `UPDATE stats
            SET weight  = MAX(${WEIGHT_MIN}, MIN(${WEIGHT_MAX}, weight + ?)),
                correct = correct + ?,
                wrong   = wrong + ?,
                last    = ?
          WHERE owner = ? AND jamo = ?`
      ).bind(
        delta,
        result === 'correct' ? 1 : 0,
        result === 'wrong' ? 1 : 0,
        ts,
        owner,
        jamo
      ).run();

      const row = await env.DB.prepare(
        'SELECT jamo, weight, correct, wrong FROM stats WHERE owner = ? AND jamo = ?'
      ).bind(owner, jamo).first();

      return json({
        ok: true,
        owner,
        jamo,
        result,
        weight: row ? row.weight : WEIGHT_START,
        correct: row ? row.correct : 0,
        wrong: row ? row.wrong : 0,
        updated: ts,
      }, 200, request);
    }

    // ── 505 音節（KRKBQuiz）──────────────────────────────────────────
    if (url.pathname === '/api/syl' && request.method === 'GET') {
      const owner = normOwner(url.searchParams.get('owner'));
      const items = {};

      const st = await env.DB.prepare(
        'SELECT syl, weight, correct, wrong, last FROM syl_stats WHERE owner = ?'
      ).bind(owner).all();
      for (const r of st.results || []) {
        items[r.syl] = { memo: '', updated: '', weight: r.weight, correct: r.correct, wrong: r.wrong, last: r.last };
      }

      const me = await env.DB.prepare(
        'SELECT syl, memo, updated FROM syl_memos WHERE owner = ?'
      ).bind(owner).all();
      for (const r of me.results || []) {
        const cur = items[r.syl] || { weight: WEIGHT_START, correct: 0, wrong: 0, last: '' };
        items[r.syl] = { ...cur, memo: r.memo, updated: r.updated };
      }

      return json({ owner, items, count: Object.keys(items).length }, 200, request);
    }

    if (url.pathname === '/api/syl/memo' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400, request); }
      const owner = normOwner(body.owner);
      const syl = (body.syl || '').trim();
      const memo = typeof body.memo === 'string' ? body.memo.trim() : '';
      if (!syl) return json({ error: 'syl required' }, 400, request);
      if (syl.length > 4) return json({ error: 'syl too long' }, 400, request);
      if (memo.length > 300) return json({ error: 'memo too long (max 300)' }, 400, request);

      const ts = nowTaipei();
      await env.DB.prepare(
        `INSERT INTO syl_memos (owner, syl, memo, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, syl) DO UPDATE SET memo = excluded.memo, updated = excluded.updated`
      ).bind(owner, syl, memo, ts).run();
      return json({ ok: true, owner, syl, memo, updated: ts }, 200, request);
    }

    if (url.pathname === '/api/syl/review' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400, request); }
      const owner = normOwner(body.owner);
      const syl = (body.syl || '').trim();
      const result = body.result;
      if (!syl) return json({ error: 'syl required' }, 400, request);
      if (result !== 'correct' && result !== 'wrong') {
        return json({ error: "result must be 'correct' or 'wrong'" }, 400, request);
      }

      const ts = nowTaipei();
      const delta = result === 'wrong' ? WEIGHT_WRONG : WEIGHT_CORRECT;

      await env.DB.prepare(
        'INSERT OR IGNORE INTO syl_stats (owner, syl, weight, correct, wrong) VALUES (?, ?, ?, 0, 0)'
      ).bind(owner, syl, WEIGHT_START).run();

      await env.DB.prepare(
        `UPDATE syl_stats
            SET weight  = MAX(${WEIGHT_MIN}, MIN(${WEIGHT_MAX}, weight + ?)),
                correct = correct + ?,
                wrong   = wrong + ?,
                last    = ?
          WHERE owner = ? AND syl = ?`
      ).bind(delta, result === 'correct' ? 1 : 0, result === 'wrong' ? 1 : 0, ts, owner, syl).run();

      const row = await env.DB.prepare(
        'SELECT weight, correct, wrong FROM syl_stats WHERE owner = ? AND syl = ?'
      ).bind(owner, syl).first();

      return json({
        ok: true, owner, syl, result,
        weight: row ? row.weight : WEIGHT_START,
        correct: row ? row.correct : 0,
        wrong: row ? row.wrong : 0,
        updated: ts,
      }, 200, request);
    }

    return json({ error: 'not found' }, 404, request);
  },
};
