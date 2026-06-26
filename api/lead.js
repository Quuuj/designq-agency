// Vercel 서버리스 함수: POST /api/lead
// 상담 신청을 leads 테이블에 저장한다. service_role 키는 서버에서만 사용.
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = body ? JSON.parse(body) : {};
    body = body || {};

    const industry = (body.industry || '').toString().slice(0, 200);
    const contact = (body.contact || '').toString().slice(0, 200);
    const message = (body.message || '').toString().slice(0, 4000);

    if (!contact && !message) {
      res.status(400).json({ error: '연락처 또는 문의 내용을 입력해 주세요.' });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      res.status(503).json({ error: '상담 접수 저장소가 아직 설정되지 않았어요.' });
      return;
    }

    const { error } = await supabase.from('leads').insert({ industry, contact, message });
    if (error) throw new Error(error.message);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('/api/lead 오류:', err.message);
    res.status(500).json({ error: '상담 신청 저장 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' });
  }
};
