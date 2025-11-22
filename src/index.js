require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'document-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB límite
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  }
});

// ✅ Usuarios de prueba (hardcodeados para desarrollo)
const TEST_USERS = [
  {
    id: 1,
    email: 'test@audia.com',
    password: 'test123',
    name: 'Usuario de Prueba'
  },
  {
    id: 2,
    email: 'admin@audia.com',
    password: 'admin123',
    name: 'Administrador'
  },
  {
    id: 3,
    email: 'demo@audia.com',
    password: 'demo123',
    name: 'Usuario Demo'
  }
];

// ✅ Endpoint de login
app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;

  // Validación básica
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email y contraseña son requeridos'
    });
  }

  // Buscar usuario
  const user = TEST_USERS.find(
    u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Credenciales inválidas'
    });
  }

  // Login exitoso - retornar datos del usuario (sin la contraseña)
  const { password: _, ...userWithoutPassword } = user;
  
  res.json({
    success: true,
    message: 'Login exitoso',
    user: userWithoutPassword,
    token: `mock-token-${user.id}-${Date.now()}` // Token simple para desarrollo
  });
});

// Almacenamiento en memoria de documentos procesados (en producción usar BD)
const documentsStore = new Map();

// ✅ Middleware de manejo de errores de multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Error al procesar el archivo'
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Error al procesar el archivo'
    });
  }
  next();
};

// ✅ Endpoint de subida de documentos con extracción de texto
app.post('/api/v1/documents/upload', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    // Verificar autenticación básica (en producción usar JWT real)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado. Token requerido.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se recibió ningún archivo o el archivo no es válido'
      });
    }

    // Extraer texto del PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    
    // pdf-parse v1.1.1: función directa
    let pdfData;
    try {
      pdfData = await pdfParse(dataBuffer);
    } catch (parseError) {
      console.error('Error al parsear PDF:', parseError);
      throw new Error('Error al extraer texto del PDF: ' + parseError.message);
    }
    
    const extractedText = pdfData.text || '';

    // Generar ID único para el documento
    const documentId = `doc-${Date.now()}-${Math.round(Math.random() * 1E9)}`;

    // Guardar información del documento
    const documentInfo = {
      id: documentId,
      filename: req.file.originalname,
      filepath: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      text: extractedText,
      pages: pdfData.numpages,
      createdAt: new Date().toISOString(),
      status: 'processed'
    };

    documentsStore.set(documentId, documentInfo);

    // Retornar información del archivo subido
    res.json({
      success: true,
      message: 'Archivo subido y procesado exitosamente',
      document: {
        id: documentId,
        filename: req.file.originalname,
        pages: pdfData.numpages,
        textLength: extractedText.length,
        status: 'processed'
      }
    });
  } catch (error) {
    console.error('Error al subir archivo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al procesar el archivo'
    });
  }
});

// ✅ Endpoint para listar todos los documentos del usuario
app.get('/api/v1/documents', (req, res) => {
  try {
    // Verificar autenticación básica
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado. Token requerido.'
      });
    }

    // Convertir Map a array de documentos (sin el texto completo para no sobrecargar)
    const documents = Array.from(documentsStore.values()).map(doc => ({
      id: doc.id,
      filename: doc.filename,
      pages: doc.pages,
      textLength: doc.text.length,
      size: doc.size,
      createdAt: doc.createdAt,
      status: doc.status
    }));

    res.json({
      success: true,
      documents: documents
    });
  } catch (error) {
    console.error('Error al listar documentos:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al obtener los documentos'
    });
  }
});

// ✅ Endpoint para obtener documento por ID
app.get('/api/v1/documents/:id', (req, res) => {
  try {
    const { id } = req.params;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    res.json({
      success: true,
      document: {
        id: document.id,
        filename: document.filename,
        pages: document.pages,
        textLength: document.text.length,
        createdAt: document.createdAt,
        status: document.status
      }
    });
  } catch (error) {
    console.error('Error al obtener documento:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al obtener el documento'
    });
  }
});

// ✅ Endpoint para generar resumen automático
app.post('/api/v1/documents/:id/summary', async (req, res) => {
  try {
    const { id } = req.params;
    const { level = 'standard' } = req.body; // brief, standard, detailed
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    // Simular generación de resumen (en producción usar IA real)
    const text = document.text;
    const summaryLength = level === 'brief' ? 200 : level === 'standard' ? 500 : 1000;
    const summary = text.substring(0, summaryLength) + '... [Resumen generado automáticamente]';

    // Guardar resumen en el documento
    document.summary = summary;
    document.summaryLevel = level;
    documentsStore.set(id, document);

    res.json({
      success: true,
      summary: summary,
      level: level,
      length: summary.length
    });
  } catch (error) {
    console.error('Error al generar resumen:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al generar el resumen'
    });
  }
});

// ✅ Endpoint para generar flashcards
app.post('/api/v1/documents/:id/flashcards', async (req, res) => {
  try {
    const { id } = req.params;
    const { count = 5 } = req.body;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    // Simular generación de flashcards (en producción usar IA real)
    const flashcards = [];
    const sentences = document.text.split('.').filter(s => s.trim().length > 20);
    
    for (let i = 0; i < Math.min(count, sentences.length); i++) {
      const sentence = sentences[i].trim();
      flashcards.push({
        id: `flashcard-${i + 1}`,
        question: `¿Qué información se menciona sobre: "${sentence.substring(0, 50)}..."?`,
        answer: sentence,
        documentId: id
      });
    }

    // Guardar flashcards en el documento
    document.flashcards = flashcards;
    documentsStore.set(id, document);

    res.json({
      success: true,
      flashcards: flashcards,
      count: flashcards.length
    });
  } catch (error) {
    console.error('Error al generar flashcards:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al generar las flashcards'
    });
  }
});

// ✅ Endpoint para obtener texto del documento (para TTS)
app.get('/api/v1/documents/:id/text', (req, res) => {
  try {
    const { id } = req.params;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    res.json({
      success: true,
      text: document.text,
      length: document.text.length
    });
  } catch (error) {
    console.error('Error al obtener texto:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al obtener el texto'
    });
  }
});

// ✅ Endpoint de chat contextual
app.post('/api/v1/documents/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Mensaje requerido'
      });
    }

    // Simular respuesta del asistente (en producción usar IA real)
    const response = `Basándome en el documento "${document.filename}", puedo decirte que: ${message.toLowerCase().includes('qué') || message.toLowerCase().includes('que') ? 'El documento contiene información relevante sobre el tema que mencionas.' : 'El documento aborda varios aspectos importantes relacionados con tu pregunta.'} [Respuesta generada automáticamente]`;

    res.json({
      success: true,
      response: response,
      documentId: id
    });
  } catch (error) {
    console.error('Error en chat:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al procesar el mensaje'
    });
  }
});

// ✅ Endpoint de chat general
app.post('/api/v1/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Mensaje requerido'
      });
    }

    // Simular respuesta del asistente (en producción usar IA real)
    const response = `Hola! Soy tu asistente de AudIA. Puedo ayudarte con tus documentos. ${message}`;

    res.json({
      success: true,
      response: response
    });
  } catch (error) {
    console.error('Error en chat:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al procesar el mensaje'
    });
  }
});

// ✅ Endpoint TTS: Generar audio desde texto usando gTTS
app.post('/api/v1/tts/speak', async (req, res) => {
  try {
    const { text, lang = 'es' } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Texto requerido'
      });
    }

    // Limitar el texto a 5000 caracteres por solicitud (límite de gTTS)
    const textToConvert = text.substring(0, 5000);
    
    const gtts = require('gtts');
    const path = require('path');
    const audioDir = path.join(__dirname, '../audio');
    
    // Crear directorio de audio si no existe
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Generar nombre único para el archivo de audio
    const audioId = `audio-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const audioPath = path.join(audioDir, `${audioId}.mp3`);
    
    // Generar audio usando gTTS
    const tts = new gtts(textToConvert, lang);
    
    return new Promise((resolve, reject) => {
      tts.save(audioPath, async (err) => {
        if (err) {
          console.error('Error al generar audio con gTTS:', err);
          return res.status(500).json({
            success: false,
            message: 'Error al generar el audio: ' + err.message
          });
        }
        
        // Verificar que el archivo se creó correctamente
        if (!fs.existsSync(audioPath)) {
          console.error('El archivo de audio no se creó');
          return res.status(500).json({
            success: false,
            message: 'Error: El archivo de audio no se generó correctamente'
          });
        }
        
        try {
          // Leer el archivo y enviarlo como respuesta
          const audioBuffer = fs.readFileSync(audioPath);
          
          if (audioBuffer.length === 0) {
            console.error('El archivo de audio está vacío');
            return res.status(500).json({
              success: false,
              message: 'Error: El archivo de audio está vacío'
            });
          }
          
          console.log(`Audio generado exitosamente: ${audioBuffer.length} bytes`);
          
          // Configurar headers para streaming de audio
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Length', audioBuffer.length);
          res.setHeader('Content-Disposition', `inline; filename="${audioId}.mp3"`);
          res.setHeader('Cache-Control', 'no-cache');
          
          // Enviar el audio
          res.send(audioBuffer);
          
          // Eliminar el archivo después de enviarlo (opcional, para ahorrar espacio)
          setTimeout(() => {
            if (fs.existsSync(audioPath)) {
              fs.unlinkSync(audioPath);
            }
          }, 60000); // Eliminar después de 1 minuto
          
          resolve();
        } catch (readError) {
          console.error('Error al leer el archivo de audio:', readError);
          res.status(500).json({
            success: false,
            message: 'Error al leer el archivo de audio: ' + readError.message
          });
        }
      });
    });
  } catch (error) {
    console.error('Error en TTS:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al generar el audio'
    });
  }
});

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

// ✅ Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor'
  });
});

// ✅ Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});


