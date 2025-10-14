const extractPdfText = (req, res) => {
  return res.status(501).json({ error: "Procesamiento de PDF no implementado aún" });
};

module.exports = { extractPdfText };
