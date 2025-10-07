require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));


// ✅ Nuevo: valida texto
app.post('/api/v1/tts/check', (req, res) => {
  const text = (req.body?.text ?? '').toString();
  const isEmpty = text.trim().length === 0;

  if (isEmpty) {
    return res.json({ status: 'empty' });
  }
  return res.json({ status: 'ok' });
});

// Demo existente
app.get('/api/v1/hello', (_req, res) => {
  res.json({ message: 'Hola desde GPTI Backend ⚙️' });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});


