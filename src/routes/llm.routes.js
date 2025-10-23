// src/routes/llm.routes.js
const { Router } = require("express");
const { analyze, chatLLM } = require("../controllers/llm.controller");

const router = Router();

// - analyze: para demo con instruction + text
// - chat: para flujos con messages (opcional ahora, útil después)
router.post("/analyze", analyze);
router.post("/chat", chatLLM);

module.exports = router;
