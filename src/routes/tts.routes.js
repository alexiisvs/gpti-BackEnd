const { Router } = require("express");
const { generateSpeech } = require("../controllers/tts.controller");

const router = Router();

router.post("/speak", generateSpeech);

module.exports = router;
