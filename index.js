import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

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
  defaultModel: process.env.LLM_MODEL || "gemini-flash-lite-latest",
  emailUser: process.env.EMAIL_USER || process.env.SMTP_USER || "",
  emailPass: process.env.EMAIL_PASS || process.env.SMTP_PASS || "",
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: parseInt(process.env.SMTP_PORT || "465", 10)
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
  const users = getUsers();
  const foundUser = token ? users.find(u => u.token === token) : null;
  if (foundUser) {
    req.user = foundUser;
    return next();
  }
  if (CLIENT_TOKEN && CLIENT_TOKEN !== "change-this-client-token" && token === CLIENT_TOKEN) {
    req.user = users[0] || null;
    return next();
  }
  
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

async function sendEmailOtp(toEmail, otp) {
  if (!config.emailUser || !config.emailPass) {
    console.warn(`\n[EMAIL SYSTEM] ⚠️ Live email dispatch is not configured: EMAIL_USER or EMAIL_PASS missing in .env.\n`);
    return {
      sent: false,
      notConfigured: true,
      error: "Live email dispatch is not configured. Please add your Gmail address and 16-character Gmail App Password in Settings (⚙️) or in your .env file (EMAIL_USER & EMAIL_PASS) so N.A.N.U can deliver OTPs directly to your inbox."
    };
  }

  try {
    const isGmail = config.emailUser.toLowerCase().endsWith("@gmail.com");
    const cleanPass = config.emailPass.replace(/\s+/g, ""); // strip any spaces from Google App Password
    const transporter = nodemailer.createTransport({
      service: isGmail ? "gmail" : undefined,
      host: isGmail ? undefined : config.smtpHost,
      port: isGmail ? undefined : config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.emailUser,
        pass: cleanPass
      }
    });

    const info = await transporter.sendMail({
      from: `"N.A.N.U AI" <${config.emailUser}>`,
      to: toEmail,
      subject: `Your N.A.N.U Verification Code: ${otp}`,
      text: `Your N.A.N.U verification code is: ${otp}. It will expire in 10 minutes.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; padding: 40px 20px; text-align: center;">
          <div style="max-width: 480px; margin: 0 auto; background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
            <div style="font-size: 26px; font-weight: 800; color: #38bdf8; margin-bottom: 6px;">⚡ N.A.N.U AI</div>
            <h2 style="font-size: 20px; font-weight: 600; color: #fff; margin: 0 0 14px;">Verification Code</h2>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px;">Use the 6-digit verification code below to verify your email. This code will expire in 10 minutes.</p>
            <div style="background: rgba(56, 189, 248, 0.1); border: 2px dashed #0284c7; border-radius: 12px; padding: 16px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; display: inline-block; margin-bottom: 20px;">
              ${otp}
            </div>
            <p style="font-size: 12px; color: #64748b; margin: 0; border-top: 1px solid #1e293b; padding-top: 14px;">If you did not request this verification code, please ignore this email.</p>
          </div>
        </div>
      `
    });

    console.log(`\n[EMAIL SYSTEM] ✉️ Real email successfully delivered to ${toEmail}! MessageId: ${info.messageId}\n`);
    return { sent: true };
  } catch (err) {
    console.error(`\n[EMAIL SYSTEM] ❌ SMTP delivery failed for ${toEmail}: ${err.message}\n`);
    return {
      sent: false,
      error: `Email delivery failed: ${err.message}. Please verify your Gmail address and App Password.`
    };
  }
}

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email address required" });

  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: "No account found with that email address" });
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.otp = otp;
  user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  saveUsers(users);
  
  const emailRes = await sendEmailOtp(user.email, otp);
  if (!emailRes.sent) {
    return res.status(400).json({
      error: emailRes.error || "Email delivery failed. Please check your SMTP configuration."
    });
  }

  // The OTP is strictly sent only to the user's email inbox — NEVER returned to the client
  return res.json({
    success: true,
    email: user.email,
    sent: true,
    message: "A 6-digit verification OTP has been sent to your email. Please check your inbox and spam folder."
  });
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

app.get("/api/auth/me", verify, (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ email: user.email });
});

app.post("/api/auth/send-profile-otp", verify, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ error: "User not found" });
  const { email } = req.body || {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
    return res.status(400).json({ error: `The entered email (${email}) does not match your registered account email.` });
  }

  const users = getUsers();
  const targetUser = users.find(u => u.email.toLowerCase() === user.email.toLowerCase());
  if (!targetUser) return res.status(404).json({ error: "User not found" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  targetUser.otp = otp;
  targetUser.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  saveUsers(users);

  const emailRes = await sendEmailOtp(targetUser.email, otp);
  if (!emailRes.sent) {
    return res.status(400).json({
      error: emailRes.error || "Email delivery failed. Please check your SMTP configuration."
    });
  }

  // Strictly deliver to email only — never return OTP in response
  return res.json({
    success: true,
    email: targetUser.email,
    sent: true,
    message: `✓ A 6-digit verification OTP has been sent to your registered email (${targetUser.email}). Please check your inbox and spam folder.`
  });
});

app.post("/api/auth/verify-profile-otp", verify, (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ error: "User not found" });

  const { email, otp } = req.body || {};
  if (!otp || String(otp).trim().length !== 6) {
    return res.status(400).json({ error: "Please enter the complete 6-digit OTP code." });
  }

  const users = getUsers();
  const targetUser = users.find(u => u.email.toLowerCase() === user.email.toLowerCase());
  if (!targetUser) return res.status(404).json({ error: "User not found" });

  if (email && email.trim().toLowerCase() !== targetUser.email.toLowerCase()) {
    return res.status(400).json({ error: "Email does not match your registered account." });
  }

  if (!targetUser.otp || targetUser.otp !== String(otp).trim() || Date.now() > targetUser.otpExpiry) {
    return res.status(400).json({ error: "Invalid or expired OTP code. Please click Resend OTP if needed." });
  }

  res.json({ success: true, message: "OTP confirmed successfully." });
});

app.post("/api/auth/update-profile", verify, (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ error: "User not found" });

  const { email, otp, newPassword } = req.body;
  if (!otp) return res.status(400).json({ error: "OTP verification code is required" });
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  const users = getUsers();
  const targetUser = users.find(u => u.email.toLowerCase() === user.email.toLowerCase());
  if (!targetUser) return res.status(404).json({ error: "User not found" });

  if (email && email.trim().toLowerCase() !== targetUser.email.toLowerCase()) {
    return res.status(400).json({ error: "Email does not match your registered account." });
  }

  if (!targetUser.otp || targetUser.otp !== String(otp).trim() || Date.now() > targetUser.otpExpiry) {
    return res.status(400).json({ error: "Invalid or expired OTP code. Please request a new code." });
  }

  targetUser.password = newPassword;
  targetUser.otp = null;
  targetUser.otpExpiry = null;
  saveUsers(users);

  console.log(`\n\n[AUTH SYSTEM] ✅ Password successfully updated for ${targetUser.email}!\n\n`);
  res.json({ success: true, message: "Password updated successfully" });
});

app.get("/api/config", verify, (_req, res) => {
  res.json({
    hasOpenAI: Boolean(config.openaiKey && !config.openaiKey.startsWith("sk-...")),
    hasGemini: Boolean(config.geminiKey),
    hasOpenRouter: Boolean(config.openrouterKey),
    hasEmailSmtp: Boolean(config.emailUser && config.emailPass),
    emailUser: config.emailUser || "",
    defaultModel: config.defaultModel
  });
});

app.post("/api/settings", verify, (req, res) => {
  const { openaiKey, geminiKey, openrouterKey, defaultModel, openaiBaseUrl, emailUser, emailPass } = req.body || {};
  if (openaiKey !== undefined) config.openaiKey = openaiKey.trim();
  if (geminiKey !== undefined) config.geminiKey = geminiKey.trim();
  if (openrouterKey !== undefined) config.openrouterKey = openrouterKey.trim();
  if (defaultModel) config.defaultModel = defaultModel.trim();
  if (openaiBaseUrl) config.openaiBaseUrl = openaiBaseUrl.trim();
  if (emailUser !== undefined) config.emailUser = emailUser.trim();
  if (emailPass !== undefined && emailPass.trim() !== "") config.emailPass = emailPass.trim().replace(/\s+/g, "");

  try {
    const envPath = path.join(__dirname, ".env");
    let content = `PORT=${PORT}\nCLIENT_TOKEN=${CLIENT_TOKEN || "change-this-client-token"}\n`;
    content += `LLM_API_KEY=${config.openaiKey}\n`;
    content += `LLM_BASE_URL=${config.openaiBaseUrl}\n`;
    content += `LLM_MODEL=${config.defaultModel}\n`;
    content += `GEMINI_API_KEY=${config.geminiKey}\n`;
    content += `OPENROUTER_API_KEY=${config.openrouterKey}\n`;
    if (config.emailUser) content += `EMAIL_USER=${config.emailUser}\n`;
    if (config.emailPass) content += `EMAIL_PASS=${config.emailPass}\n`;
    fs.writeFileSync(envPath, content, "utf8");
  } catch (err) {
    console.warn("Could not save to .env file:", err.message);
  }

  res.json({
    success: true,
    hasEmailSmtp: Boolean(config.emailUser && config.emailPass),
    emailUser: config.emailUser || "",
    config: { defaultModel: config.defaultModel }
  });
});

app.get("/api/models", verify, (_req, res) => {
  res.json({
    models: [
      { id: "gemini-flash-lite-latest", name: "N.A.N.U Flash — Fastest & Free", provider: "gemini", isFree: true, recommended: true },
      { id: "gemini-2.0-flash", name: "N.A.N.U Pro — Deep Reasoning & Free", provider: "gemini", isFree: true },
      { id: "nanu-smart", name: "N.A.N.U Smart — Offline Engine", provider: "local", isFree: true }
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

  // Model mapping & thinking mode
  const mappedModel = model === "gemini-2.0-flash" ? "gemini-3.8-flash" : model;
  const isThinkingModel = model === "gemini-2.0-flash" || model === "gemini-3.8-flash";
  if (isThinkingModel) {
    requestBody.generationConfig = {
      ...requestBody.generationConfig,
      thinkingConfig: { thinkingBudget: 8192 }
    };
  }

  // Cascading: try selected model first, then stable fallback
  const rawCandidateModels = [
    mappedModel && mappedModel.startsWith("gemini") ? mappedModel : "gemini-flash-lite-latest",
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
      "X-Title": "N.A.N.U AI Assistant"
    }
  );
}

// N.A.N.U Smart — Comprehensive Local AI Engine (No API required)
async function streamFallback(prompt, res, notice = "", clientTimeInfo = null) {
  if (notice) {
    res.write(notice + "\n\n");
  }

  const p = prompt.trim();
  const lower = p.toLowerCase();

  function pickAnswer() {
    // Current Time & Date query
    if (
      /(what('?s| is) (the )?(current )?(time|date|day|year|month)|what time is it|current (time|date)|today'?s date|what day is (it|today)|tell me the (time|date)|date and time|what year is it)/i.test(lower) ||
      /^(time|date|day|today)[!?\s]*$/i.test(p.trim())
    ) {
      const d = clientTimeInfo?.date ? new Date(clientTimeInfo.date) : new Date();
      const validDate = isNaN(d.getTime()) ? new Date() : d;
      const tz = clientTimeInfo?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
      const timeStr = validDate.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
      const dateStr = validDate.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" });
      
      const asksTime = /time/i.test(lower) && !/date/i.test(lower);
      const asksDate = /date|day|today|month|year/i.test(lower) && !/time/i.test(lower);

      if (asksTime) {
        return `## ⏰ Current Time\n\nIt is currently **${timeStr}** (${tz}).`;
      } else if (asksDate) {
        return `## 📅 Today's Date\n\nToday is **${dateStr}**.\n\n*(Current time: ${timeStr} ${tz})*`;
      } else {
        return `## ⏰ Current Date & Time\n\n- **Date:** ${dateStr}\n- **Time:** ${timeStr} (${tz})`;
      }
    }

    // Password Change / Reset query
    if (/change (my )?password|reset (my )?password|update (my )?password|forgot password/i.test(lower)) {
      return `## 🔐 Change Password — Verification Required\n\nTo securely change your password, **please type your registered email address**.\n\nA random 6-digit OTP will be sent to your registered email to verify your email before you can set a new password.`;
    }

    // Clear Chats query
    if (/(?:clear|delete|remove)\s+(?:all\s+)?(?:the\s+)?(?:previous\s+)?(?:chat|chats|conversation|history)/i.test(lower)) {
      return `## ⚠️ Clear Previous Chats\n\nAre you sure you want to delete all previous chats? This action **cannot be undone**.\n\nPlease type **confirm** to permanently delete your previous chats.`;
    }

    // Greetings
    if (/^(hi|hello|hey|howdy|sup|yo|hiya|good (morning|afternoon|evening)|namaste)[!?\s]*$/i.test(p.trim())) {
      return `# Hey there! 👋\n\nI'm **N.A.N.U**, your intelligent AI assistant running in **Offline Mode**.\n\nI can help with:\n- 💻 **Algorithms** — sorting, searching, data structures\n- 🐍 **Python / JS / TS** — code examples and explanations\n- ⚛️ **React / Node.js** — components, hooks, APIs\n- 🗄️ **SQL** — queries, joins, schema design\n- 🐙 **Git / Docker / Linux** — commands and workflows\n- 🤖 **AI/ML** — concepts, architectures, use cases\n\nWhat would you like to explore?`;
    }

    // Identity
    if (/who are you|what are you|what is nanu|introduce yourself|tell me about yourself/i.test(lower)) {
      return `# I'm N.A.N.U 🤖\n\n**N.A.N.U** stands for **Neural Adaptive Network Utility** — a fast, intelligent AI assistant built to help with coding, learning, and problem-solving.\n\n### Capabilities\n| Area | Details |\n|:---|:---|\n| 💻 Code | Write, debug, review any language |\n| 📖 Explain | Break down complex topics simply |\n| 🧮 Math | Equations, algorithms, proofs |\n| 🌐 Web Dev | HTML, CSS, JS, React, Node.js |\n| 🗄️ Databases | SQL, NoSQL, schema design |\n| 🐧 DevOps | Git, Docker, Linux, CI/CD |\n\n> Currently running in **Offline Mode** — no internet, no API key needed!`;
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
      return `## What N.A.N.U Can Do 🧠\n\n### 💻 Offline Mode (N.A.N.U Smart — active now)\nBuilt-in knowledge for:\n- Algorithms: sorting, searching, trees, graphs\n- Python, JavaScript, TypeScript\n- React, Node.js, Express\n- SQL, Git, Docker, Linux\n- AI/ML concepts\n\n### 🌐 Online Mode (Switch to N.A.N.U Flash)\n- Answer ANY question with live AI\n- Analyze images, PDFs, voice notes\n- Deep reasoning with Gemini 2.5 Flash`;
    }

    // Generic intelligent fallback
    const topic = p.length > 70 ? p.slice(0, 67) + "..." : p;
    return `## Let me help! 💡\n\nYou asked: *"${topic}"*\n\nI'm **N.A.N.U Smart** in **Offline Mode**. I have built-in knowledge for:\n\n| Topic | Try asking... |\n|:---|:---|\n| 💻 Algorithms | "merge sort", "binary search" |\n| 🐍 Python / JS | "Python classes", "async await" |\n| ⚛️ React | "useState example", "useEffect" |\n| 🗄️ SQL | "SQL joins", "write a query" |\n| 🐙 Git | "git commands", "how to branch" |\n| 🐳 Docker | "Dockerfile example" |\n| 🐧 Linux | "linux commands cheatsheet" |\n| 🤖 AI/ML | "machine learning basics" |\n\n> 💡 Switch to **⚡ N.A.N.U Flash** for full AI answers on any topic!`;
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

async function handleChatPasswordChange(cleanMessages, reqUser, res) {
  const lastUserMsg = cleanMessages.filter(m => m.role === "user").pop()?.content || "";
  const lastAssistantMsg = cleanMessages.filter(m => m.role === "assistant").pop()?.content || "";
  const userLower = lastUserMsg.toLowerCase();
  const assistantLower = lastAssistantMsg.toLowerCase();

  const isAskingPasswordChange = /(?:change|reset|update|forgot)\s+(?:my\s+)?password|password\s+change/i.test(lastUserMsg);
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  const emailMatch = lastUserMsg.match(emailRegex);
  const otpMatch = lastUserMsg.match(/\b\d{6}\b/);

  const conversationHasPasswordIntent = cleanMessages.some(m => /(?:change|reset|update|forgot)\s+(?:my\s+)?password|password\s+change/i.test(m.content || ""));
  const isAwaitingEmail = assistantLower.includes("email") || assistantLower.includes("verification required");
  const isAwaitingOtp = assistantLower.includes("otp") || assistantLower.includes("verification code") || assistantLower.includes("6-digit");
  const isAwaitingNewPass = assistantLower.includes("reply with your new password");

  // Step 1: User says "change my password" (without providing email or OTP)
  if (isAskingPasswordChange && !emailMatch && !otpMatch) {
    const text = `## 🔐 Change Password — Verification Required\n\nTo securely change your password, **please type your registered email address**.\n\nA random 6-digit OTP will be sent to your registered email to verify your identity before you can change your password.`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
    return true;
  }

  // Step 2: Email provided (either with password change request or in response to AI asking for email)
  if (emailMatch && !otpMatch && (isAskingPasswordChange || isAwaitingEmail || conversationHasPasswordIntent || userLower.includes("email") || userLower.includes("otp"))) {
    const targetEmail = emailMatch[0].toLowerCase();
    const users = getUsers();
    const targetUser = users.find(u => u.email.toLowerCase() === targetEmail);

    if (!targetUser || (reqUser && reqUser.email && reqUser.email.toLowerCase() !== targetEmail)) {
      const text = `❌ **Registered Email Verification Failed**\n\nThe email **${targetEmail}** does not match your registered account email.\n\nPlease type your registered email address to verify.`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(text);
      return true;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    targetUser.otp = otp;
    targetUser.otpExpiry = Date.now() + 10 * 60 * 1000;
    saveUsers(users);

    const emailRes = await sendEmailOtp(targetEmail, otp);
    let text = "";
    if (emailRes.sent) {
      text = `## ✉️ Verification OTP Sent to Email\n\nA 6-digit verification code has been dispatched to your registered email **${targetEmail}**.\n\n📬 **Please check your email inbox (and spam folder)** to get your verification code.\n\nOnce you receive your OTP from your email, please reply with:\n1. **Your 6-digit OTP code**\n2. **Your new password** (at least 6 characters)\n\n*Example: \`OTP: [code-from-email], New password: mySecretPassword123\`*`;
    } else {
      text = `❌ **Email Delivery Failed**\n\n${emailRes.error || "Could not deliver email to your inbox."}\n\nTo enable OTP delivery to your email inbox, please configure your Gmail address and 16-character Google App Password in **Settings (⚙️)** or add \`EMAIL_USER\` and \`EMAIL_PASS\` to your \`.env\` file.`;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
    return true;
  }

  // Step 3: User provides OTP (and optionally new password)
  if (otpMatch && (isAwaitingOtp || userLower.includes("otp") || userLower.includes("password") || userLower.includes("code"))) {
    const submittedOtp = otpMatch[0];
    const users = getUsers();
    let targetUser = users.find(u => u.otp === submittedOtp && Date.now() <= u.otpExpiry);
    if (!targetUser && reqUser && reqUser.otp === submittedOtp && Date.now() <= reqUser.otpExpiry) {
      targetUser = users.find(u => u.token === reqUser.token);
    }

    if (!targetUser) {
      const text = `❌ **Invalid or Expired OTP Code**\n\nThe 6-digit OTP code **${submittedOtp}** is incorrect or has expired.\n\nPlease check your email inbox or request a new code.`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(text);
      return true;
    }

    // Check for new password
    let passCandidate = "";
    const passMatch = lastUserMsg.match(/(?:new\s*password|password|pass)\s*(?:is|:|=)?\s*([^\n\r,;]+)/i);
    if (passMatch && passMatch[1].trim()) {
      passCandidate = passMatch[1].trim();
    } else {
      const cleaned = lastUserMsg.replace(submittedOtp, "").replace(/otp/gi, "").replace(/new/gi, "").replace(/password/gi, "").replace(/[:=,]/g, "").trim();
      if (cleaned.length >= 6) {
        passCandidate = cleaned.split(/\s+/)[0];
      }
    }

    if (!passCandidate || passCandidate.length < 6) {
      const text = `## ✅ OTP Code Verified!\n\nYour 6-digit OTP **${submittedOtp}** has been successfully verified.\n\nNow, please reply with your **new password** (must be at least 6 characters) to save the update.`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(text);
      return true;
    }

    targetUser.password = passCandidate;
    targetUser.otp = null;
    targetUser.otpExpiry = null;
    saveUsers(users);

    console.log(`\n\n[AUTH SYSTEM] 🎉 Password successfully updated for ${targetUser.email} via AI Chat!\n\n`);

    const text = `## 🎉 Password Successfully Updated!\n\nYour 6-digit OTP code has been verified and your account password for **${targetUser.email}** has been updated successfully!\n\nYou can now use your new password for all future logins.`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
    return true;
  }

  // Step 4: User provides just the new password after OTP was verified
  if (isAwaitingNewPass && !otpMatch) {
    const candidate = lastUserMsg.trim().split(/\s+/)[0];
    if (candidate.length >= 6 && reqUser) {
      const users = getUsers();
      const targetUser = users.find(u => u.token === reqUser.token);
      if (targetUser) {
        targetUser.password = candidate;
        targetUser.otp = null;
        targetUser.otpExpiry = null;
        saveUsers(users);
        console.log(`\n\n[AUTH SYSTEM] 🎉 Password successfully updated for ${targetUser.email} via AI Chat!\n\n`);
        const text = `## 🎉 Password Successfully Updated!\n\nYour account password for **${targetUser.email}** has been updated successfully!\n\nYou can now use your new password for future logins.`;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(text);
        return true;
      }
    }
  }

  return false;
}

async function handleChatClearChats(cleanMessages, res) {
  const lastUserMsg = cleanMessages.filter(m => m.role === "user").pop()?.content || "";
  const lastAssistantMsg = cleanMessages.filter(m => m.role === "assistant").pop()?.content || "";
  const userTrim = lastUserMsg.trim().toLowerCase();
  const assistantLower = lastAssistantMsg.toLowerCase();

  // User asking to clear chats
  if (/(?:clear|delete|remove)\s+(?:all\s+)?(?:the\s+)?(?:previous\s+)?(?:chat|chats|conversation|history)/i.test(lastUserMsg)) {
    const text = `## ⚠️ Clear Previous Chats\n\nAre you sure you want to delete all previous chats? This action **cannot be undone**.\n\nPlease type **confirm** to permanently delete your previous chats.`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
    return true;
  }

  // User types confirm following the confirmation prompt
  if (userTrim === "confirm" && (assistantLower.includes("type confirm") || assistantLower.includes("clear previous chats") || assistantLower.includes("delete all previous chats"))) {
    const text = `## 🗑️ Chats Cleared\n\nAll your previous chats have been permanently deleted. [CLEAR_CHATS_CONFIRMED]`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
    return true;
  }

  return false;
}

app.post("/api/chat", verify, async (req, res) => {
  const {
    messages = [],
    temperature = 0.7,
    model = config.defaultModel || "gemini-flash-latest",
    system = null,
    apiKey = null,
    timeZone = null,
    clientTime = null
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

  // Real-time temporal anchor for accurate time and date responses
  const userTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const userClientDate = clientTime ? new Date(clientTime) : new Date();
  const validClientDate = isNaN(userClientDate.getTime()) ? new Date() : userClientDate;
  const clientTimeInfo = { date: validClientDate, timeZone: userTimeZone };

  const formattedTime = validClientDate.toLocaleTimeString("en-US", {
    timeZone: userTimeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  const formattedDate = validClientDate.toLocaleDateString("en-US", {
    timeZone: userTimeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const baseSys = system || "You are N.A.N.U, a fast, intelligent, helpful AI assistant. Format code in markdown.";
  const temporalInstruction = `\n\n[Real-Time System Context: Today is ${formattedDate}. The current local time is ${formattedTime} (${userTimeZone}). When asked about the current time, date, day of the week, month, or year, always answer accurately and concisely based on this information.]\n\n[Security Policy - Password Changes: Password changes strictly require 6-digit OTP verification. When a user asks to change or reset their password, ALWAYS first ask them to type their registered email address. Once they provide their registered email, a random 6-digit OTP is sent to that email, and they must verify the 6-digit OTP code before updating their password.]\n\n[Chat History Policy - Clearing Chats: When a user asks to clear or delete previous chats or conversation history, ALWAYS ask them to type "confirm" before permanently deleting previous chats.]`;
  const systemContent = baseSys + temporalInstruction;

  const finalMessages = [
    { role: "system", content: systemContent },
    ...cleanMessages.filter(m => m.role !== "system")
  ];

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const lastUserMsg = cleanMessages.filter(m => m.role === "user").pop()?.content || "";

  // Handle clear chat conversational flow with "confirm" requirement directly
  if (await handleChatClearChats(cleanMessages, res)) {
    return;
  }

  // Handle password change conversational flow with OTP verification directly
  if (await handleChatPasswordChange(cleanMessages, req.user, res)) {
    return;
  }

  // 1. NANU Smart — routes through Gemini Flash Lite for full AI capability
  //    Falls back to built-in local engine only if API is unavailable
  if (model === "nanu-smart") {
    if (config.geminiKey) {
      try {
        console.log("[NANU Smart] Routing via Gemini Flash Lite. prompt: " + lastUserMsg.slice(0, 80));
        await callGemini(finalMessages, "gemini-flash-lite-latest", apiKey, res);
        res.end();
        return;
      } catch (err) {
        console.warn("[NANU Smart] Gemini unavailable, using built-in engine:", err.message);
      }
    }
    // Fallback to local engine when offline or no API key
    await streamFallback(lastUserMsg, res, "", clientTimeInfo);
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
      await streamFallback(lastUserMsg, res, `> ⚠️ *Live AI is currently busy. Answered via N.A.N.U engine:*`, clientTimeInfo);
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
      await streamFallback(lastUserMsg, res, `> ⚠️ *Rate limit reached. Answered via N.A.N.U engine:*`, clientTimeInfo);
      res.end();
      return;
    }
  }

  // 4. OpenAI model
  try {
    await callOpenOpenAIWithFallback(finalMessages, model, temperature, apiKey, lastUserMsg, res, clientTimeInfo);
  } catch (err) {
    console.error("OpenAI execution error:", err);
    if (!res.writableEnded) {
      res.end("Proxy error: " + (err.message || JSON.stringify(err)));
    }
  }
});

async function callOpenOpenAIWithFallback(finalMessages, model, temperature, apiKey, lastUserMsg, res, clientTimeInfo = null) {
  try {
    await callOpenAI(finalMessages, model, temperature, apiKey, res);
    res.end();
  } catch (err) {
    const isQuotaExhausted = err.status === 429 || (typeof err.body === "string" && (err.body.includes("insufficient_quota") || err.body.includes("credit_balance_exhausted")));

    if (isQuotaExhausted) {
      console.log("OpenAI quota exhausted. Seamlessly routing to Google Gemini...");
      
      if (config.geminiKey) {
        try {
          res.write("> ℹ️ *Note: Your OpenAI key has 0 prepaid credits remaining. N.A.N.U answered via Google Gemini:* \n\n");
          await callGemini(finalMessages, "gemini-flash-lite-latest", null, res);
          res.end();
          return;
        } catch (gErr) {
          console.warn("Gemini call during OpenAI fallback error:", gErr);
        }
      }

      if (config.openrouterKey) {
        try {
          res.write("> ℹ️ *Note: Your OpenAI key has 0 prepaid credits remaining. N.A.N.U answered via OpenRouter AI:* \n\n");
          await callOpenRouter(finalMessages, "qwen/qwen3.8-27b:free", null, res);
          res.end();
          return;
        } catch (orErr) {}
      }

      const notice = `> ℹ️ *Note: OpenAI API has 0 prepaid credits. Add credits at platform.openai.com/billing or configure Gemini in Settings.*`;
      await streamFallback(lastUserMsg, res, notice, clientTimeInfo);
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




