// Vercel 서버리스 함수: POST /api/chat
// 환경변수 OPENAI_API_KEY 는 Vercel 대시보드에서 주입한다. (키 커밋 금지)
const { handleChat } = require('../lib/chat');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  try {
    // Vercel 은 req.body 를 자동 파싱하지만, 안전하게 둘 다 처리한다.
    let body = req.body;
    if (typeof body === 'string') {
      body = body ? JSON.parse(body) : {};
    }
    const result = await handleChat(body || {});
    res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('/api/chat 오류:', err.message);
    // TODO: 진단용 — 원인 확인 후 제거 예정
    res.status(status).json({ error: '답변 생성 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.', debug: String(err && err.message) });
  }
};
