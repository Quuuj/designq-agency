#!/usr/bin/env python3
"""uploads/*.md 를 청크·임베딩해 documents 테이블에 적재 (Node 없이 실행 가능).
실행: python3 scripts/ingest.py   (.env 의 OPENAI_API_KEY, SUPABASE_* 필요)
표준 라이브러리만 사용."""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPLOADS = ROOT / "public" / "uploads"
EMBED_MODEL = "text-embedding-3-small"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 150


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def chunk_text(text):
    clean = text.replace("\r\n", "\n").strip()
    chunks, start = [], 0
    while start < len(clean):
        end = min(start + CHUNK_SIZE, len(clean))
        if end < len(clean):
            nl = clean.rfind("\n", start, end)
            if nl > start + CHUNK_SIZE * 0.5:
                end = nl
        piece = clean[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(clean):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return chunks


def embed(text, api_key):
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=json.dumps({"model": EMBED_MODEL, "input": text}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]


def supabase_request(method, path, body=None, prefer=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def main():
    load_env()
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("❌ OPENAI_API_KEY 가 .env 에 없습니다.")
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        sys.exit("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env 에 없습니다.")
    api_key = os.environ["OPENAI_API_KEY"]

    print("기존 documents 삭제 중...")
    # id != 0 인 전체 삭제
    supabase_request("DELETE", "/rest/v1/documents?id=gt.0", prefer="return=minimal")

    total = 0
    for f in sorted(UPLOADS.glob("*.md")):
        chunks = chunk_text(f.read_text(encoding="utf-8"))
        print(f"📄 {f.name} → {len(chunks)} 청크")
        for content in chunks:
            embedding = embed(content, api_key)
            supabase_request(
                "POST", "/rest/v1/documents",
                body={"source": f.name, "content": content, "embedding": embedding},
                prefer="return=minimal",
            )
            total += 1
    print(f"✅ 완료: {total} 청크 적재됨")


if __name__ == "__main__":
    main()
