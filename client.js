const userToken = localStorage.getItem("nanu_token");
if (!userToken) {
  window.location.href = "/auth.html";
}

const PROXY_URL = (window.location.origin.startsWith("http")) ? "/api/chat" : "http://localhost:3000/api/chat";
const DEFAULT_SYS = "You are N.A.N.U, a concise, helpful, and intelligent AI assistant. Think step by step when needed. Avoid unnecessary repetition. Format code cleanly in markdown.";

let sysPrompt = localStorage.getItem("nanu_sys") || DEFAULT_SYS;
let isThinkingEnabled = false;

const SEND_ICON_HTML = `<svg class="send-icon-arrow" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
const STOP_ICON_HTML = `<svg class="send-icon-stop" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>`;

const $ = id => document.getElementById(id);
const sidebar = $("sidebar");
const sidebarToggle = $("sidebarToggle");
const openSidebarBtn = $("openSidebarBtn");
const historyList = $("historyList");
const newChatBtn = $("newChatBtn");
const chatTitle = $("chatTitle");
const statusPill = $("statusPill");
const stopBtn = $("stopBtn");
const chatArea = $("chatArea");
const emptyState = $("emptyState");
const messagesEl = $("messages");
const inputBox = $("inputBox");
const sendBtn = $("sendBtn");
const charCount = $("charCount");
const themeToggle = $("themeToggle");
const sysPromptModal = $("sysPromptModal");
const profileModal = $("profileModal");
const toast = $("toast");
const scrollToBottomBtn = $("scrollToBottomBtn");
const composerThinkBtn = $("composerThinkBtn");
const composerMicBtn = $("composerMicBtn");
const composerAddBtn = $("composerAddBtn");
const fileAttachmentInput = $("fileAttachmentInput");
const composer = $("composer");
const composerInner = $("composerInner");
const composerActions = $("composerActions");
const composerModelPicker = $("composerModelPicker");
const composerModelPill = $("composerModelPill");
const modelPillIcon = $("modelPillIcon");
const modelPillName = $("modelPillName");
const composerModelMenu = $("composerModelMenu");
const attachmentPreviewBar = $("attachmentPreviewBar");
const shareChatBtn = $("shareChatBtn");
const profileWidget = $("profileWidget");
const profileMenu = $("profileMenu");
const sysPromptMenu = $("sysPromptMenu");
const profileEditMenu = $("profileEditMenu");
const clearAllMenu = $("clearAllMenu");
const logoutBtnMenu = $("logoutBtnMenu");

let attachedFiles = [];
let currentSpeakingBtn = null;

let chats = {};
try {
  chats = JSON.parse(localStorage.getItem("nanu_chats") || "{}");
  if (typeof chats !== "object" || chats === null) chats = {};
} catch {
  chats = {};
}
let currentId = null;
let streaming = false;
let abort = null;

try {
  if (window.marked) {
    marked.setOptions({
      highlight: (code, lang) => {
        try {
          if (window.hljs) {
            if (lang && hljs.getLanguage && hljs.getLanguage(lang)) {
              return hljs.highlight(code, { language: lang }).value;
            }
            if (hljs.highlightAuto) {
              return hljs.highlightAuto(code).value;
            }
          }
        } catch (e) {}
        return code;
      },
      breaks: true,
      gfm: true
    });
  }
} catch (e) {
  console.warn("Marked setup:", e);
}

function renderMd(text) {
  if (window.marked && typeof marked.parse === "function") {
    try {
      return marked.parse(text);
    } catch {
      return escapeHtml(text);
    }
  }
  return escapeHtml(text);
}

function applyHighlighting(container) {
  if (window.hljs && typeof hljs.highlightElement === "function") {
    container.querySelectorAll("pre code").forEach(el => {
      if (!el.dataset.highlighted) {
        try {
          hljs.highlightElement(el);
          el.dataset.highlighted = "true";
        } catch (e) {}
      }
    });
  }
  addCodeCopyButtons(container);
}

function stripMarkdownForSpeech(md) {
  if (!md) return "";
  return md
    .replace(/```[\s\S]*?```/g, "Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function stopReadAloud() {
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  if (currentSpeakingBtn) {
    currentSpeakingBtn.classList.remove("speaking");
    currentSpeakingBtn.title = "Read aloud";
    currentSpeakingBtn = null;
  }
}

function toggleReadAloud(btn, text) {
  if (!("speechSynthesis" in window)) {
    showToast("Speech synthesis is not supported in this browser.", "info");
    return;
  }

  if (currentSpeakingBtn === btn) {
    stopReadAloud();
    showToast("Reading stopped.");
    return;
  }

  stopReadAloud();

  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    showToast("No readable text found.");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  try {
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Online") || v.name.includes("Samantha") || v.name.includes("David"))) || voices.find(v => v.lang.startsWith("en"));
    if (englishVoice) utterance.voice = englishVoice;
  } catch (e) {}

  btn.classList.add("speaking");
  btn.title = "Stop reading";
  currentSpeakingBtn = btn;

  utterance.onend = () => {
    if (currentSpeakingBtn === btn) {
      btn.classList.remove("speaking");
      btn.title = "Read aloud";
      currentSpeakingBtn = null;
    }
  };

  utterance.onerror = () => {
    if (currentSpeakingBtn === btn) {
      btn.classList.remove("speaking");
      btn.title = "Read aloud";
      currentSpeakingBtn = null;
    }
  };

  window.speechSynthesis.speak(utterance);
  showToast("Reading aloud… 🔊");
}

function formatChatTimestamp(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d.getTime())) return "Today";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isToday) {
    return `Today at ${timeStr}`;
  } else if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  } else {
    const isThisYear = d.getFullYear() === now.getFullYear();
    const dateStr = d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: isThisYear ? undefined : "numeric"
    });
    return `${dateStr} · ${timeStr}`;
  }
}

function attachBubbleActions(actionBarContainer, msgContent, msgTimestamp = null) {
  const existingBar = actionBarContainer.querySelector(".bubble-actions");
  if (existingBar) existingBar.remove();

  const timeStr = msgTimestamp
    ? new Date(msgTimestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const actionBar = document.createElement("div");
  actionBar.className = "bubble-actions";
  actionBar.innerHTML = `
    <button class="action-btn copy-msg-btn" title="Copy message" aria-label="Copy">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>
    <button class="action-btn read-aloud-btn" title="Read aloud" aria-label="Read aloud">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
    </button>
    <button class="action-btn like-btn" title="Good response" aria-label="Thumbs up">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
    </button>
    <button class="action-btn dislike-btn" title="Bad response" aria-label="Thumbs down">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
    </button>
    <button class="action-btn regen-btn" title="Regenerate" aria-label="Regenerate">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
    </button>
    <span class="action-time">${timeStr}</span>
  `;

  const copyBtn = actionBar.querySelector(".copy-msg-btn");
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(msgContent).then(() => {
      copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      showToast("Copied to clipboard!");
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 2000);
    });
  });

  const readAloudBtn = actionBar.querySelector(".read-aloud-btn");
  if (readAloudBtn) {
    readAloudBtn.addEventListener("click", () => {
      toggleReadAloud(readAloudBtn, msgContent);
    });
  }

  const likeBtn = actionBar.querySelector(".like-btn");
  likeBtn.addEventListener("click", () => {
    likeBtn.classList.toggle("active");
    if (likeBtn.classList.contains("active")) {
      actionBar.querySelector(".dislike-btn").classList.remove("active");
      showToast("Thanks for the feedback!");
    }
  });

  const dislikeBtn = actionBar.querySelector(".dislike-btn");
  dislikeBtn.addEventListener("click", () => {
    dislikeBtn.classList.toggle("active");
    if (dislikeBtn.classList.contains("active")) {
      actionBar.querySelector(".like-btn").classList.remove("active");
      showToast("Feedback recorded.");
    }
  });

  const regenBtn = actionBar.querySelector(".regen-btn");
  regenBtn.addEventListener("click", () => regenerateLast());

  actionBarContainer.appendChild(actionBar);
}

function saveChats() {
  localStorage.setItem("nanu_chats", JSON.stringify(chats));
}

function newChat() {
  const id = "chat_" + Date.now();
  chats[id] = {
    id,
    title: "New Conversation",
    messages: [{ role: "system", content: sysPrompt }],
    created: Date.now()
  };
  currentId = id;
  saveChats();
  renderHistory();
  clearMessages();
  showEmpty();
  return id;
}

function loadChat(id) {
  currentId = id;
  clearMessages();
  const chat = chats[id];
  if (!chat) return;
  chatTitle.textContent = chat.title;
  const tsEl = $("chatTimestamp");
  if (tsEl) {
    tsEl.textContent = formatChatTimestamp(chat.created);
  }
  const userMsgs = chat.messages.filter(m => m.role !== "system");
  if (userMsgs.length === 0) {
    showEmpty();
    return;
  }
  hideEmpty();
  userMsgs.forEach(m => {
    if (m.role === "user") {
      appendBubble("user", m.content, false, false, m.attachments || [], m.time);
    } else {
      appendBubble("assistant", m.content, false, true, [], m.time);
    }
  });
  renderHistory();
  setTimeout(() => chatArea.scrollTop = chatArea.scrollHeight, 50);
}

function deleteChat(id) {
  delete chats[id];
  saveChats();
  if (currentId === id) {
    const ids = Object.keys(chats);
    if (ids.length > 0) loadChat(ids[ids.length - 1]);
    else newChat();
  }
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";
  const ids = Object.keys(chats).sort((a, b) => chats[b].created - chats[a].created);
  ids.forEach(id => {
    const chat = chats[id];
    const item = document.createElement("div");
    item.className = "history-item" + (id === currentId ? " active" : "");
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
      <span class="history-title">${escapeHtml(chat.title)}</span>
      <button class="delete-btn" data-id="${id}" title="Delete chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      loadChat(id);
    });
    item.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteChat(id);
    });
    historyList.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showEmpty() {
  emptyState.hidden = false;
  emptyState.style.display = "flex";
  messagesEl.style.display = "none";
  chatTitle.textContent = "New Conversation";
}

function hideEmpty() {
  emptyState.hidden = true;
  emptyState.style.display = "none";
  messagesEl.style.display = "flex";
}

function clearMessages() {
  const chatTime = currentId && chats[currentId] ? chats[currentId].created : Date.now();
  messagesEl.innerHTML = `<div class="chat-timestamp" id="chatTimestamp">${formatChatTimestamp(chatTime)}</div>`;
  chatTitle.textContent = "New Conversation";
}

function setStreaming(on) {
  streaming = on;
  if (statusPill) {
    statusPill.textContent = on ? "Generating…" : "Idle";
    statusPill.classList.toggle("on", on);
  }
  if (stopBtn) {
    stopBtn.style.display = on ? "flex" : "none";
  }
  updateSendButtonState();
}

function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  toast.hidden = false;
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.hidden = true, 400);
  }, 2500);
}

function updateTitle(text) {
  if (!currentId) return;
  const title = text.slice(0, 36).trim() || "New Conversation";
  chats[currentId].title = title;
  chatTitle.textContent = title;
  saveChats();
  renderHistory();
}

function appendBubble(role, text = "", typing = false, preRendered = false, attachments = [], timestamp = null) {
  hideEmpty();

  let ts = messagesEl.querySelector(".chat-timestamp");
  if (!ts) {
    ts = document.createElement("div");
    ts.className = "chat-timestamp";
    ts.id = "chatTimestamp";
    messagesEl.insertBefore(ts, messagesEl.firstChild);
  }
  const chatTime = currentId && chats[currentId] ? chats[currentId].created : null;
  ts.textContent = formatChatTimestamp(chatTime || Date.now());

  const row = document.createElement("div");
  row.className = "msg-row " + (role === "user" ? "msg-user" : "msg-bot");

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "bubble bubble-" + (role === "user" ? "user" : "bot");

  const contentEl = document.createElement("div");
  contentEl.className = "bubble-content";

  // If user bubble has attachments, display them inline
  if (role === "user" && attachments && attachments.length > 0) {
    const attachGrid = document.createElement("div");
    attachGrid.className = "user-attachments-grid";
    attachments.forEach(att => {
      if (att.base64 && (att.isImage || (att.mimeType && att.mimeType.startsWith("image/")))) {
        const img = document.createElement("img");
        img.className = "user-attachment-img";
        img.src = att.base64;
        img.alt = att.name || "Attachment";
        attachGrid.appendChild(img);
      } else {
        const docBadge = document.createElement("div");
        docBadge.className = "user-attachment-doc";
        docBadge.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span class="user-attachment-doc-name">${escapeHtml(att.name || "Document")}</span>
        `;
        attachGrid.appendChild(docBadge);
      }
    });
    contentEl.appendChild(attachGrid);
  }

  if (typing) {
    const typingEl = document.createElement("div");
    typingEl.className = "typing-indicator";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    contentEl.appendChild(typingEl);
  }

  const textEl = document.createElement("div");
  textEl.className = "bubble-text";

  if (preRendered && role === "assistant") {
    textEl.innerHTML = renderMd(text);
    applyHighlighting(textEl);
  } else {
    textEl.textContent = text;
  }

  if (text || role === "assistant") {
    contentEl.appendChild(textEl);
  }

  if (!typing && role === "assistant") {
    attachBubbleActions(contentEl, text, timestamp);
  }

  bubbleEl.appendChild(contentEl);
  row.appendChild(bubbleEl);
  messagesEl.appendChild(row);

  requestAnimationFrame(() => chatArea.scrollTop = chatArea.scrollHeight);
  return { textEl, contentEl, bubbleEl, row };
}

function addCodeCopyButtons(container) {
  container.querySelectorAll("pre").forEach(pre => {
    if (pre.querySelector(".code-copy-btn")) return;
    const lang = pre.querySelector("code")?.className?.replace("language-", "") || "";
    const wrap = document.createElement("div");
    wrap.className = "code-block-wrap";
    pre.parentNode.insertBefore(wrap, pre);
    if (lang) {
      const label = document.createElement("span");
      label.className = "code-lang";
      label.textContent = lang;
      wrap.appendChild(label);
    }
    const btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code")?.textContent || pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "✓ Copied";
        setTimeout(() => {
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
        }, 2000);
      });
    });
    wrap.appendChild(pre);
    wrap.appendChild(btn);
  });
}

async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  let fullText = "";
  if (window.pdfjsLib) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = Math.min(pdf.numPages, 30);
      const textParts = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        if (pageText.trim()) {
          textParts.push(`--- Page ${i} ---\n${pageText.trim()}`);
        }
      }
      fullText = textParts.join("\n\n");
    } catch (pdfErr) {
      console.warn("PDF extraction warning:", pdfErr);
    }
  }

  return { text: fullText, base64 };
}

async function processFiles(files) {
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    const isImg = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isDoc = file.type.startsWith("text/") || 
                  /\.(txt|md|csv|json|js|jsx|ts|tsx|py|html|css|xml|yaml|yml|log|sh|sql|c|cpp|h|java|rb|php)$/i.test(file.name);

    if (isImg) {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      attachedFiles.push({
        name: file.name,
        type: file.type || "image/jpeg",
        mimeType: file.type || "image/jpeg",
        base64,
        size: file.size,
        isImage: true
      });
      showToast(`Image attached: ${file.name}`);
    } else if (isPdf) {
      showToast(`Reading PDF: ${file.name}…`, "info");
      try {
        const { text, base64 } = await extractPdfText(file);
        attachedFiles.push({
          name: file.name,
          type: "application/pdf",
          mimeType: "application/pdf",
          base64,
          extractedText: text,
          size: file.size,
          isPdf: true
        });
        showToast(`✓ PDF attached (${file.name})`);
      } catch (err) {
        showToast(`Failed to parse PDF: ${err.message}`, "error");
      }
    } else if (isDoc) {
      const text = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(file);
      });
      attachedFiles.push({
        name: file.name,
        type: file.type || "text/plain",
        mimeType: file.type || "text/plain",
        extractedText: text,
        size: file.size,
        isDoc: true
      });
      showToast(`Document attached: ${file.name}`);
    } else {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      attachedFiles.push({
        name: file.name,
        type: file.type || "application/octet-stream",
        mimeType: file.type || "application/octet-stream",
        base64,
        size: file.size
      });
      showToast(`File attached: ${file.name}`);
    }
  }

  renderAttachmentPreviews();
  updateSendButtonState();
}

function renderAttachmentPreviews() {
  if (!attachmentPreviewBar) return;
  if (attachedFiles.length === 0) {
    attachmentPreviewBar.hidden = true;
    attachmentPreviewBar.innerHTML = "";
    return;
  }

  attachmentPreviewBar.hidden = false;
  attachmentPreviewBar.innerHTML = "";

  attachedFiles.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    const formattedSize = file.size > 1024 * 1024 
      ? (file.size / (1024 * 1024)).toFixed(1) + " MB"
      : Math.round(file.size / 1024) + " KB";

    let previewIconHtml = "";
    if (file.isImage && file.base64) {
      previewIconHtml = `<img class="attachment-chip-thumb" src="${file.base64}" alt="${escapeHtml(file.name)}">`;
    } else if (file.isPdf) {
      previewIconHtml = `
        <div class="attachment-chip-icon" style="background: rgba(239, 68, 68, 0.12); color: #ef4444;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>`;
    } else {
      previewIconHtml = `
        <div class="attachment-chip-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>`;
    }

    chip.innerHTML = `
      ${previewIconHtml}
      <div class="attachment-chip-info">
        <span class="attachment-chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="attachment-chip-size">${formattedSize}</span>
      </div>
      <button class="attachment-chip-remove" data-index="${index}" title="Remove file" aria-label="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    chip.querySelector(".attachment-chip-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      attachedFiles.splice(index, 1);
      renderAttachmentPreviews();
      updateSendButtonState();
    });

    attachmentPreviewBar.appendChild(chip);
  });
}

function updateSendButtonState() {
  const hasText = inputBox.value.trim().length > 0;
  const hasFiles = attachedFiles.length > 0;
  const canSend = hasText || hasFiles;

  if (composerMicBtn) {
    composerMicBtn.style.display = "flex";
  }

  if (streaming) {
    sendBtn.style.display = "flex";
    sendBtn.disabled = false;
    sendBtn.classList.add("is-stopping");
    sendBtn.title = "Stop responding";
    sendBtn.setAttribute("aria-label", "Stop responding");
    sendBtn.innerHTML = STOP_ICON_HTML;
  } else {
    sendBtn.style.display = "flex";
    sendBtn.disabled = !canSend;
    sendBtn.classList.remove("is-stopping");
    sendBtn.title = "Send message (Ctrl+Enter)";
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.innerHTML = SEND_ICON_HTML;
  }
}

async function sendMessage(overrideContent) {
  const content = overrideContent !== undefined ? overrideContent : inputBox.value.trim();
  const currentAttachments = [...attachedFiles];
  if ((!content && currentAttachments.length === 0) || streaming) return;
  if (!currentId || !chats[currentId]) {
    currentId = newChat();
  }

  const chat = chats[currentId];
  const userMsgTime = Date.now();
  chat.messages.push({ role: "user", content, attachments: currentAttachments, time: userMsgTime });
  if (chat.messages.filter(m => m.role === "user").length === 1) {
    const initialTitle = content || (currentAttachments[0] ? currentAttachments[0].name : "Conversation");
    updateTitle(initialTitle);
  }
  saveChats();

  appendBubble("user", content, false, false, currentAttachments, userMsgTime);
  inputBox.value = "";
  attachedFiles = [];
  renderAttachmentPreviews();
  autoGrow();
  updateSendButtonState();
  charCount.textContent = "";
  inputBox.focus();

  const botMsgTime = Date.now();
  const { textEl: botTextEl, contentEl: botContent } = appendBubble("assistant", "", true, false, [], botMsgTime);
  const botMsg = { role: "assistant", content: "", time: botMsgTime };
  chat.messages.push(botMsg);

  setStreaming(true);
  abort = new AbortController();

  let buffer = "";
  const userMessages = chat.messages
    .filter(m => m.role !== "system" && ((m.content && m.content.trim()) || (m.attachments && m.attachments.length > 0)))
    .map(m => ({
      role: m.role,
      content: m.content || "",
      attachments: m.attachments || []
    }));

  const effectiveSys = isThinkingEnabled
    ? sysPrompt + " Think deeply step-by-step before answering. Break your thoughts down clearly."
    : sysPrompt;

  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + userToken },
      body: JSON.stringify({
        model: getActiveModel(),
        temperature: 0.7,
        system: effectiveSys,
        messages: userMessages,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientTime: new Date().toISOString()
      }),
      signal: abort.signal
    });

    if (!res.ok || !res.body) {
      botContent.querySelector(".typing-indicator")?.remove();
      const errText = await res.text().catch(() => "");
      let friendlyErr = `Server error ${res.status}`;
      if (errText) friendlyErr = errText;
      botTextEl.innerHTML = renderMd("⚠️ " + friendlyErr);
      setStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        if (firstChunk) {
          botContent.querySelector(".typing-indicator")?.remove();
          firstChunk = false;
        }
        buffer += chunk;
        botMsg.content = buffer;
        botTextEl.innerHTML = renderMd(buffer);
        applyHighlighting(botTextEl);
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    }
  } catch (e) {
    botContent.querySelector(".typing-indicator")?.remove();
    if (e.name !== "AbortError") {
      botTextEl.textContent = "⚠️ " + e.message;
    }
  } finally {
    if (botMsg.content) {
      if (botMsg.content.includes("[CLEAR_CHATS_CONFIRMED]")) {
        botMsg.content = botMsg.content.replace("[CLEAR_CHATS_CONFIRMED]", "").trim();
        botTextEl.innerHTML = renderMd(botMsg.content);
        chats = {};
        saveChats();
        renderHistory();
        newChat();
        showToast("All previous chats have been cleared.");
      } else {
        botMsg.time = Date.now();
        attachBubbleActions(botContent, botMsg.content, botMsg.time);
        saveChats();
        renderHistory();
      }
    } else {
      saveChats();
      renderHistory();
    }
    setStreaming(false);
    requestAnimationFrame(() => inputBox.focus());
  }
}

function regenerateLast() {
  if (!currentId || streaming) return;
  const chat = chats[currentId];
  while (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === "assistant") {
    chat.messages.pop();
  }
  saveChats();
  const rows = messagesEl.querySelectorAll(".msg-row.msg-bot");
  if (rows.length) rows[rows.length - 1].remove();
  const lastUser = chat.messages.filter(m => m.role === "user").pop();
  if (!lastUser) return;
  chat.messages.pop();
  sendMessage(lastUser.content);
}

function autoGrow() {
  inputBox.style.height = "auto";
  const newHeight = Math.max(24, Math.min(inputBox.scrollHeight, 140));
  inputBox.style.height = newHeight + "px";
  if (composerInner) {
    if (newHeight > 34) {
      composerInner.style.borderRadius = "24px";
      composerInner.style.height = "auto";
    } else {
      composerInner.style.borderRadius = "9999px";
      composerInner.style.height = "54px";
    }
  }
}

let sidebarOpen = true;
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle("sidebar-hidden", !sidebarOpen);
  openSidebarBtn.style.display = sidebarOpen ? "none" : "flex";
}

function openModal(el) {
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("modal-visible"));
}

function closeModal(el) {
  el.classList.remove("modal-visible");
  setTimeout(() => el.hidden = true, 200);
}

// System Prompt Modal
const closeSysPromptBtn = $("closeSysPrompt");
if (closeSysPromptBtn) closeSysPromptBtn.addEventListener("click", () => closeModal(sysPromptModal));
const saveSysPromptBtn = $("saveSysPrompt");
if (saveSysPromptBtn) {
  saveSysPromptBtn.addEventListener("click", () => {
    sysPrompt = $("sysPromptTextarea").value.trim() || DEFAULT_SYS;
    localStorage.setItem("nanu_sys", sysPrompt);
    if (currentId && chats[currentId]) {
      chats[currentId].messages[0] = { role: "system", content: sysPrompt };
      saveChats();
    }
    closeModal(sysPromptModal);
    showToast("System prompt updated!");
  });
}

// Profile Modal (3-Step Change Password Wizard: Email -> OTP Verify/Resend -> Change Password)
let verifiedProfileOtp = "";

function resetProfileModal() {
  const pStep1 = $("profileStep1");
  const pStep2 = $("profileStep2");
  const pStep3 = $("profileStep3");
  const pEmail = $("profileEmailInput");
  const pOtp = $("profileOtpInput");
  const pNewPass = $("profileNewPassword");
  const pConfirmPass = $("profileConfirmPassword");
  const reqBtn = $("requestProfileOtpBtn");
  const confirmOtpBtn = $("confirmProfileOtpBtn");
  const resendBtn = $("resendProfileOtpBtn");
  const saveBtn = $("saveProfileBtn");

  if (pStep1) pStep1.style.display = "flex";
  if (pStep2) pStep2.style.display = "none";
  if (pStep3) pStep3.style.display = "none";

  if (pEmail) pEmail.value = "";
  if (pOtp) pOtp.value = "";
  if (pNewPass) pNewPass.value = "";
  if (pConfirmPass) pConfirmPass.value = "";

  verifiedProfileOtp = "";

  if (reqBtn) {
    reqBtn.disabled = false;
    reqBtn.textContent = "Verify";
  }
  if (confirmOtpBtn) {
    confirmOtpBtn.disabled = false;
    confirmOtpBtn.textContent = "Confirm OTP";
  }
  if (resendBtn) {
    resendBtn.disabled = false;
    resendBtn.textContent = "Resend OTP";
  }
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = "Change Password";
  }
}

async function sendProfileOtp(btn) {
  const emailInput = $("profileEmailInput");
  const email = emailInput ? emailInput.value.trim() : "";
  if (!email || !email.includes("@")) {
    return showToast("Please type your registered email address.", "error");
  }

  const isResend = btn && btn.id === "resendProfileOtpBtn";
  const originalText = btn ? btn.textContent : (isResend ? "Resend OTP" : "Verify");
  if (btn) {
    btn.disabled = true;
    btn.textContent = isResend ? "Resending OTP..." : "Verifying & Sending OTP...";
  }

  try {
    const res = await fetch("/api/auth/send-profile-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + userToken
      },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const pStep1 = $("profileStep1");
      const pStep2 = $("profileStep2");
      const pStep3 = $("profileStep3");
      const notice = $("profileOtpNotice");
      const pOtp = $("profileOtpInput");

      const successMsg = isResend
        ? `✓ Fresh 6-digit OTP resent to ${email}! Please check your inbox.`
        : `✓ 6-digit OTP sent to ${email}! Please check your inbox.`;
      showToast(successMsg);

      if (notice) {
        notice.style.background = "rgba(22, 163, 74, 0.1)";
        notice.style.borderColor = "rgba(22, 163, 74, 0.2)";
        notice.style.color = "#16a34a";
        notice.textContent = data.message || `✓ 6-digit verification OTP sent to ${email}! Please check your email inbox and spam folder.`;
      }

      if (pStep1) pStep1.style.display = "none";
      if (pStep2) pStep2.style.display = "flex";
      if (pStep3) pStep3.style.display = "none";

      if (pOtp) {
        pOtp.value = ""; // Strictly empty: user must check their email inbox
        pOtp.focus();
      }
    } else {
      showToast(data.error || "Failed to send OTP code.", "error");
    }
  } catch {
    showToast("Error sending OTP request.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

const closeProfile = $("closeProfile");
if (closeProfile) {
  closeProfile.addEventListener("click", () => {
    resetProfileModal();
    closeModal(profileModal);
  });
}

const closeProfileFooter = $("closeProfileFooter");
if (closeProfileFooter) {
  closeProfileFooter.addEventListener("click", () => {
    resetProfileModal();
    closeModal(profileModal);
  });
}

// Step 1: Verify button sends 6-digit OTP to the typed registered email
const requestProfileOtpBtn = $("requestProfileOtpBtn");
if (requestProfileOtpBtn) {
  requestProfileOtpBtn.addEventListener("click", () => sendProfileOtp(requestProfileOtpBtn));
}

// Step 2: Resend OTP button if user didn't receive the OTP
const resendProfileOtpBtn = $("resendProfileOtpBtn");
if (resendProfileOtpBtn) {
  resendProfileOtpBtn.addEventListener("click", () => sendProfileOtp(resendProfileOtpBtn));
}

// Step 2: Option to change registered email and go back to Step 1
const changeEmailProfileBtn = $("changeEmailProfileBtn");
if (changeEmailProfileBtn) {
  changeEmailProfileBtn.addEventListener("click", () => {
    const pStep1 = $("profileStep1");
    const pStep2 = $("profileStep2");
    const pStep3 = $("profileStep3");
    if (pStep1) pStep1.style.display = "flex";
    if (pStep2) pStep2.style.display = "none";
    if (pStep3) pStep3.style.display = "none";
    const emailInput = $("profileEmailInput");
    if (emailInput) emailInput.focus();
  });
}

// Step 2: Confirm OTP button verifies the typed OTP and unlocks Step 3
const confirmProfileOtpBtn = $("confirmProfileOtpBtn");
if (confirmProfileOtpBtn) {
  confirmProfileOtpBtn.addEventListener("click", async () => {
    const email = $("profileEmailInput") ? $("profileEmailInput").value.trim() : "";
    const otp = $("profileOtpInput") ? $("profileOtpInput").value.trim() : "";

    if (!email || !email.includes("@")) {
      return showToast("Please provide your registered email address.", "error");
    }
    if (!otp || otp.length !== 6) {
      return showToast("Please enter the complete 6-digit OTP verification code.", "error");
    }

    confirmProfileOtpBtn.disabled = true;
    confirmProfileOtpBtn.textContent = "Confirming OTP...";

    try {
      const res = await fetch("/api/auth/verify-profile-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + userToken
        },
        body: JSON.stringify({ email, otp })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        verifiedProfileOtp = otp;
        showToast("✓ OTP verified successfully! Please enter your new password.");

        const pStep1 = $("profileStep1");
        const pStep2 = $("profileStep2");
        const pStep3 = $("profileStep3");

        if (pStep1) pStep1.style.display = "none";
        if (pStep2) pStep2.style.display = "none";
        if (pStep3) pStep3.style.display = "flex";

        const pPass = $("profileNewPassword");
        const pConfirm = $("profileConfirmPassword");
        if (pPass) {
          pPass.value = "";
          pPass.focus();
        }
        if (pConfirm) pConfirm.value = "";
      } else {
        showToast(data.error || "Invalid or expired OTP code.", "error");
      }
    } catch {
      showToast("Network error verifying OTP code.", "error");
    } finally {
      confirmProfileOtpBtn.disabled = false;
      confirmProfileOtpBtn.textContent = "Confirm OTP";
    }
  });
}

// Step 3: Change Password button updates user password after OTP confirmation
const saveProfileBtn = $("saveProfileBtn");
if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async () => {
    const email = $("profileEmailInput") ? $("profileEmailInput").value.trim() : "";
    const otp = verifiedProfileOtp || ($("profileOtpInput") ? $("profileOtpInput").value.trim() : "");
    const newPassword = $("profileNewPassword") ? $("profileNewPassword").value : "";
    const confirmPassword = $("profileConfirmPassword") ? $("profileConfirmPassword").value : "";

    if (!email || !email.includes("@")) {
      return showToast("Registered email address is required.", "error");
    }
    if (!otp || otp.length !== 6) {
      return showToast("OTP verification is required first.", "error");
    }
    if (!newPassword || newPassword.length < 6) {
      return showToast("New password must be at least 6 characters.", "error");
    }
    if (newPassword !== confirmPassword) {
      return showToast("Passwords do not match. Please re-enter matching passwords.", "error");
    }

    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Changing Password...";
    try {
      const res = await fetch("/api/auth/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + userToken
        },
        body: JSON.stringify({ email, otp, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast("✓ Password successfully updated!");
        resetProfileModal();
        closeModal(profileModal);
      } else {
        showToast(data.error || "Failed to update password. Invalid or expired OTP.", "error");
      }
    } catch {
      showToast("Network error updating password.", "error");
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = "Change Password";
    }
  });
}

// Keyboard shortcuts for smoother UX
const profileEmailInput = $("profileEmailInput");
if (profileEmailInput) {
  profileEmailInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (requestProfileOtpBtn) requestProfileOtpBtn.click();
    }
  });
}

const profileOtpInput = $("profileOtpInput");
if (profileOtpInput) {
  profileOtpInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (confirmProfileOtpBtn) confirmProfileOtpBtn.click();
    }
  });
}

const profileNewPassword = $("profileNewPassword");
if (profileNewPassword) {
  profileNewPassword.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      const pConfirm = $("profileConfirmPassword");
      if (pConfirm) pConfirm.focus();
    }
  });
}

const profileConfirmPassword = $("profileConfirmPassword");
if (profileConfirmPassword) {
  profileConfirmPassword.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (saveProfileBtn) saveProfileBtn.click();
    }
  });
}

const clearChatsModal = $("clearChatsModal");
const clearConfirmInput = $("clearConfirmInput");
const clearConfirmError = $("clearConfirmError");
const confirmClearBtn = $("confirmClearBtn");
const cancelClearBtn = $("cancelClearBtn");
const closeClearChats = $("closeClearChats");

function resetClearChatsModal() {
  if (clearConfirmInput) clearConfirmInput.value = "";
  if (clearConfirmError) clearConfirmError.style.display = "none";
  if (confirmClearBtn) {
    confirmClearBtn.disabled = true;
    confirmClearBtn.style.opacity = "0.5";
    confirmClearBtn.style.cursor = "not-allowed";
  }
}

function executeClearAllChats() {
  const val = clearConfirmInput ? clearConfirmInput.value.trim().toLowerCase() : "";
  if (val !== "confirm") {
    if (clearConfirmError) clearConfirmError.style.display = "block";
    return;
  }
  chats = {};
  saveChats();
  renderHistory();
  newChat();
  resetClearChatsModal();
  closeModal(clearChatsModal);
  showToast("All previous chats have been cleared.");
}

if (clearConfirmInput) {
  clearConfirmInput.addEventListener("input", () => {
    const isConfirmed = clearConfirmInput.value.trim().toLowerCase() === "confirm";
    if (confirmClearBtn) {
      confirmClearBtn.disabled = !isConfirmed;
      confirmClearBtn.style.opacity = isConfirmed ? "1" : "0.5";
      confirmClearBtn.style.cursor = isConfirmed ? "pointer" : "not-allowed";
    }
    if (clearConfirmError && isConfirmed) {
      clearConfirmError.style.display = "none";
    }
  });

  clearConfirmInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const isConfirmed = clearConfirmInput.value.trim().toLowerCase() === "confirm";
      if (isConfirmed) {
        executeClearAllChats();
      } else {
        if (clearConfirmError) clearConfirmError.style.display = "block";
      }
    }
  });
}

if (confirmClearBtn) {
  confirmClearBtn.addEventListener("click", executeClearAllChats);
}

if (cancelClearBtn) {
  cancelClearBtn.addEventListener("click", () => {
    resetClearChatsModal();
    closeModal(clearChatsModal);
  });
}

if (closeClearChats) {
  closeClearChats.addEventListener("click", () => {
    resetClearChatsModal();
    closeModal(clearChatsModal);
  });
}

[sysPromptModal, profileModal, clearChatsModal].forEach(modal => {
  if (!modal) return;
  modal.addEventListener("click", e => {
    if (e.target === modal) {
      if (modal === clearChatsModal) resetClearChatsModal();
      if (modal === profileModal) resetProfileModal();
      closeModal(modal);
    }
  });
});

// Event Listeners for Composer & Inputs
sendBtn.addEventListener("mousedown", e => e.preventDefault());
sendBtn.addEventListener("click", e => {
  e.preventDefault();
  if (streaming) {
    if (abort) abort.abort();
    setStreaming(false);
    showToast("Stopped.", "info");
    return;
  }
  if (inputBox.value.trim().length === 0 && attachedFiles.length === 0) return;
  sendMessage();
  inputBox.focus();
});

inputBox.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (streaming) {
        if (abort) abort.abort();
        setStreaming(false);
        showToast("Stopped.", "info");
        return;
      }
      if (inputBox.value.trim().length > 0 || attachedFiles.length > 0) {
        sendMessage();
        inputBox.focus();
      }
    } else {
      // Plain Enter goes to the next line (browser default inserts newline)
      requestAnimationFrame(() => autoGrow());
    }
  }
});

inputBox.addEventListener("input", () => {
  autoGrow();
  updateSendButtonState();
  const len = inputBox.value.length;
  charCount.textContent = len > 0 ? len + "/8000" : "";
});

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    if (abort) abort.abort();
    setStreaming(false);
    showToast("Stopped.", "info");
  });
}

newChatBtn.addEventListener("click", () => {
  newChat();
  inputBox.focus();
});



// Theme handling
let currentTheme = localStorage.getItem("nanu_theme") || "light";
document.documentElement.setAttribute("data-theme", currentTheme);

themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);
  localStorage.setItem("nanu_theme", currentTheme);
  showToast(`Switched to ${currentTheme} mode`);
});

sidebarToggle.addEventListener("click", toggleSidebar);
openSidebarBtn.addEventListener("click", toggleSidebar);

// Scroll-To-Bottom Floating Arrow Button
if (scrollToBottomBtn) {
  chatArea.addEventListener("scroll", () => {
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    if (distanceFromBottom > 80 && chatArea.scrollHeight > chatArea.clientHeight + 40) {
      scrollToBottomBtn.classList.add("visible");
    } else {
      scrollToBottomBtn.classList.remove("visible");
    }
  });

  scrollToBottomBtn.addEventListener("click", () => {
    chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: "smooth" });
  });
}

// Think toggle (inside Model Menu)
const composerThinkToggle = $("composerThinkToggle");
const modelTogglePill = $("modelTogglePill");
if (composerThinkToggle) {
  composerThinkToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    isThinkingEnabled = !isThinkingEnabled;
    composerThinkToggle.classList.toggle("active", isThinkingEnabled);
    if (modelTogglePill) {
      modelTogglePill.textContent = isThinkingEnabled ? "On" : "Off";
    }
    showToast(isThinkingEnabled ? "Deep Thinking mode enabled 💡" : "Standard mode active");
  });
}
if (composerThinkBtn) {
  composerThinkBtn.addEventListener("click", () => {
    isThinkingEnabled = !isThinkingEnabled;
    composerThinkBtn.classList.toggle("active", isThinkingEnabled);
    showToast(isThinkingEnabled ? "Deep Thinking mode active 💡" : "Standard mode active");
  });
}

// -------------------------------------------------------------
// 1. Microphone: Voice Dictation (Speech-to-Text directly into input)
// -------------------------------------------------------------
if (composerMicBtn) {
  let recognizing = false;
  let recognition = null;
  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    let baseText = "";

    recognition.onstart = () => {
      recognizing = true;
      composerMicBtn.classList.add("active");
      baseText = inputBox.value ? inputBox.value.trim() + " " : "";
      showToast("🎙️ Voice Dictation active — Speak to type...");
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        finalTranscript += event.results[i][0].transcript;
      }
      inputBox.value = baseText + finalTranscript;
      autoGrow();
      updateSendButtonState();
      inputBox.focus();
    };

    recognition.onend = () => {
      recognizing = false;
      composerMicBtn.classList.remove("active");
    };

    recognition.onerror = (err) => {
      recognizing = false;
      composerMicBtn.classList.remove("active");
      if (err.error !== "no-speech") {
        showToast("Speech dictation error: " + err.error, "error");
      }
    };
  }

  composerMicBtn.addEventListener("click", () => {
    if (!recognition) {
      showToast("Speech recognition not supported in this browser. Try Chrome/Edge.", "error");
      return;
    }
    if (recognizing) {
      recognition.stop();
      recognizing = false;
      composerMicBtn.classList.remove("active");
      showToast("Voice dictation stopped.");
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.warn(err);
      }
    }
  });
}

// -------------------------------------------------------------
// Search Bar Model Switcher & Selection
// -------------------------------------------------------------
const MODEL_DISPLAY_INFO = {
  "gemini-flash-lite-latest": { name: "N.A.N.U Flash", fullName: "N.A.N.U Flash", icon: "⚡" },
  "gemini-2.0-flash": { name: "N.A.N.U Pro", fullName: "N.A.N.U Pro (Reasoning)", icon: "🧠" },
  "nanu-smart": { name: "N.A.N.U Smart", fullName: "N.A.N.U Smart (Offline)", icon: "💻" }
};

function getActiveModel() {
  return localStorage.getItem("nanu_model") || ($("modelSelect") ? $("modelSelect").value : "gemini-flash-lite-latest");
}

function setActiveModel(modelId, icon, name, showFeedback = true) {
  if (!modelId) return;
  const info = MODEL_DISPLAY_INFO[modelId] || { name: name || modelId, fullName: name || modelId, icon: icon || "⚡" };
  const targetIcon = icon || info.icon;
  const targetName = info.name;

  if (modelPillIcon) modelPillIcon.textContent = targetIcon;
  if (modelPillName) modelPillName.textContent = targetName;
  if ($("modelSelect")) $("modelSelect").value = modelId;
  localStorage.setItem("nanu_model", modelId);

  document.querySelectorAll(".model-menu-item").forEach(item => {
    item.classList.toggle("active", item.dataset.model === modelId);
  });

  if (showFeedback) {
    showToast(`Switched model to ${info.fullName || targetName} ${targetIcon}`);
  }
}

if (composerModelPill && composerModelMenu) {
  composerModelPill.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = composerModelMenu.hidden;
    composerModelMenu.hidden = !isHidden;
    composerModelPicker?.classList.toggle("open", isHidden);
  });

  document.querySelectorAll(".model-menu-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const modelId = item.dataset.model;
      const modelIcon = item.dataset.icon || "⚡";
      const modelName = item.dataset.name || "AI Model";
      setActiveModel(modelId, modelIcon, modelName, true);
      composerModelMenu.hidden = true;
      composerModelPicker?.classList.remove("open");
      inputBox.focus();
    });
  });

  document.addEventListener("click", (e) => {
    if (!composerModelPicker?.contains(e.target)) {
      composerModelMenu.hidden = true;
      composerModelPicker?.classList.remove("open");
    }
  });
}

if ($("modelSelect")) {
  $("modelSelect").addEventListener("change", (e) => {
    const val = e.target.value;
    const info = MODEL_DISPLAY_INFO[val] || { name: val, icon: "⚡" };
    setActiveModel(val, info.icon, info.name, false);
  });
}

// Attachment button & file upload
if (composerAddBtn && fileAttachmentInput) {
  composerAddBtn.addEventListener("click", () => {
    fileAttachmentInput.click();
  });
  fileAttachmentInput.addEventListener("change", () => {
    if (fileAttachmentInput.files && fileAttachmentInput.files.length > 0) {
      processFiles(fileAttachmentInput.files);
    }
    fileAttachmentInput.value = "";
  });
}

// Drag & drop handling onto chat area or composer
["dragenter", "dragover"].forEach(evt => {
  window.addEventListener(evt, e => {
    e.preventDefault();
    if (composer) composer.classList.add("drag-highlight");
  });
});

["dragleave", "drop"].forEach(evt => {
  window.addEventListener(evt, e => {
    e.preventDefault();
    if (composer) composer.classList.remove("drag-highlight");
  });
});

window.addEventListener("drop", e => {
  e.preventDefault();
  if (composer) composer.classList.remove("drag-highlight");
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    processFiles(e.dataTransfer.files);
  }
});

// Paste event (for screenshots or copied files/images)
window.addEventListener("paste", e => {
  if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
    processFiles(e.clipboardData.files);
  }
});

// Share chat button
if (shareChatBtn) {
  shareChatBtn.addEventListener("click", () => {
    const chat = currentId ? chats[currentId] : null;
    if (chat && chat.messages) {
      const text = chat.messages
        .filter(m => m.role !== "system")
        .map(m => (m.role === "user" ? "You: " : "N.A.N.U: ") + m.content)
        .join("\n\n");
      navigator.clipboard.writeText(text).then(() => {
        showToast("Chat conversation copied to clipboard! 🔗");
      });
    } else {
      navigator.clipboard.writeText(window.location.href).then(() => {
        showToast("Link copied to clipboard! 🔗");
      });
    }
  });
}



// Profile Menu
if (profileWidget && profileMenu) {
  profileWidget.addEventListener("click", (e) => {
    e.stopPropagation();
    profileMenu.hidden = !profileMenu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!profileMenu.contains(e.target) && !profileWidget.contains(e.target)) {
      profileMenu.hidden = true;
    }
  });
}

if (sysPromptMenu) {
  sysPromptMenu.addEventListener("click", () => {
    profileMenu.hidden = true;
    $("sysPromptTextarea").value = sysPrompt;
    openModal(sysPromptModal);
  });
}

if (profileEditMenu) {
  profileEditMenu.addEventListener("click", () => {
    profileMenu.hidden = true;
    resetProfileModal();
    openModal(profileModal);
    setTimeout(() => {
      const emailInput = $("profileEmailInput");
      if (emailInput) emailInput.focus();
    }, 100);
  });
}

if (clearAllMenu) {
  clearAllMenu.addEventListener("click", () => {
    profileMenu.hidden = true;
    resetClearChatsModal();
    openModal(clearChatsModal);
    setTimeout(() => {
      if (clearConfirmInput) clearConfirmInput.focus();
    }, 100);
  });
}

if (logoutBtnMenu) {
  logoutBtnMenu.addEventListener("click", () => {
    localStorage.removeItem("nanu_token");
    window.location.href = "/auth.html";
  });
}

// Suggestions Cards
document.querySelectorAll(".suggestion-card").forEach(card => {
  card.addEventListener("click", () => {
    const prompt = card.dataset.prompt;
    inputBox.value = prompt;
    autoGrow();
    updateSendButtonState();
    sendMessage(prompt);
  });
});

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    newChat();
    inputBox.focus();
  }
  if (e.key === "Escape") {
    if (streaming && abort) { abort.abort(); setStreaming(false); }
    closeModal(sysPromptModal);
    resetProfileModal();
    closeModal(profileModal);
    resetClearChatsModal();
    closeModal(clearChatsModal);
  }
});

// App Initialization
(function init() {
  const ids = Object.keys(chats);
  if (ids.length > 0) {
    const lastId = ids.sort((a, b) => chats[b].created - chats[a].created)[0];
    renderHistory();
    loadChat(lastId);
  } else {
    newChat();
  }
  const initTsEl = $("chatTimestamp");
  if (initTsEl) {
    const activeChat = currentId && chats[currentId] ? chats[currentId] : null;
    initTsEl.textContent = formatChatTimestamp(activeChat ? activeChat.created : new Date());
  }
  inputBox.focus();
  updateSendButtonState();

  if (window.innerWidth < 768) {
    sidebarOpen = false;
    sidebar.classList.add("sidebar-hidden");
    openSidebarBtn.style.display = "flex";
  }

  // Initialize Active Model in Search Bar & Settings
  const savedModel = localStorage.getItem("nanu_model") || "gemini-flash-lite-latest";
  const initialInfo = MODEL_DISPLAY_INFO[savedModel] || { name: "Flash", icon: "⚡" };
  setActiveModel(savedModel, initialInfo.icon, initialInfo.name, false);

  // Load server configured default free model if none set
  fetch("/api/config", { headers: { "Authorization": "Bearer " + userToken } })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.defaultModel) {
        if (!localStorage.getItem("nanu_model")) {
          const info = MODEL_DISPLAY_INFO[data.defaultModel] || { name: data.defaultModel, icon: "⚡" };
          setActiveModel(data.defaultModel, info.icon, info.name, false);
        } else if ($("modelSelect")) {
          $("modelSelect").value = localStorage.getItem("nanu_model");
        }
      }
    })
    .catch(() => {});

  // Load current user profile info
  fetch("/api/auth/me", { headers: { "Authorization": "Bearer " + userToken } })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.email) {
        window.userEmail = data.email;
        const profileEmailInput = $("profileEmailInput");
        if (profileEmailInput) profileEmailInput.value = "";
        const profileName = document.querySelector(".profile-name");
        if (profileName) profileName.textContent = data.email.split("@")[0];
      }
    })
    .catch(() => {});
})();


