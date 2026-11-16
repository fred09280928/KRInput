// KRInput memo + weight API
// GET  /api/memos  -> { memos: { "ㅂ": { memo, updated, weight }, … } }
// POST /api/memo   -> { jamo, memo }        upsert memo
// POST /api/review -> { jamo, result }      result = 'correct' | 'wrong'，回新 weight
// GET  /api/health -> { ok: true }
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
      const { results } = await env.DB.prepare(
        `SELECT m.jamo, m.memo, m.updated,
                COALESCE(s.weight, ${WEIGHT_START}) AS weight
           FROM memos m
           LEFT JOIN stats s ON s.jamo = m.jamo`
      ).all();
      const memos = {};
      for (const row of results || []) {
        memos[row.jamo] = {
          memo: row.memo,
          updated: row.updated,
          weight: row.weight,
        };
      }
      return json({ memos, count: Object.keys(memos).length }, 200, request);
    }

    if (url.pathname === '/api/memo' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400, request);
      }
      const jamo = (body.jamo || '').trim();
      const memo = typeof body.memo === 'string' ? body.memo.trim() : '';
      if (!jamo) return json({ error: 'jamo required' }, 400, request);
      if (jamo.length > 4) return json({ error: 'jamo too long' }, 400, request);
      if (memo.length > 300) return json({ error: 'memo too long (max 300)' }, 400, request);

      const ts = nowTaipei();
      await env.DB.prepare(
        `INSERT INTO memos (jamo, memo, updated) VALUES (?, ?, ?)
         ON CONFLICT(jamo) DO UPDATE SET memo = excluded.memo, updated = excluded.updated`
      ).bind(jamo, memo, ts).run();

      return json({ ok: true, jamo, memo, updated: ts }, 200, request);
    }

    // 答題結果 → 調整 weight（與 ESFlash 同一套規則）
    if (url.pathname === '/api/review' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400, request);
      }
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
        'INSERT OR IGNORE INTO stats (jamo, weight, correct, wrong) VALUES (?, ?, 0, 0)'
      ).bind(jamo, WEIGHT_START).run();

      await env.DB.prepare(
        `UPDATE stats
            SET weight  = MAX(${WEIGHT_MIN}, MIN(${WEIGHT_MAX}, weight + ?)),
                correct = correct + ?,
                wrong   = wrong + ?,
                last    = ?
          WHERE jamo = ?`
      ).bind(
        delta,
        result === 'correct' ? 1 : 0,
        result === 'wrong' ? 1 : 0,
        ts,
        jamo
      ).run();

      const row = await env.DB.prepare(
        'SELECT jamo, weight, correct, wrong FROM stats WHERE jamo = ?'
      ).bind(jamo).first();

      return json({
        ok: true,
        jamo,
        result,
        weight: row ? row.weight : WEIGHT_START,
        correct: row ? row.correct : 0,
        wrong: row ? row.wrong : 0,
        updated: ts,
      }, 200, request);
    }

    return json({ error: 'not found' }, 404, request);
  },
};
