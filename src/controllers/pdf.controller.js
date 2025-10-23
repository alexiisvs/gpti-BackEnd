const fs = require("fs");

const extractPdfText = async (req, res) => {
  try {
    console.log("[PDF] extractPdfText llamado");

    if (!req.file) {
      return res.status(400).json({ error: "No enviaste archivo (campo 'file')" });
    }

    // Import pdf-parse dynamically
    const pdfParse = require("pdf-parse");
    
    const buffer = fs.readFileSync(req.file.path);
    const result = await pdfParse(buffer);
    const text = result?.text ?? "";

    // Limpieza del archivo temporal
    fs.unlink(req.file.path, () => {});

    return res.json({ text });
  } catch (err) {
    console.error("Error en extractPdfText:", err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: "No se pudo extraer el texto" });
  }
};

module.exports = { extractPdfText };