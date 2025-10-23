const { Router } = require("express");
const ttsRoutes = require("./tts.routes");
const pdfRoutes = require("./pdf.routes");
const llmRoutes = require("./llm.routes");

const router = Router();

router.use("/tts", ttsRoutes);
router.use("/pdf", pdfRoutes);
router.use("/llm", llmRoutes);
router.use("/pdf", pdfRoutes);

module.exports = router;
