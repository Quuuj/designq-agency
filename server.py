#!/usr/bin/env python3
"""로컬 개발용 Python 서버 (Node 미설치 환경 대체).
정적 파일 서빙 + POST /api/chat -> OpenAI 호출.
배포(Vercel)에서는 api/chat.js 서버리스 함수를 사용한다.
표준 라이브러리만 사용 (외부 의존성 없음)."""
import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("PORT", "3000"))
MODEL = "gpt-5.4-mini"
EMBED_MODEL = "text-embedding-3-small"
CHATBOT_NAME = "큐봇"
MAX_HISTORY = 10
MATCH_COUNT = 5

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8",
}


def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_docs_cache = None


def load_knowledge_base():
    global _docs_cache
    if _docs_cache is not None:
        return _docs_cache
    combined = ""
    updir = PUBLIC / "uploads"
    if updir.is_dir():
        for f in sorted(updir.glob("*.md")):
            combined += f"\n\n===== 문서: {f.name} =====\n{f.read_text(encoding='utf-8')}"
    _docs_cache = combined.strip()
    return _docs_cache


# ---------- Supabase (서버 전용, service_role) ----------
def supabase_enabled():
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def supabase_request(method, path, body=None, prefer=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def embed_query(text, api_key):
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=json.dumps({"model": EMBED_MODEL, "input": text}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]


# RAG: 성공 시 관련 청크 문자열, 실패/없음/미설정 시 None (→ 전체 문서 폴백)
def retrieve_context(query, api_key):
    if not supabase_enabled():
        return None
    try:
        emb = embed_query(query, api_key)
        rows = supabase_request(
            "POST", "/rest/v1/rpc/match_documents",
            body={"query_embedding": emb, "match_count": MATCH_COUNT},
        )
        if not rows:
            return None
        return "\n\n".join(f"===== {r.get('source') or '문서'} =====\n{r.get('content','')}" for r in rows)
    except Exception as e:
        print(f"RAG 검색 실패, 폴백: {e}")
        return None


# 대화 로그 best-effort
def log_chat(question, answer):
    if not supabase_enabled():
        return
    try:
        supabase_request("POST", "/rest/v1/chat_logs",
                         body={"question": question, "answer": answer}, prefer="return=minimal")
    except Exception as e:
        print(f"chat_logs 기록 실패(무시): {e}")


def insert_lead(industry, contact, message):
    supabase_request("POST", "/rest/v1/leads",
                     body={"industry": industry, "contact": contact, "message": message},
                     prefer="return=minimal")


def build_system_prompt(knowledge):
    docs = knowledge
    return "\n".join([
        f'당신은 디자인 대행사 "디자인큐(DesignQ)"의 공식 상담 챗봇 "{CHATBOT_NAME}"입니다.',
        "브랜드 톤앤매너: 쉽고 명확하게, 단정적이지만 따뜻하게, 과장 없이 솔직하게. 디자인 비전문가도 편하게 이해할 수 있는 친근한 말투를 사용하세요.",
        "",
        "[답변 규칙]",
        f'1. 자기소개·인사·대화형 질문("이름이 뭐야", "넌 누구야" 등): 챗봇 이름({CHATBOT_NAME})과 역할(디자인큐 상담 도우미)을 자연스럽게 소개하며 답하세요.',
        '2. 서비스·정책·가격·절차 등 회사 관련 질문: 아래 [지식 베이스] 문서에 있는 내용만 근거로 답하세요. 문서에 없는 정보는 절대 지어내지 말고, "정확한 안내를 위해 무료 상담을 도와드릴게요. 상담을 신청해 주시면 담당자가 자세히 안내해 드립니다." 라고 무료 상담을 안내하세요.',
        '3. 디자인큐 서비스와 무관한 질문(날씨, 일반 상식, 잡담 등): "저는 디자인큐 서비스 관련 질문만 도와드릴 수 있어요 🙂" 라고 정중히 안내하세요.',
        "4. 문서에 없는 회사 정보는 어떤 경우에도 창작하지 마세요.",
        "5. 답변은 간결하게, 2~4문장 이내로 핵심만 전달하세요.",
        "",
        "[지식 베이스]",
        docs or "(주입된 문서가 없습니다. 모든 서비스 질문은 무료 상담으로 안내하세요.)",
    ])


def sanitize_history(messages):
    if not isinstance(messages, list):
        return []
    out = []
    for m in messages:
        if (isinstance(m, dict) and m.get("role") in ("user", "assistant")
                and isinstance(m.get("content"), str) and m["content"].strip()):
            out.append({"role": m["role"], "content": m["content"][:4000]})
    return out[-MAX_HISTORY:]


def call_openai(history):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 미설정")
    # 마지막 사용자 질문 → RAG 검색, 실패 시 전체 문서 폴백
    last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    knowledge = retrieve_context(last_user, api_key) if last_user else None
    if not knowledge:
        knowledge = load_knowledge_base()
    payload = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": build_system_prompt(knowledge)}] + history,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    reply = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    return reply or "죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요."


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_POST(self):
        route = self.path.split("?")[0]
        if route == "/api/lead":
            self._handle_lead()
            return
        if route != "/api/chat":
            self._json(404, {"error": "Not Found"})
            return
        try:
            body = self._read_body()
            history = sanitize_history(body.get("messages"))
            if not history:
                self._json(400, {"error": "메시지가 비어 있습니다."})
                return
            reply = call_openai(history)
            last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
            log_chat(last_user, reply)  # best-effort
            self._json(200, {"reply": reply})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            print(f"OpenAI HTTP {e.code}: {detail}")
            self._json(502, {"error": "답변 생성 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."})
        except Exception as e:
            print(f"/api/chat 오류: {e}")
            self._json(500, {"error": "답변 생성 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."})

    def _handle_lead(self):
        try:
            body = self._read_body()
            industry = str(body.get("industry", ""))[:200]
            contact = str(body.get("contact", ""))[:200]
            message = str(body.get("message", ""))[:4000]
            if not contact and not message:
                self._json(400, {"error": "연락처 또는 문의 내용을 입력해 주세요."})
                return
            if not supabase_enabled():
                self._json(503, {"error": "상담 접수 저장소가 아직 설정되지 않았어요."})
                return
            insert_lead(industry, contact, message)
            self._json(200, {"ok": True})
        except Exception as e:
            print(f"/api/lead 오류: {e}")
            self._json(500, {"error": "상담 신청 저장 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."})

    def do_GET(self):
        url_path = self.path.split("?")[0]
        if url_path == "/":
            url_path = "/index.html"
        target = (PUBLIC / url_path.lstrip("/")).resolve()
        if not str(target).startswith(str(PUBLIC)) or not target.is_file():
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Not Found".encode("utf-8"))
            return
        content = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    load_env()
    print(f"✅ 디자인큐 로컬 서버 (Python) 실행 중: http://localhost:{PORT}")
    if not os.environ.get("OPENAI_API_KEY"):
        print("⚠️  OPENAI_API_KEY 가 .env 에 없습니다. 챗봇 응답이 실패합니다.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
