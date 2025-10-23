const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { extractPdfText } = require("../controllers/pdf.controller");

const upload = multer({
  dest: path.join(__dirname, "..", "..", "uploads"),
});

const router = Router();

// check: solo valida que llega archivo y lo borra
router.post("/check", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.json({ status: "empty" });
    fs.unlink(req.file.path, () => {});
    return res.json({ status: "ok" });
  } catch (e) {
    return res.status(500).json({ status: "error" });
  }
});

// extract: extrae texto real
router.post("/extract", upload.single("file"), extractPdfText);

// (el que ya tenías)
router.post("/upload", upload.single("file"), extractPdfText);

module.exports = router;
