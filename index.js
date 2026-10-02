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
      { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite — Fastest & 100% Free", provider: "gemini", isFree: true, recommended: true },
      { id: "gemini-2.0-flash-thinking-exp-01-21", name: "Gemini 2.5 Flash — Reasoning & 100% Free", provider: "gemini", isFree: true },
      { id: "nanu-smart", name: "NANU Smart — Offline Local Engine", provider: "local", isFree: true }
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

  // For Gemini 2.5 Flash: enable thinking mode for spectacular reasoning
  const isThinkingModel = model === "gemini-2.0-flash-thinking-exp-01-21";
  if (isThinkingModel) {
    requestBody.generationConfig = {
      ...requestBody.generationConfig,
      thinkingConfig: { thinkingBudget: 8192 }
    };
  }

  // Cascading: try selected model first, then stable fallback
  const rawCandidateModels = [
    model && model.startsWith("gemini") ? model : "gemini-flash-lite-latest",
    "gemini-flash-lite-latest"
  ];
  const candidateModels = [...new Set(rawCandidateModels)];

  for (const mName of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${mName}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errTxt = await response.text().catch(() => "");
        console.warn(`Gemini candidate ${mName} status: ${response.status}`, errTxt.slice(0, 200));
        continue;
      }

      const decoder = new TextDecoder();
      let streamHasText = false;

      for await (const chunk of response.body) {
        const str = decoder.decode(chunk, { stream: true });
        for (const line of str.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          try {
            const json = JSON.parse(dataStr);
            const parts = json.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.text) {
                res.write(p.text);
                streamHasText = true;
              }
            }
          } catch (e) {}
        }
      }

      if (streamHasText) {
        return true;
      }
    } catch (e) {
      console.warn(`Gemini candidate ${mName} stream error:`, e.message);
    }
  }

  // Backup fallback: non-streaming generateContent on fastest verified model
  for (const fallbackModel of ["gemini-flash-lite-latest", "gemini-3.1-flash-lite-preview"]) {
    try {
      const fbRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        }
      );
      if (fbRes.ok) {
        const data = await fbRes.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        let text = "";
        for (const p of parts) {
          if (p.text) text += p.text;
        }
        if (text) {
          res.write(text);
          return true;
        }
      }
    } catch (e) {}
  }

  throw new Error("Empty response from Gemini");
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

// NANU Smart — Comprehensive Local AI Engine (No API required)
async function streamFallback(prompt, res, notice = "") {
  if (notice) {
    res.write(notice + "\n\n");
  }

  const p = prompt.trim();
  const lower = p.toLowerCase();

  function pickAnswer() {
    // Greetings
    if (/^(hi|hello|hey|howdy|sup|yo|hiya|good (morning|afternoon|evening)|namaste)[!?\s]*$/i.test(p.trim())) {
      return `# Hey there! 👋\n\nI'm **NANU**, your intelligent AI assistant running in **Offline Mode**.\n\nI can help with:\n- 💻 **Algorithms** — sorting, searching, data structures\n- 🐍 **Python / JS / TS** — code examples and explanations\n- ⚛️ **React / Node.js** — components, hooks, APIs\n- 🗄️ **SQL** — queries, joins, schema design\n- 🐙 **Git / Docker / Linux** — commands and workflows\n- 🤖 **AI/ML** — concepts, architectures, use cases\n\nWhat would you like to explore?`;
    }

    // Identity
    if (/who are you|what are you|what is nanu|introduce yourself|tell me about yourself/i.test(lower)) {
      return `# I'm N.A.N.U 🤖\n\n**NANU** stands for **Neural Adaptive Network Utility** — a fast, intelligent AI assistant built to help with coding, learning, and problem-solving.\n\n### Capabilities\n| Area | Details |\n|:---|:---|\n| 💻 Code | Write, debug, review any language |\n| 📖 Explain | Break down complex topics simply |\n| 🧮 Math | Equations, algorithms, proofs |\n| 🌐 Web Dev | HTML, CSS, JS, React, Node.js |\n| 🗄️ Databases | SQL, NoSQL, schema design |\n| 🐧 DevOps | Git, Docker, Linux, CI/CD |\n\n> Currently running in **Offline Mode** — no internet, no API key needed!`;
    }

    // How are you
    if (/how are you|how do you do|what.?s up|are you ok/i.test(lower)) {
      return `I'm doing great, thank you! ⚡\n\nRunning in **Offline Mode** — fast, local, and privacy-first. No data leaves your device.\n\nWhat can I help you with today?`;
    }

    // Merge Sort
    if (lower.includes("merge sort")) {
      return `## Merge Sort 🔀\n\n\`\`\`python\ndef merge_sort(arr):\n    if len(arr) <= 1: return arr\n    mid = len(arr) // 2\n    left = merge_sort(arr[:mid])\n    right = merge_sort(arr[mid:])\n    return merge(left, right)\n\ndef merge(left, right):\n    result, i, j = [], 0, 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            result.append(left[i]); i += 1\n        else:\n            result.append(right[j]); j += 1\n    return result + left[i:] + right[j:]\n\nprint(merge_sort([38, 27, 43, 3, 9, 82, 10]))\n# Output: [3, 9, 10, 27, 38, 43, 82]\n\`\`\`\n\n| Case | Time | Space |\n|:---|:---|:---|\n| All cases | O(n log n) | O(n) |\n\n✅ **Stable** — preserves order of equal elements.`;
    }

    // Quick Sort
    if (lower.includes("quick sort") || lower.includes("quicksort")) {
      return `## Quick Sort ⚡\n\n\`\`\`python\ndef quick_sort(arr):\n    if len(arr) <= 1: return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    mid = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quick_sort(left) + mid + quick_sort(right)\n\nprint(quick_sort([3, 6, 8, 10, 1, 2, 1]))\n# Output: [1, 1, 2, 3, 6, 8, 10]\n\`\`\`\n\n| Case | Time |\n|:---|:---|\n| Best/Average | O(n log n) |\n| Worst | O(n²) |`;
    }

    // Binary Search
    if (lower.includes("binary search")) {
      return `## Binary Search 🔍\n\n\`\`\`python\ndef binary_search(arr, target):\n    left, right = 0, len(arr) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if arr[mid] == target: return mid\n        elif arr[mid] < target: left = mid + 1\n        else: right = mid - 1\n    return -1\n\narr = [1, 3, 5, 7, 9, 11]\nprint(binary_search(arr, 7))  # Output: 3\n\`\`\`\n\n| | Value |\n|:---|:---|\n| Time | O(log n) |\n| Space | O(1) |\n| Requirement | Array must be **sorted** |`;
    }

    // Fibonacci
    if (lower.includes("fibonacci")) {
      return `## Fibonacci Sequence 🌀\n\n**Three approaches:**\n\n**1. Recursive — O(2ⁿ)**\n\`\`\`python\ndef fib(n):\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)\n\`\`\`\n\n**2. Dynamic Programming — O(n)**\n\`\`\`python\ndef fib_dp(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint(fib_dp(10))  # 55\n\`\`\``;
    }

    // JavaScript / Async
    if (lower.includes("javascript") || lower.includes("async await") || lower.includes("promise") || lower.includes("arrow function")) {
      return `## JavaScript — Key Concepts 🟨\n\n### Async/Await\n\`\`\`javascript\nasync function fetchData(url) {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error("HTTP " + res.status);\n    return await res.json();\n  } catch (err) {\n    console.error("Failed:", err.message);\n  }\n}\n\`\`\`\n\n### Array Methods\n\`\`\`javascript\nconst nums = [1, 2, 3, 4, 5];\nnums.map(x => x * 2);           // [2, 4, 6, 8, 10]\nnums.filter(x => x > 2);        // [3, 4, 5]\nnums.reduce((a, b) => a + b, 0); // 15\n\`\`\`\n\n### Destructuring\n\`\`\`javascript\nconst { name, age, ...rest } = { name: "Alice", age: 25, city: "NY" };\nconst [first, ...others] = [1, 2, 3, 4];\n\`\`\``;
    }

    // Python
    if (lower.includes("python") && !lower.includes("sort") && !lower.includes("search") && !lower.includes("fibonacci")) {
      return `## Python — Quick Reference 🐍\n\n### List Comprehensions\n\`\`\`python\nresult = [x**2 for x in range(10) if x % 2 == 0]\n# [0, 4, 16, 36, 64]\n\`\`\`\n\n### Classes & OOP\n\`\`\`python\nclass Animal:\n    def __init__(self, name, sound):\n        self.name = name\n        self.sound = sound\n    def speak(self):\n        return f"{self.name} says {self.sound}!"\n\nclass Dog(Animal):\n    def fetch(self):\n        return f"{self.name} fetches! 🎾"\n\ndog = Dog("Rex", "Woof")\nprint(dog.speak())  # Rex says Woof!\n\`\`\``;
    }

    // React
    if (lower.includes("react") || lower.includes("usestate") || lower.includes("useeffect")) {
      return `## React Hooks ⚛️\n\n### useState\n\`\`\`jsx\nimport { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(c => c + 1)}>+1</button>\n    </div>\n  );\n}\n\`\`\`\n\n### useEffect\n\`\`\`jsx\nimport { useEffect, useState } from "react";\n\nfunction Fetcher({ url }) {\n  const [data, setData] = useState(null);\n  useEffect(() => {\n    fetch(url).then(r => r.json()).then(setData);\n  }, [url]);\n  return <pre>{JSON.stringify(data, null, 2)}</pre>;\n}\n\`\`\``;
    }

    // Node / Express / API
    if (lower.includes("express") || lower.includes("nodejs") || lower.includes("node.js") || (lower.includes("api") && lower.includes("rest"))) {
      return `## Express.js REST API 🟢\n\n\`\`\`javascript\nimport express from "express";\nconst app = express();\napp.use(express.json());\n\nconst items = [];\n\napp.get("/api/items", (req, res) => res.json(items));\n\napp.post("/api/items", (req, res) => {\n  const { name } = req.body;\n  if (!name) return res.status(400).json({ error: "Name required" });\n  const item = { id: Date.now(), name };\n  items.push(item);\n  res.status(201).json(item);\n});\n\napp.delete("/api/items/:id", (req, res) => {\n  const idx = items.findIndex(i => i.id === +req.params.id);\n  if (idx === -1) return res.status(404).json({ error: "Not found" });\n  items.splice(idx, 1);\n  res.json({ success: true });\n});\n\napp.listen(3000, () => console.log("Server running on http://localhost:3000"));\n\`\`\``;
    }

    // SQL
    if (lower.includes("sql") || lower.includes("database") || lower.includes("join") || lower.includes("mysql") || lower.includes("postgres")) {
      return `## SQL — Essential Queries 🗄️\n\n\`\`\`sql\n-- Create table\nCREATE TABLE users (\n  id    SERIAL PRIMARY KEY,\n  name  VARCHAR(100) NOT NULL,\n  email VARCHAR(150) UNIQUE NOT NULL,\n  created_at TIMESTAMP DEFAULT NOW()\n);\n\n-- Read with filter\nSELECT id, name, email\nFROM users\nWHERE name LIKE "A%" ORDER BY name;\n\n-- JOIN — all users with their orders\nSELECT u.name, COUNT(o.id) AS order_count\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nGROUP BY u.id\nORDER BY order_count DESC;\n\`\`\``;
    }

    // Git
    if (lower.includes("git") || lower.includes("github") || lower.includes("commit") || lower.includes("branch")) {
      return `## Git — Essential Commands 🐙\n\n\`\`\`bash\n# Setup\ngit init && git clone <url>\n\n# Daily workflow\ngit status\ngit add .\ngit commit -m "feat: add feature"\ngit push origin main\ngit pull origin main\n\n# Branching\ngit checkout -b feature/new-ui\ngit merge feature/new-ui\ngit branch -d feature/new-ui\n\n# Undo\ngit reset --soft HEAD~1   # undo last commit, keep changes\ngit stash                  # save dirty work temporarily\ngit stash pop              # restore stashed work\ngit log --oneline -10      # view recent commits\n\`\`\``;
    }

    // Docker
    if (lower.includes("docker") || lower.includes("container") || lower.includes("dockerfile")) {
      return `## Docker 🐳\n\n### Dockerfile\n\`\`\`dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]\n\`\`\`\n\n### Commands\n\`\`\`bash\ndocker build -t myapp .\ndocker run -p 3000:3000 myapp\ndocker ps\ndocker logs <id>\ndocker exec -it <id> sh\n\`\`\``;
    }

    // Linux
    if (lower.includes("linux") || lower.includes("bash") || lower.includes("terminal") || lower.includes("shell command")) {
      return `## Linux — Essential Commands 🐧\n\n\`\`\`bash\n# Files\nls -lah && cd /path\nmkdir -p src/utils\ncp -r source/ dest/\nrm -rf old_folder/\nfind . -name "*.js"\n\n# Processes\nps aux | grep node\nkill -9 <pid>\n\n# Networking\ncurl -X POST http://localhost:3000/api \\\n  -H "Content-Type: application/json" \\\n  -d "{\"key\":\"value\"}"\nnetstat -tlnp\n\`\`\``;
    }

    // Machine Learning / AI
    if (lower.includes("machine learning") || lower.includes("neural network") || lower.includes("deep learning") || lower.includes("artificial intelligence")) {
      return `## AI & Machine Learning 🤖\n\n### Types of ML\n| Type | How | Example |\n|:---|:---|:---|\n| **Supervised** | Labeled data | Spam detection |\n| **Unsupervised** | Patterns in unlabeled data | Customer clustering |\n| **Reinforcement** | Trial & reward | Game AI |\n\n### Neural Network Architecture\n\`\`\`\nInput Layer → Hidden Layers → Output Layer\n   (data)    (feature extraction)  (prediction)\n\`\`\`\n\n### Key Algorithms\n- **Linear Regression** — predict continuous values\n- **Logistic Regression** — binary classification\n- **Random Forest** — ensemble, interpretable\n- **CNN** — images\n- **Transformer / LLM** — language tasks`;
    }

    // Quantum
    if (lower.includes("quantum")) {
      return `## Quantum Computing ⚛️\n\n### 3 Key Principles\n1. **Superposition** — A qubit can be 0, 1, or both simultaneously\n2. **Entanglement** — Linked qubits share state instantly\n3. **Interference** — Correct answers amplified, wrong ones cancelled\n\n### Applications\n| Area | Why Quantum |\n|:---|:---|\n| Cryptography | Break RSA, build quantum-safe algorithms |\n| Drug Discovery | Simulate molecules precisely |\n| Optimization | Solve logistics & financial problems |\n\n> Quantum computers are still in the **NISQ era**. Full fault-tolerant systems expected in 2030s.`;
    }

    // REST vs GraphQL vs gRPC
    if (lower.includes("rest") && (lower.includes("graphql") || lower.includes("grpc"))) {
      return `## REST vs GraphQL vs gRPC 📡\n\n| Feature | REST | GraphQL | gRPC |\n|:---|:---|:---|:---|\n| Protocol | HTTP/1.1 | HTTP/1.1 | HTTP/2 |\n| Format | JSON | JSON | Protocol Buffers |\n| Fetching | Fixed endpoints | Client controls fields | Typed methods |\n| Performance | Good | Good | Excellent |\n| Best For | Public APIs | Complex apps | Microservices |`;
    }

    // Startup ideas
    if (lower.includes("startup") || lower.includes("business idea")) {
      return `## 🚀 High-Potential AI Startup Ideas (2025)\n\n1. **Autonomous Code Auditor** — AI that patches security vulnerabilities before PR review\n2. **Personalized AI Tutor** — Adapts explanations to student comprehension in real-time\n3. **Regulatory Compliance Copilot** — Audits codebases for GDPR, HIPAA, EU AI Act\n4. **Synthetic Video Localizer** — Translates video with voice preservation and lip-sync\n5. **AI Legal Analyzer** — Flags risky clauses in contracts instantly\n6. **Predictive Health Screening** — Analyzes wearable data to predict health events`;
    }

    // Thanks
    if (/thank(s| you)|great job|well done|awesome|perfect|nice/i.test(lower)) {
      return `You're welcome! 😊 Always happy to help.\n\nFeel free to ask anything — algorithms, code, concepts, or career advice. I'm here! 🚀`;
    }

    // What can you do
    if (lower.includes("what can you do") || lower.includes("help me") || lower.includes("how do you work") || lower.includes("capabilities")) {
      return `## What NANU Can Do 🧠\n\n### 💻 Offline Mode (NANU Smart — active now)\nBuilt-in knowledge for:\n- Algorithms: sorting, searching, trees, graphs\n- Python, JavaScript, TypeScript\n- React, Node.js, Express\n- SQL, Git, Docker, Linux\n- AI/ML concepts\n\n### 🌐 Online Mode (Switch to Gemini Flash Lite)\n- Answer ANY question with live AI\n- Analyze images, PDFs, voice notes\n- Deep reasoning with Gemini 2.5 Flash`;
    }

    // Generic intelligent fallback
    const topic = p.length > 70 ? p.slice(0, 67) + "..." : p;
    return `## Let me help! 💡\n\nYou asked: *"${topic}"*\n\nI'm **NANU Smart** in **Offline Mode**. I have built-in knowledge for:\n\n| Topic | Try asking... |\n|:---|:---|\n| 💻 Algorithms | "merge sort", "binary search" |\n| 🐍 Python / JS | "Python classes", "async await" |\n| ⚛️ React | "useState example", "useEffect" |\n| 🗄️ SQL | "SQL joins", "write a query" |\n| 🐙 Git | "git commands", "how to branch" |\n| 🐳 Docker | "Dockerfile example" |\n| 🐧 Linux | "linux commands cheatsheet" |\n| 🤖 AI/ML | "machine learning basics" |\n\n> 💡 Switch to **⚡ Gemini Flash Lite** for full AI answers on any topic!`;
  }

  const answer = pickAnswer();
  const words = answer.split(" ");
  for (let i = 0; i < words.length; i++) {
    res.write(words[i] + (i < words.length - 1 ? " " : ""));
    if (i % 8 === 0) {
      await new Promise(r => setTimeout(r, 15));
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


