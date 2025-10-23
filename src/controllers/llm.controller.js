// src/controllers/llm.controller.js
const { generate, chat } = require("../services/ollama.service");

// POST /api/v1/llm/analyze
// body: { text, instruction }
async function analyze(req, res) {
  try {
    const text = (req.body?.text ?? "").trim();
    const instruction = (req.body?.instruction ?? "").trim();

    if (!text) return res.status(400).json({ error: "Texto vacío" });
    if (!instruction) return res.status(400).json({ error: "Instrucción vacía" });

    const prompt = `${instruction}\n\n--- TEXTO ---\n${text}\n----------------`;
    const output = await generate({ prompt });

    return res.json({ output });
  } catch (err) {
    console.error("LLM analyze error:", err.message, err.detail || "");
    // Si Ollama no está levantado, suele ser ECONNREFUSED
    const status = err.status || 503;
    return res.status(status).json({
      error: "Error procesando análisis",
      detail: err.detail || "Ollama no disponible. ¿Está corriendo en 11434?",
    });
  }
}

// POST /api/v1/llm/chat
// body: { messages: [{ role, content }, ...] }
async function chatLLM(req, res) {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages requerido" });
    }

    const output = await chat({ messages });
    return res.json({ output });
  } catch (err) {
    console.error("LLM chat error:", err.message, err.detail || "");
    const status = err.status || 503;
    return res.status(status).json({
      error: "Error en chat",
      detail: err.detail || "Ollama no disponible. ¿Está corriendo en 11434?",
    });
  }
}

module.exports = { analyze, chatLLM };
