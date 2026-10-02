import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_TOKEN = process.env.CLIENT_TOKEN;

let config = {
  openaiKey: process.env.LLM_API_KEY || "",
  openaiBaseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  geminiKey: process.env.GEMINI_API_KEY || "",
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  defaultModel: process.env.LLM_MODEL || "gemini-flash-lite-latest"
};

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(morgan("tiny"));
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

const USERS_FILE = path.join(__dirname, "users.json");
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}
function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function verify(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "").trim();
  if (CLIENT_TOKEN && CLIENT_TOKEN !== "change-this-client-token" && token === CLIENT_TOKEN) return next();
  
  const users = getUsers();
  if (token && users.find(u => u.token === token)) return next();
  
  return res.status(401).json({ error: "Unauthorized. Please log in." });
}

app.post("/api/auth/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const users = getUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: "User already exists" });
  
  const token = crypto.randomBytes(16).toString("hex");
  users.push({ email, password, token });
  saveUsers(users);
  res.json({ success: true, token });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  
  res.json({ success: true, token: user.token });
});

app.post("/api/auth/forgot-password", (req, res) => {
  const { email } = req.body;
  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: "Account not found" });
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otp = otp;
  user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  saveUsers(users);
  
  // Simulated email delivery via console
  console.log(`\n\n[AUTH SYSTEM] 🔑 Forgot Password OTP for ${email} is: ${otp}\n\n`);
  res.json({ success: true });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;
  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.otp !== otp || Date.now() > user.otpExpiry) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }
  
  user.password = newPassword;
  user.otp = null;
  user.token = crypto.randomBytes(16).toString("hex"); // Generate new token for security
  saveUsers(users);
  
  res.json({ success: true, token: user.token });
});

app.post("/api/auth/update-profile", verify, (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "").trim();
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "New password required" });
  
  const users = getUsers();
  const user = users.find(u => u.token === token);
  if (!user) return res.status(404).json({ error: "User not found" });
  
  user.password = newPassword;
  saveUsers(users);
  res.json({ success: true });
});

app.get("/api/config", verify, (_req, res) => {
  res.json({
    hasOpenAI: Boolean(config.openaiKey && !config.openaiKey.startsWith("sk-...")),
    hasGemini: Boolean(config.geminiKey),
    hasOpenRouter: Boolean(config.openrouterKey),
    defaultModel: config.defaultModel
  });
});

app.post("/api/settings", verify, (req, res) => {
  const { openaiKey, geminiKey, openrouterKey, defaultModel, openaiBaseUrl } = req.body || {};
  if (openaiKey !== undefined) config.openaiKey = openaiKey.trim();
  if (geminiKey !== undefined) config.geminiKey = geminiKey.trim();
  if (openrouterKey !== undefined) config.openrouterKey = openrouterKey.trim();
  if (defaultModel) config.defaultModel = defaultModel.trim();
  if (openaiBaseUrl) config.openaiBaseUrl = openaiBaseUrl.trim();

  try {
    const envPath = path.join(__dirname, ".env");
    let content = `PORT=${PORT}\nCLIENT_TOKEN=${CLIENT_TOKEN || "change-this-client-token"}\n`;
    content += `LLM_API_KEY=${config.openaiKey}\n`;
    content += `LLM_BASE_URL=${config.openaiBaseUrl}\n`;
    content += `LLM_MODEL=${config.defaultModel}\n`;
    content += `GEMINI_API_KEY=${config.geminiKey}\n`;
    content += `OPENROUTER_API_KEY=${config.openrouterKey}\n`;
    fs.writeFileSync(envPath, content, "utf8");
  } catch (err) {
    console.warn("Could not save to .env file:", err.message);
  }

  res.json({ success: true, config: { defaultModel: config.defaultModel } });
});

app.get("/api/models", verify, (_req, res) => {
  res.json({
    models: [
      { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite (Google — Fast, Multimodal & 100% Free)", provider: "gemini", isFree: true, recommended: true },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Google — Latest State of the Art & 100% Free)", provider: "gemini", isFree: true },
      { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite (Google — Ultra Fast & 100% Free)", provider: "gemini", isFree: true },
      { id: "gemini-flash-latest", name: "Gemini Flash Latest (Google AI Free Tier)", provider: "gemini", isFree: true },
      { id: "qwen/qwen3.8-27b:free", name: "Qwen 2.5 27B (OpenRouter — 100% Free, No Credits)", provider: "openrouter", isFree: true },
      { id: "nanu-smart", name: "NANU Smart Assistant (Local — Offline & 100% Free)", provider: "local", isFree: true }
    ]
  });
});

// Call OpenAI-Compatible API (OpenAI, OpenRouter, etc.)
async function callOpenAICompatibleAPI(messages, model, temperature, apiKey, baseUrl, res, extraHeaders = {}) {
  if (!apiKey) throw new Error("API key missing");

  // Format messages with multimodal attachments if present
  const formattedMessages = messages.map(m => {
    if (!m.attachments || !Array.isArray(m.attachments) || m.attachments.length === 0) {
      return { role: m.role, content: m.content || "" };
    }

    let textContent = m.content || "";
    const imageParts = [];

    for (const att of m.attachments) {
      if (att.extractedText) {
        textContent += `\n\n[Attached Document: ${att.name || "File"}]:\n${att.extractedText}`;
      }
      if (att.base64 && att.mimeType && att.mimeType.startsWith("image/")) {
        const fullUrl = att.base64.startsWith("data:")
          ? att.base64
          : `data:${att.mimeType};base64,${att.base64}`;
        imageParts.push({
          type: "image_url",
          image_url: { url: fullUrl }
        });
      }
    }

    if (imageParts.length > 0) {
      return {
        role: m.role,
        content: [
          { type: "text", text: textContent || "Please analyze the attached image." },
          ...imageParts
        ]
      };
    }

    return { role: m.role, content: textContent };
  });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 1),
      stream: true,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw { status: response.status, body: errText };
  }

  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    const str = decoder.decode(chunk, { stream: true });
    for (const line of str.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return true;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) res.write(delta);
      } catch {}
    }
  }
  return true;
}

async function callOpenAI(messages, model, temperature, customKey, res) {
  return callOpenAICompatibleAPI(
    messages, model, temperature, 
    customKey || config.openaiKey, 
    config.openaiBaseUrl, res
  );
}

// Call Google Gemini API with multimodal PDF & Image support
async function callGemini(messages, model, customKey, res) {
  const apiKey = customKey || config.geminiKey;
  if (!apiKey) throw new Error("Gemini API key missing");

  const contents = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const parts = [];

    // Multimodal attachments: images, PDFs, documents, audio voice notes
    if (m.attachments && Array.isArray(m.attachments)) {
      for (const att of m.attachments) {
        if (att.base64) {
          const cleanB64 = att.base64.replace(/^data:[^;]+;base64,/, "");
          const mime = att.mimeType || (att.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
          if (mime.startsWith("image/")) {
            parts.push({
              inlineData: {
                mimeType: mime,
                data: cleanB64
              }
            });
          } else if (mime === "application/pdf" && !att.extractedText) {
            parts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: cleanB64
              }
            });
          } else if (mime.startsWith("audio/")) {
            parts.push({
              inlineData: {
                mimeType: mime.split(";")[0],
                data: cleanB64
              }
            });
          }
        }
        if (att.extractedText) {
          const label = att.isVoiceNote ? "Voice Note Transcript" : `Attached Document: ${att.name || "File"}`;
          parts.push({
            text: `[${label}]:\n${att.extractedText}`
          });
        }
      }
    }

    let textContent = (m.content || "").trim();
    if (!textContent && parts.length > 0) {
      const hasAudio = m.attachments?.some(a => a.isVoiceNote || (a.mimeType && a.mimeType.startsWith("audio/")));
      textContent = hasAudio
        ? "Please listen to this voice note and respond helpfully and thoroughly to what was said."
        : "Please analyze the attached image / document and explain it in detail.";
    }
    if (textContent) {
      parts.push({ text: textContent });
    }

    if (parts.length > 0) {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts
      });
    }
  }

  // Ensure Gemini contents ends with a user turn
  while (contents.length > 0 && contents[contents.length - 1].role === "model") {
    contents.pop();
  }

  if (contents.length === 0) {
    throw new Error("No user messages provided for Gemini");
  }

  const sysMsg = messages.find(m => m.role === "system");
  const requestBody = {
    contents,
    generationConfig: { temperature: 0.7 }
  };
  if (sysMsg && sysMsg.content) {
    requestBody.systemInstruction = { parts: [{ text: sysMsg.content }] };
  }

  // Cascading free models: prioritize selected model, then ultra-fast free fallback models
  const rawCandidateModels = [
    model && model.startsWith("gemini") ? model : "gemini-flash-lite-latest",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.8-flash",
    "gemini-flash-latest"
  ];
  const candidateModels = [...new Set(rawCandidateModels)];
  let response = null;
  let lastErr = null;

  for (const mName of candidateModels) {
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (response.ok) break;
      lastErr = await response.text().catch(() => "");
    } catch (e) {
      lastErr = e.message;
    }
  }

  if (!response || !response.ok) {
    throw { status: response?.status || 500, body: lastErr || "Gemini API error" };
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!reply) throw new Error("Empty response from Gemini");

  const words = reply.split(" ");
  for (let i = 0; i < words.length; i++) {
    res.write(words[i] + (i < words.length - 1 ? " " : ""));
    if (i % 6 === 0) {
      await new Promise(r => setTimeout(r, 18));
    }
  }
  return true;
}

// Call OpenRouter
async function callOpenRouter(messages, model, customKey, res) {
  return callOpenAICompatibleAPI(
    messages, model, 0.7, 
    customKey || config.openrouterKey, 
    "https://openrouter.ai/api/v1", res,
    {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "NANU AI Assistant"
    }
  );
}

// Fallback intelligent answers for offline mode
async function streamFallback(prompt, res, notice = "") {
  if (notice) {
    res.write(notice + "\n\n");
  }

  const p = prompt.trim();
  const lower = p.toLowerCase();
  let answer = "";

  if (lower.includes("merge sort")) {
    answer = `Here is an efficient implementation of **Merge Sort** in Python:\n\n` +
`\`\`\`python
def merge_sort(arr):
    """Sort an array using the divide-and-conquer Merge Sort algorithm."""
    if len(arr) <= 1:
        return arr

    mid = len(arr) // 2
    left_half = merge_sort(arr[:mid])
    right_half = merge_sort(arr[mid:])

    return merge(left_half, right_half)

def merge(left, right):
    """Helper function to merge two sorted arrays."""
    sorted_list = []
    i = j = 0

    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            sorted_list.append(left[i])
            i += 1
        else:
            sorted_list.append(right[j])
            j += 1

    sorted_list.extend(left[i:])
    sorted_list.extend(right[j:])
    return sorted_list

# Example usage:
if __name__ == "__main__":
    sample_data = [38, 27, 43, 3, 9, 82, 10]
    print("Original array:", sample_data)
    sorted_data = merge_sort(sample_data)
    print("Sorted array:  ", sorted_data)
\`\`\`\n\n` +
`### Key Attributes:\n` +
`- **Time Complexity:** $O(n \\log n)$ in best, average, and worst cases.\n` +
`- **Space Complexity:** $O(n)$ auxiliary space.\n` +
`- **Stability:** Preserves relative order of duplicate elements.`;
  } else if (lower.includes("quantum computing")) {
    answer = `### Quantum Computing Explained Simply ⚛️\n\n` +
`Traditional computers use **bits** that represent either **0** (off) or **1** (on) — like a light switch.\n\n` +
`A **quantum computer** uses **Qubits** (quantum bits). Instead of just 0 or 1, a qubit can exist in a state called **Superposition**:\n\n` +
`1. **Superposition:** Like a spinning coin on a table, it is simultaneously heads and tails until you stop it to observe the result. This allows a quantum computer to evaluate millions of potential solutions simultaneously.\n` +
`2. **Entanglement:** Two qubits can become linked so that measuring one instantly determines the state of the other, enabling exponentially faster information exchange.\n\n` +
`### What Can Quantum Computers Do?\n` +
`- **Drug Discovery & Material Science:** Simulate molecular interactions at the atomic level.\n` +
`- **Optimization:** Solve complex logistical routing and financial portfolios in seconds.\n` +
`- **Cryptography:** Break and develop post-quantum secure cryptographic algorithms.`;
  } else if (lower.includes("startup") || lower.includes("ideas for 2025") || lower.includes("ideas")) {
    answer = `### 5 High-Potential AI Startup Ideas for 2025 💡\n\n` +
`1. **Autonomous Code Quality & Security Auditor (Agentic CI/CD):** An AI engineer that automatically forks branches, writes unit tests, and patches security vulnerabilities before PR review.\n` +
`2. **Adaptive Personalized AI Tutor:** A real-time voice and visual tutor that dynamically adapts explanations and pace to student comprehension markers.\n` +
`3. **Regulatory & Compliance Copilot:** Continuous AI auditing of enterprise codebases, data pipelines, and privacy compliance (EU AI Act, HIPAA, SOC 2).\n` +
`4. **Multimodal Synthetic Video & Audio Localization:** Instant video translation that preserves speaker timbre, cadence, and dynamically adjusts lip-sync in 80+ languages.\n` +
`5. **Autonomous Supply Chain & Logistics Dispatcher:** Negotiates vendor delivery slots, resolves shipping delays, and re-routes freight autonomously.`;
  } else if (lower.includes("rest") && (lower.includes("graphql") || lower.includes("grpc"))) {
    answer = `### Comparison: REST vs. GraphQL vs. gRPC 📡\n\n` +
`| Feature | REST | GraphQL | gRPC |\n` +
`| :--- | :--- | :--- | :--- |\n` +
`| **Protocol** | HTTP/1.1 or HTTP/2 | HTTP/1.1 or HTTP/2 | HTTP/2 (binary transport) |\n` +
`| **Payload Format** | JSON / XML | JSON | Protocol Buffers (Binary) |\n` +
`| **Data Fetching** | Fixed endpoints per entity | Client specifies exact query fields | Method calls defined in .proto schema |\n` +
`| **Over/Under-fetching** | Frequent issue | Completely solved | Solved via strongly-typed contracts |\n` +
`| **Performance** | Standard | Overhead of parsing query string | Ultra high-speed & minimal latency |\n` +
`| **Best Used For** | Public web APIs & simple CRUD | Web & mobile apps with nested data | Microservice-to-microservice communication |`;
  } else {
    answer = `Here is assistance with: **${p}**\n\n` +
`NANU is online and ready to assist with coding, debugging, general knowledge, reasoning, and search.\n\n` +
`Tip: You can ask any question, and NANU will process and generate answers in real-time.`;
  }

  const words = answer.split(" ");
  for (let i = 0; i < words.length; i++) {
    res.write(words[i] + (i < words.length - 1 ? " " : ""));
    if (i % 5 === 0) {
      await new Promise(r => setTimeout(r, 20));
    }
  }
}

app.post("/api/chat", verify, async (req, res) => {
  const {
    messages = [],
    temperature = 0.7,
    model = config.defaultModel || "gemini-flash-latest",
    system = null,
    apiKey = null
  } = req.body || {};

  // Clean and validate messages array
  const cleanMessages = messages.filter(m => (m.content && String(m.content).trim()) || (m.attachments && m.attachments.length > 0));
  for (const m of cleanMessages) {
    if (!m.content && m.attachments && m.attachments.length > 0) {
      m.content = "Please analyze the attached document / image in detail.";
    }
  }
  while (cleanMessages.length > 0 && cleanMessages[cleanMessages.length - 1].role === "assistant") {
    cleanMessages.pop();
  }

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: "messages array cannot be empty" });
  }

  const systemContent = system || "You are NANU, a fast, intelligent, helpful AI assistant. Format code in markdown.";
  const finalMessages = [
    { role: "system", content: systemContent },
    ...cleanMessages.filter(m => m.role !== "system")
  ];

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const lastUserMsg = cleanMessages.filter(m => m.role === "user").pop()?.content || "";

  // 1. Dedicated Local
  if (model === "nanu-smart") {
    await streamFallback(lastUserMsg, res);
    res.end();
    return;
  }

  // 2. Gemini model
  if (model.startsWith("gemini")) {
    try {
      await callGemini(finalMessages, model, apiKey, res);
      res.end();
      return;
    } catch (err) {
      console.warn("Gemini service error, attempting OpenRouter/fallback:", err.message || err);
      if (config.openrouterKey) {
        try {
          res.write("> ℹ️ *Note: Routed to OpenRouter AI:* \n\n");
          await callOpenRouter(finalMessages, "qwen/qwen3.8-27b:free", null, res);
          res.end();
          return;
        } catch (orErr) {}
      }
      await streamFallback(lastUserMsg, res, `> ⚠️ *Live AI is currently busy. Answered via NANU engine:*`);
      res.end();
      return;
    }
  }

  // 3. OpenRouter model
  if (model.includes("/") || model.endsWith(":free")) {
    try {
      await callOpenRouter(finalMessages, model, apiKey, res);
      res.end();
      return;
    } catch (err) {
      console.warn("OpenRouter busy, falling back to Gemini:", err.message || err);
      if (config.geminiKey) {
        try {
          res.write("> ℹ️ *Note: Routed to Gemini:* \n\n");
          await callGemini(finalMessages, "gemini-flash-lite-latest", null, res);
          res.end();
          return;
        } catch (gErr) {}
      }
      await streamFallback(lastUserMsg, res, `> ⚠️ *Rate limit reached. Answered via NANU engine:*`);
      res.end();
      return;
    }
  }

  // 4. OpenAI model
  try {
    await callOpenOpenAIWithFallback(finalMessages, model, temperature, apiKey, lastUserMsg, res);
  } catch (err) {
    console.error("OpenAI execution error:", err);
    if (!res.writableEnded) {
      res.end("Proxy error: " + (err.message || JSON.stringify(err)));
    }
  }
});

async function callOpenOpenAIWithFallback(finalMessages, model, temperature, apiKey, lastUserMsg, res) {
  try {
    await callOpenAI(finalMessages, model, temperature, apiKey, res);
    res.end();
  } catch (err) {
    const isQuotaExhausted = err.status === 429 || (typeof err.body === "string" && (err.body.includes("insufficient_quota") || err.body.includes("credit_balance_exhausted")));

    if (isQuotaExhausted) {
      console.log("OpenAI quota exhausted. Seamlessly routing to Google Gemini...");
      
      if (config.geminiKey) {
        try {
          res.write("> ℹ️ *Note: Your OpenAI key has 0 prepaid credits remaining. NANU answered via Google Gemini:* \n\n");
          await callGemini(finalMessages, "gemini-flash-lite-latest", null, res);
          res.end();
          return;
        } catch (gErr) {
          console.warn("Gemini call during OpenAI fallback error:", gErr);
        }
      }

      if (config.openrouterKey) {
        try {
          res.write("> ℹ️ *Note: Your OpenAI key has 0 prepaid credits remaining. NANU answered via OpenRouter AI:* \n\n");
          await callOpenRouter(finalMessages, "qwen/qwen3.8-27b:free", null, res);
          res.end();
          return;
        } catch (orErr) {}
      }

      const notice = `> ℹ️ *Note: OpenAI API has 0 prepaid credits. Add credits at platform.openai.com/billing or configure Gemini in Settings.*`;
      await streamFallback(lastUserMsg, res, notice);
      res.end();
      return;
    }

    if (err.status) {
      res.statusCode = err.status;
      res.end(err.body || "OpenAI upstream error");
    } else {
      res.statusCode = 500;
      res.end(err.message || "Unknown error");
    }
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, model: config.defaultModel }));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
