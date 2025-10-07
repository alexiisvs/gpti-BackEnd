// ================================
//  BACKEND GPTI - TTS Google (gTTS)
// ================================

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const gTTS = require("gtts"); // 👈 Librería Google TTS
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// ================================
//  RUTA: Generar audio desde texto
// ================================
app.post("/api/v1/tts/speak", async (req, res) => {
  try {
    const text = (req.body?.text ?? "").trim();

    if (!text) {
      return res.status(400).json({ error: "Texto vacío" });
    }

    // Crear archivo temporal
    const tts = new gTTS(text, "es"); // Idioma español
    const filePath = `tts_${Date.now()}.mp3`;

    // Guardar y enviar
    tts.save(filePath, (err) => {
      if (err) {
        console.error("Error generando audio:", err);
        return res.status(500).json({ error: "Error generando audio" });
      }

      // Configurar respuesta
      res.setHeader("Content-Type", "audio/mpeg");

      // Enviar el audio como stream
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      // Borrar archivo temporal cuando termine
      stream.on("close", () => {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error("Error borrando archivo temporal:", unlinkErr);
        });
      });
    });
  } catch (err) {
    console.error("Error general en TTS:", err);
    res.status(500).json({ error: "Error procesando la solicitud TTS" });
  }
});

// ================================
//  INICIO DEL SERVIDOR
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Back en http://localhost:${PORT}`);
});


