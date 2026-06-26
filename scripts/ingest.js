// uploads/*.md 를 청크·임베딩해 documents 테이블에 적재한다.
// 실행: node scripts/ingest.js   (.env 의 OPENAI_API_KEY, SUPABASE_* 필요)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { getSupabase } = require('../lib/supabase');
const { EMBED_MODEL } = require('../lib/rag');

const UPLOADS = path.join(__dirname, '..', 'public', 'uploads');
const CHUNK_SIZE = 800; // 문자 기준
const CHUNK_OVERLAP = 150;

// 문단 경계를 최대한 보존하며 청크로 분할
function chunkText(text) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    // 단어/문단 중간이 잘리지 않게 가까운 줄바꿈에서 끊기
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end);
      if (nl > start + CHUNK_SIZE * 0.5) end = nl;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}

async function main() {
  const supabase = getSupabase();
  if (!supabase) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env 에 없습니다.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY 가 .env 에 없습니다.');
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 기존 documents 비우고 새로 적재 (재실행 시 중복 방지)
  console.log('기존 documents 삭제 중...');
  await supabase.from('documents').delete().neq('id', 0);

  const files = fs.readdirSync(UPLOADS).filter((f) => f.toLowerCase().endsWith('.md'));
  let total = 0;

  for (const file of files) {
    const text = fs.readFileSync(path.join(UPLOADS, file), 'utf-8');
    const chunks = chunkText(text);
    console.log(`📄 ${file} → ${chunks.length} 청크`);

    for (const content of chunks) {
      const emb = await client.embeddings.create({ model: EMBED_MODEL, input: content });
      const embedding = emb.data[0].embedding;
      const { error } = await supabase.from('documents').insert({ source: file, content, embedding });
      if (error) {
        console.error(`  ⚠️ 적재 실패: ${error.message}`);
      } else {
        total++;
      }
    }
  }

  console.log(`✅ 완료: ${total} 청크 적재됨`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
