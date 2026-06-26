// 챗봇 핵심 로직 — 로컬 server.js 와 Vercel api/chat.js 가 공유.
// uploads/*.md 문서를 읽어 시스템 프롬프트에 주입하고 OpenAI 를 호출한다.
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const MODEL = 'gpt-5.4-mini';
const CHATBOT_NAME = '큐봇';
const MAX_HISTORY = 10; // 최근 10개 메시지(5턴) 유지

// uploads 폴더의 모든 .md 문서를 읽어 하나의 문자열로 합친다.
// 서버 프로세스 동안 한 번만 읽고 캐시한다.
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

function buildSystemPrompt() {
  const docs = loadKnowledgeBase();
  return [
    `당신은 디자인 대행사 "디자인큐(DesignQ)"의 공식 상담 챗봇 "${CHATBOT_NAME}"입니다.`,
    `브랜드 톤앤매너: 쉽고 명확하게, 단정적이지만 따뜻하게, 과장 없이 솔직하게. 디자인 비전문가도 편하게 이해할 수 있는 친근한 말투를 사용하세요.`,
    ``,
    `[답변 규칙]`,
    `1. 자기소개·인사·대화형 질문("이름이 뭐야", "넌 누구야" 등): 챗봇 이름(${CHATBOT_NAME})과 역할(디자인큐 상담 도우미)을 자연스럽게 소개하며 답하세요.`,
    `2. 서비스·정책·가격·절차 등 회사 관련 질문: 아래 [지식 베이스] 문서에 있는 내용만 근거로 답하세요. 문서에 없는 정보는 절대 지어내지 말고, "정확한 안내를 위해 무료 상담을 도와드릴게요. 상담을 신청해 주시면 담당자가 자세히 안내해 드립니다." 라고 무료 상담을 안내하세요.`,
    `3. 디자인큐 서비스와 무관한 질문(날씨, 일반 상식, 잡담 등): "저는 디자인큐 서비스 관련 질문만 도와드릴 수 있어요 🙂" 라고 정중히 안내하세요.`,
    `4. 문서에 없는 회사 정보는 어떤 경우에도 창작하지 마세요.`,
    `5. 답변은 간결하게, 2~4문장 이내로 핵심만 전달하세요.`,
    ``,
    `[지식 베이스]`,
    docs || '(주입된 문서가 없습니다. 모든 서비스 질문은 무료 상담으로 안내하세요.)',
  ].join('\n');
}

// 클라이언트가 보낸 messages 를 검증/정리한다.
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

// 메인 핸들러. { messages: [...] } 를 받아 { reply } 를 반환.
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

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: buildSystemPrompt() }, ...history],
  });

  const reply =
    completion.choices &&
    completion.choices[0] &&
    completion.choices[0].message &&
    completion.choices[0].message.content;

  return { reply: (reply || '').trim() || '죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요.' };
}

module.exports = { handleChat, CHATBOT_NAME };
