// 챗봇 핵심 로직 — 로컬 server.js 와 Vercel api/chat.js 가 공유.
// 1) RAG: 질문 임베딩 → Supabase 유사도 검색(top5) → 관련 청크만 주입
// 2) 폴백: Supabase 미설정/검색 실패 시 uploads/*.md 전체 주입
// 3) 대화 로그: chat_logs 에 best-effort 기록 (실패해도 응답엔 영향 없음)
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { retrieveContext } = require('./rag');
const { getSupabase } = require('./supabase');

const MODEL = 'gpt-5.4-mini';
const CHATBOT_NAME = '큐봇';
const MAX_HISTORY = 10; // 최근 10개 메시지(5턴) 유지

// uploads 폴더의 모든 .md 문서를 읽어 합친다(폴백용). 프로세스당 1회 캐시.
let cachedDocs = null;
function loadKnowledgeBase() {
  if (cachedDocs !== null) return cachedDocs;
  const dir = path.join(__dirname, '..', 'public', 'uploads');
  let combined = '';
  try {
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      combined += `\n\n===== 문서: ${file} =====\n${content}`;
    }
  } catch (err) {
    console.error('지식 베이스 로드 실패:', err.message);
  }
  cachedDocs = combined.trim();
  return cachedDocs;
}

function buildSystemPrompt(knowledgeText) {
  return [
    `당신은 디자인 대행사 "디자인큐(DesignQ)"의 공식 상담 챗봇 "${CHATBOT_NAME}"입니다.`,
    `브랜드 톤앤매너: 쉽고 명확하게, 단정적이지만 따뜻하게, 과장 없이 솔직하게. 디자인 비전문가도 편하게 이해할 수 있는 친근한 말투를 사용하세요.`,
    ``,
    `[답변 규칙]`,
    `1. 자기소개·인사·대화형 질문("이름이 뭐야", "넌 누구야" 등): 챗봇 이름(${CHATBOT_NAME})과 역할(디자인큐 상담 도우미)을 자연스럽게 소개하며 답하세요.`,
    `2. 서비스·정책·가격·절차 등 회사 관련 질문: 아래 [지식 베이스] 내용만 근거로 답하세요. 없으면 절대 지어내지 말고, "정확한 안내를 위해 무료 상담을 도와드릴게요. 상담을 신청해 주시면 담당자가 자세히 안내해 드립니다." 라고 무료 상담을 안내하세요.`,
    `3. 디자인큐 서비스와 무관한 질문(날씨, 일반 상식, 잡담 등): "저는 디자인큐 서비스 관련 질문만 도와드릴 수 있어요 🙂" 라고 정중히 안내하세요.`,
    `4. 문서에 없는 회사 정보는 어떤 경우에도 창작하지 마세요.`,
    `5. 답변은 간결하게, 2~4문장 이내로 핵심만 전달하세요.`,
    ``,
    `[지식 베이스]`,
    knowledgeText || '(주입된 문서가 없습니다. 모든 서비스 질문은 무료 상담으로 안내하세요.)',
  ].join('\n');
}

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
}

// chat_logs 기록 — best-effort. 실패해도 throw 하지 않는다.
async function logChat(question, answer) {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from('chat_logs').insert({ question, answer });
  } catch (e) {
    console.error('chat_logs 기록 실패(무시):', e.message);
  }
}

async function handleChat(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('서버에 OPENAI_API_KEY 가 설정되지 않았습니다.'), {
      statusCode: 500,
    });
  }

  const history = sanitizeHistory(body && body.messages);
  if (history.length === 0) {
    throw Object.assign(new Error('메시지가 비어 있습니다.'), { statusCode: 400 });
  }

  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const query = lastUser ? lastUser.content : '';

  // 1) RAG 시도 → 2) 실패 시 전체 문서 폴백
  let knowledge = query ? await retrieveContext(query, apiKey) : null;
  if (!knowledge) knowledge = loadKnowledgeBase();

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: buildSystemPrompt(knowledge) }, ...history],
  });

  const reply =
    (completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
      ? completion.choices[0].message.content
      : ''
    ).trim() || '죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요.';

  // 3) 대화 로그 (best-effort)
  await logChat(query, reply);

  return { reply };
}

module.exports = { handleChat, CHATBOT_NAME };
