// src/services/ollama.service.js
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

// Utilidad: timeout con AbortController
async function withTimeout(promise, ms = 30_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(id);
  }
}

// /api/generate: prompt plano
async function generate({ prompt, options = {} }) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: 256, // evita respuestas gigantes
      ...options,
    },
  };

  const doFetch = (signal) =>
    fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

  const resp = await withTimeout(doFetch);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new Error("Ollama /generate falló");
    err.detail = detail;
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return data.response || "";
}

// /api/chat: mensajes con roles (system/user/assistant)
async function chat({ messages, options = {} }) {
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    messages,
    options: {
      temperature: 0.2,
      num_predict: 256,
      ...options,
    },
  };

  const doFetch = (signal) =>
    fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

  const resp = await withTimeout(doFetch);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new Error("Ollama /chat falló");
    err.detail = detail;
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return data?.message?.content ?? "";
}

module.exports = { generate, chat };
