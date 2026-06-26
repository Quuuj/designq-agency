// Supabase 클라이언트 (서버 전용).
// service_role 키는 절대 클라이언트에 노출하지 않으며, 서버에서만 사용한다.
const { createClient } = require('@supabase/supabase-js');

let cached;

// 환경변수가 없으면 null 을 반환한다 → 호출부에서 폴백 처리.
function getSupabase() {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

module.exports = { getSupabase };
