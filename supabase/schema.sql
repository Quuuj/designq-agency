-- 디자인큐 챗봇 Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.

-- 1) pgvector 확장
create extension if not exists vector;

-- 2) 문서 청크 + 임베딩 (RAG)
--    text-embedding-3-small 의 차원은 1536 입니다.
create table if not exists documents (
  id          bigserial primary key,
  source      text,                 -- 원본 파일명 (예: 디자인큐_회사소개서.md)
  content     text not null,        -- 청크 본문
  embedding   vector(1536),
  created_at  timestamptz default now()
);

-- 코사인 거리 기반 유사도 검색 인덱스
create index if not exists documents_embedding_idx
  on documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 3) 유사도 검색 함수 (top N 청크 반환)
create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id bigint,
  source text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.source,
    documents.content,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;

-- 4) 상담 신청(리드)
create table if not exists leads (
  id          bigserial primary key,
  industry    text,
  contact     text,
  message     text,
  created_at  timestamptz default now()
);

-- 5) 대화 로그
create table if not exists chat_logs (
  id          bigserial primary key,
  question    text,
  answer      text,
  created_at  timestamptz default now()
);

-- 참고: 위 테이블은 service_role 키(서버 전용)로만 접근합니다.
-- RLS(Row Level Security)는 기본 비활성 상태로 두되, 클라이언트(anon)에서
-- 직접 접근시키지 않으므로 service_role 로만 호출하면 안전합니다.
-- 공개 클라이언트 접근을 막으려면 각 테이블에 `alter table ... enable row level security;`
-- 를 적용하고 정책을 추가하지 않으면 anon 접근이 전부 차단됩니다(service_role 은 우회).
