const { Router } = require("express");
const { runDemoChat } = require("../controllers/llm.controller");

const router = Router();

router.post("/chat", runDemoChat);

module.exports = router;
