// RAG: 질문을 임베딩 → Supabase pgvector 유사도 검색(top 5) → 관련 청크 반환.
// Supabase 미설정/검색 실패/결과 없음 → null 반환(호출부에서 전체 문서 폴백).
const OpenAI = require('openai');
const { getSupabase } = require('./supabase');

const EMBED_MODEL = 'text-embedding-3-small';
const MATCH_COUNT = 5;

async function embed(text, apiKey) {
  const client = new OpenAI({ apiKey });
  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return res.data[0].embedding;
}

// 성공 시 관련 청크들을 합친 문자열, 실패/없음 시 null.
async function retrieveContext(query, apiKey) {
  const supabase = getSupabase();
  if (!supabase) return null; // Supabase 미설정 → 폴백
  try {
    const queryEmbedding = await embed(query, apiKey);
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
    });
    if (error) {
      console.error('match_documents 오류, 폴백:', error.message);
      return null;
    }
    if (!data || data.length === 0) return null;
    return data
      .map((d) => `===== ${d.source || '문서'} =====\n${d.content}`)
      .join('\n\n');
  } catch (e) {
    console.error('RAG 검색 실패, 폴백:', e.message);
    return null;
  }
}

module.exports = { embed, retrieveContext, EMBED_MODEL, MATCH_COUNT };
