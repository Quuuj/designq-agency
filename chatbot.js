/* 디자인큐 floating 챗봇 위젯 — 순수 JS, 프레임워크 없음.
 * 우측 하단 버튼 → 클릭 시 채팅창 슬라이드 업.
 * /api/chat 으로만 통신 (API 키는 서버에만 존재). */
(function () {
  'use strict';

  var ACCENT = '#FF6B4A'; // 선셋 오렌지 (CTA)
  var PRIMARY = '#2A4DE3'; // Q 블루
  var NAVY = '#1A1F36';
  var MAX_HISTORY = 10; // 최근 10개 메시지(5턴) 유지
  var WELCOME = '안녕하세요! 디자인큐 상담 도우미 큐봇이에요 🙂\n로고, 브랜딩, 가격 등 궁금한 점을 편하게 물어보세요.';

  var messages = []; // { role: 'user'|'assistant', content }
  var isLoading = false;
  var welcomed = false;

  // ---------- 스타일 주입 ----------
  var css =
    '#dq-chat-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;' +
    'background:' + ACCENT + ';border:none;cursor:pointer;box-shadow:0 6px 20px rgba(255,107,74,.4);' +
    'display:flex;align-items:center;justify-content:center;z-index:99998;transition:transform .2s ease;}' +
    '#dq-chat-btn:hover{transform:scale(1.06);}' +
    '#dq-chat-btn svg{width:28px;height:28px;}' +
    '#dq-chat-panel{position:fixed;right:20px;bottom:90px;width:380px;max-width:calc(100vw - 40px);' +
    'height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;' +
    'box-shadow:0 12px 48px rgba(26,31,54,.22);z-index:99999;display:flex;flex-direction:column;' +
    'overflow:hidden;font-family:Pretendard,-apple-system,BlinkMacSystemFont,sans-serif;' +
    'opacity:0;transform:translateY(24px) scale(.98);pointer-events:none;transition:opacity .25s ease,transform .25s ease;}' +
    '#dq-chat-panel.dq-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}' +
    '#dq-chat-header{background:' + PRIMARY + ';color:#fff;padding:16px 18px;display:flex;align-items:center;gap:10px;}' +
    '#dq-chat-header .dq-avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);' +
    'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;}' +
    '#dq-chat-header .dq-title{font-weight:700;font-size:15px;line-height:1.2;}' +
    '#dq-chat-header .dq-sub{font-size:11.5px;opacity:.8;margin-top:2px;}' +
    '#dq-chat-close{margin-left:auto;background:none;border:none;color:#fff;cursor:pointer;font-size:22px;' +
    'line-height:1;opacity:.85;padding:4px;}' +
    '#dq-chat-close:hover{opacity:1;}' +
    '#dq-chat-body{flex:1;overflow-y:auto;padding:16px;background:#F2F3F7;display:flex;flex-direction:column;gap:10px;}' +
    '.dq-msg{max-width:80%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;}' +
    '.dq-msg.bot{align-self:flex-start;background:#fff;color:' + NAVY + ';border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(26,31,54,.08);}' +
    '.dq-msg.user{align-self:flex-end;background:' + PRIMARY + ';color:#fff;border-bottom-right-radius:4px;}' +
    '.dq-msg.error{align-self:flex-start;background:#FFEDE8;color:#C0392B;border-bottom-left-radius:4px;}' +
    '.dq-typing{align-self:flex-start;background:#fff;padding:12px 14px;border-radius:14px;border-bottom-left-radius:4px;' +
    'box-shadow:0 1px 3px rgba(26,31,54,.08);display:flex;gap:4px;}' +
    '.dq-typing span{width:7px;height:7px;border-radius:50%;background:#9097A8;display:inline-block;' +
    'animation:dq-bounce 1.2s infinite ease-in-out;}' +
    '.dq-typing span:nth-child(2){animation-delay:.2s;}.dq-typing span:nth-child(3){animation-delay:.4s;}' +
    '@keyframes dq-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-5px);opacity:1;}}' +
    '#dq-chat-input-row{display:flex;gap:8px;padding:12px;border-top:1px solid #E7E9F0;background:#fff;}' +
    '#dq-chat-input{flex:1;border:1px solid #DDE0EA;border-radius:12px;padding:10px 12px;font-size:13.5px;' +
    'font-family:inherit;resize:none;outline:none;max-height:90px;line-height:1.4;}' +
    '#dq-chat-input:focus{border-color:' + PRIMARY + ';}' +
    '#dq-chat-send{background:' + ACCENT + ';border:none;border-radius:12px;width:44px;cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s;}' +
    '#dq-chat-send:disabled{opacity:.45;cursor:not-allowed;}' +
    '#dq-chat-send svg{width:20px;height:20px;}' +
    '@media (max-width:480px){#dq-chat-panel{right:20px;bottom:84px;height:calc(100vh - 110px);}}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- DOM ----------
  var btn = document.createElement('button');
  btn.id = 'dq-chat-btn';
  btn.setAttribute('aria-label', '챗봇 열기');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'dq-chat-panel';
  panel.innerHTML =
    '<div id="dq-chat-header">' +
    '<div class="dq-avatar">Q</div>' +
    '<div><div class="dq-title">큐봇</div><div class="dq-sub">디자인큐 상담 도우미</div></div>' +
    '<button id="dq-chat-close" aria-label="닫기">&times;</button>' +
    '</div>' +
    '<div id="dq-chat-body"></div>' +
    '<div id="dq-chat-input-row">' +
    '<textarea id="dq-chat-input" rows="1" placeholder="메시지를 입력하세요..."></textarea>' +
    '<button id="dq-chat-send" aria-label="전송">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
    '</button>' +
    '</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector('#dq-chat-body');
  var input = panel.querySelector('#dq-chat-input');
  var sendBtn = panel.querySelector('#dq-chat-send');
  var closeBtn = panel.querySelector('#dq-chat-close');

  // ---------- 렌더링 헬퍼 ----------
  function scrollToBottom() {
    body.scrollTop = body.scrollHeight;
  }

  function appendBubble(role, text) {
    var el = document.createElement('div');
    el.className = 'dq-msg ' + role; // role: bot | user | error
    el.textContent = text;
    body.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'dq-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(el);
    scrollToBottom();
    return el;
  }

  // ---------- 패널 열고 닫기 ----------
  function openPanel() {
    panel.classList.add('dq-open');
    if (!welcomed) {
      welcomed = true;
      appendBubble('bot', WELCOME);
    }
    setTimeout(function () {
      input.focus();
    }, 280);
  }
  function closePanel() {
    panel.classList.remove('dq-open');
  }
  function togglePanel() {
    if (panel.classList.contains('dq-open')) closePanel();
    else openPanel();
  }

  btn.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);

  // ---------- 전송 ----------
  function setLoading(state) {
    isLoading = state;
    sendBtn.disabled = state;
    input.disabled = state;
  }

  async function sendMessage() {
    var text = input.value.trim();
    if (!text || isLoading) return;

    appendBubble('user', text);
    messages.push({ role: 'user', content: text });
    if (messages.length > MAX_HISTORY) messages = messages.slice(-MAX_HISTORY);

    input.value = '';
    input.style.height = 'auto';
    setLoading(true);
    var typing = showTyping();

    try {
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages }),
      });
      typing.remove();

      if (!res.ok) {
        var errData = {};
        try { errData = await res.json(); } catch (e) {}
        appendBubble('error', errData.error || '응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }

      var data = await res.json();
      var reply = (data && data.reply) || '죄송해요, 답변을 가져오지 못했어요.';
      appendBubble('bot', reply);
      messages.push({ role: 'assistant', content: reply });
      if (messages.length > MAX_HISTORY) messages = messages.slice(-MAX_HISTORY);
    } catch (err) {
      typing.remove();
      appendBubble('error', '네트워크 오류가 발생했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setLoading(false);
      input.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // textarea 자동 높이
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });

  // ---------- 환영 메시지: 페이지 로드 1초 후 자동 표시 ----------
  setTimeout(function () {
    if (!panel.classList.contains('dq-open')) openPanel();
  }, 1000);
})();
