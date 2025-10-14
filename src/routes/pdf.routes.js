const { Router } = require("express");
const { extractPdfText } = require("../controllers/pdf.controller");

const router = Router();

router.post("/upload", extractPdfText);

module.exports = router;
