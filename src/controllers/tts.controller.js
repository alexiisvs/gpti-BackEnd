const fs = require("fs");
const gTTS = require("gtts");

const generateSpeech = (req, res) => {
  try {
    const text = (req.body?.text ?? "").trim();

    if (!text) {
      return res.status(400).json({ error: "Texto vacío" });
    }

    const tts = new gTTS(text, "es");
    const filePath = `tts_${Date.now()}.mp3`;

    tts.save(filePath, (err) => {
      if (err) {
        console.error("Error generando audio:", err);
        return res.status(500).json({ error: "Error generando audio" });
      }

      res.setHeader("Content-Type", "audio/mpeg");

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      stream.on("close", () => {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error borrando archivo temporal:", unlinkErr);
          }
        });
      });
    });
  } catch (err) {
    console.error("Error general en TTS:", err);
    res.status(500).json({ error: "Error procesando la solicitud TTS" });
  }
};

module.exports = { generateSpeech };
