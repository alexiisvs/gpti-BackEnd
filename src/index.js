require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Configuración de Gemini Pro
let geminiClient = null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY no está configurada en las variables de entorno');
}
if (GEMINI_API_KEY) {
  try {
    geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('✅ Gemini Pro configurado correctamente');
  } catch (error) {
    console.error('⚠️ Error al configurar Gemini Pro:', error.message);
  }
} else {
  console.log('ℹ️ GEMINI_API_KEY no configurada. Las pills se generarán con lógica simple.');
}

// ✅ Función helper para generar contenido con Gemini Pro con timeout
async function generateWithGemini(prompt, maxTokens = 2000, timeoutMs = 30000, modelName = 'gemini-2.5-flash') {
  if (!geminiClient) {
    return null; // Retornar null si Gemini no está configurado
  }

  // Crear una promesa con timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout: La generación con Gemini tardó demasiado')), timeoutMs);
  });

  const generatePromise = async () => {
    try {
      console.log(`🔄 Iniciando generación con Gemini (modelo: ${modelName}, timeout: ${timeoutMs}ms)...`);
      const startTime = Date.now();
      
      // Usar el modelo especificado (por defecto gemini-2.5-flash)
      const model = geminiClient.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const elapsedTime = Date.now() - startTime;
      console.log(`✅ Gemini respondió en ${elapsedTime}ms`);
      
      return text;
    } catch (error) {
      console.error('Error al generar con Gemini Pro:', error.message);
      // Si falla con el modelo especificado, intentar con gemini-pro como fallback
      if (modelName !== 'gemini-pro') {
        try {
          console.log('⚠️ Intentando con gemini-pro como fallback...');
          const fallbackModel = geminiClient.getGenerativeModel({ model: 'gemini-pro' });
          const result = await fallbackModel.generateContent(prompt);
          const response = await result.response;
          return response.text();
        } catch (fallbackError) {
          console.error('Error con fallback gemini-pro:', fallbackError.message);
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }
  };

  try {
    // Race entre la generación y el timeout
    return await Promise.race([generatePromise(), timeoutPromise]);
  } catch (error) {
    if (error.message.includes('Timeout')) {
      console.error(`⏱️ Timeout después de ${timeoutMs}ms`);
    }
    return null;
  }
}


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
  try {
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
  } catch (error) {
    console.error('Error en endpoint de login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor al procesar el login'
    });
  }
});

// Almacenamiento en memoria de documentos procesados (en producción usar BD)
const documentsStore = new Map();

// ✅ Configuración de Google Calendar API
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/v1/calendar/oauth2callback'
);

// Almacenar tokens de usuarios (en producción usar base de datos)
const userTokens = new Map();

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

// ✅ Endpoint para sincronizar documento desde localStorage al backend
app.post('/api/v1/documents/sync', (req, res) => {
  try {
    const { id, filename, text, createdAt } = req.body;

    if (!id || !filename || !text) {
      return res.status(400).json({
        success: false,
        message: 'ID, filename y text son requeridos'
      });
    }

    // Verificar autenticación
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado. Token requerido.'
      });
    }

    // Crear o actualizar el documento en el store
    const documentInfo = {
      id: id,
      filename: filename,
      text: text,
      pages: 0, // No tenemos información de páginas
      size: text.length,
      createdAt: createdAt || new Date().toISOString(),
      status: 'processed',
      pills: {
        microSummary: null,
        flashcards: [],
        highlightConcepts: [],
        savedPills: []
      }
    };

    documentsStore.set(id, documentInfo);
    console.log(`✅ Documento sincronizado: ${id} (${filename})`);

    res.json({
      success: true,
      message: 'Documento sincronizado exitosamente',
      document: {
        id: documentInfo.id,
        filename: documentInfo.filename,
        textLength: documentInfo.text.length
      }
    });
  } catch (error) {
    console.error('Error al sincronizar documento:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al sincronizar el documento'
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

// ✅ Endpoint para eliminar documento por ID
app.delete('/api/v1/documents/:id', (req, res) => {
  try {
    // Verificar autenticación básica
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado. Token requerido.'
      });
    }

    const { id } = req.params;
    const document = documentsStore.get(id);

    if (!document) {
      console.log(`⚠️ Documento ${id} no encontrado en memoria`);
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado. El documento puede haber sido eliminado previamente o el servidor se reinició.'
      });
    }
    
    console.log(`🗑️ Eliminando documento ${id}: ${document.filename}`);

    // Eliminar archivo PDF si existe
    if (document.filepath && fs.existsSync(document.filepath)) {
      try {
        fs.unlinkSync(document.filepath);
        console.log(`✅ Archivo PDF eliminado: ${document.filepath}`);
      } catch (err) {
        console.error(`Error al eliminar archivo PDF ${document.filepath}:`, err);
      }
    }

    // Eliminar audios en cache asociados a este documento
    // El hash se genera como: SHA256(texto|voiceType|lang)
    // Necesitamos eliminar todos los audios relacionados con este texto, independientemente de la voz
    const audioCacheDir = path.join(__dirname, '../audio_cache');
    console.log(`🗑️ Iniciando eliminación de audios del cache para documento ${id}`);
    console.log(`   Documento tiene texto: ${!!document.text}, longitud: ${document.text ? document.text.length : 0}`);
    
    if (fs.existsSync(audioCacheDir) && document.text) {
      try {
        const files = fs.readdirSync(audioCacheDir);
        const textToSearch = document.text.substring(0, 5000);
        console.log(`🔍 Buscando audios para texto de ${textToSearch.length} caracteres (documento ${id})`);
        console.log(`   Primeros 100 caracteres del texto: "${textToSearch.substring(0, 100)}..."`);
        
        // Generar hashes para todas las combinaciones posibles de voz e idioma
        const voiceTypes = ['femenina', 'masculina'];
        const languages = ['es', 'en'];
        const hashesToDelete = new Set();
        
        // Generar todos los posibles hashes para este texto
        for (const voiceType of voiceTypes) {
          for (const lang of languages) {
            const hash = crypto
              .createHash('sha256')
              .update(`${textToSearch}|${voiceType}|${lang}`)
              .digest('hex');
            hashesToDelete.add(hash);
            console.log(`🔍 Hash generado: ${hash} (voz: ${voiceType}, lang: ${lang})`);
          }
        }
        
        console.log(`📁 Archivos en cache: ${files.length}`);
        
        // Eliminar todos los archivos que coincidan con alguno de los hashes
        let deletedCount = 0;
        files.forEach(file => {
          // El archivo tiene formato: {hash}.mp3
          if (!file.endsWith('.mp3')) return;
          
          const fileHash = file.replace('.mp3', '');
          if (hashesToDelete.has(fileHash)) {
            const filePath = path.join(audioCacheDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`✅ Audio en cache eliminado: ${file}`);
              deletedCount++;
            } catch (err) {
              console.error(`Error al eliminar audio ${file}:`, err);
            }
          } else {
            console.log(`⏭️ Archivo ${file} no coincide con ningún hash generado`);
          }
        });
        
        if (deletedCount > 0) {
          console.log(`🗑️ Eliminados ${deletedCount} archivo(s) de audio del cache para el documento ${id}`);
        } else {
          console.log(`⚠️ No se encontraron archivos de audio en cache para eliminar (documento ${id})`);
          console.log(`   Hashes buscados: ${Array.from(hashesToDelete).map(h => h.substring(0, 16) + '...').join(', ')}`);
          console.log(`   Archivos en cache: ${files.filter(f => f.endsWith('.mp3')).map(f => f.substring(0, 16) + '...').join(', ')}`);
        }
      } catch (err) {
        console.error('Error al limpiar cache de audio:', err);
      }
    } else {
      console.log(`⚠️ No se puede eliminar audios: cache dir existe=${fs.existsSync(audioCacheDir)}, documento tiene texto=${!!document.text}`);
      if (!document.text) {
        console.log(`   ⚠️ El documento no tiene texto en memoria. Esto puede pasar si el servidor se reinició.`);
        console.log(`   💡 Sugerencia: Los audios del cache pueden quedar huérfanos. Considera limpiar el cache manualmente si es necesario.`);
      }
    }

    // Eliminar del almacenamiento en memoria
    documentsStore.delete(id);

    res.json({
      success: true,
      message: 'Documento y sus archivos asociados eliminados exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al eliminar el documento'
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

// ✅ Endpoint para generar Micro Summary
app.post('/api/v1/documents/:id/micro-summary', async (req, res) => {
  try {
    const { id } = req.params;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    // Verificar si ya existe un micro summary (evitar regenerar)
    if (document.pills && document.pills.microSummary) {
      console.log('✅ Micro summary ya existe, retornando desde cache');
      return res.json({
        success: true,
        microSummary: document.pills.microSummary,
        cached: true
      });
    }

    const text = document.text || '';
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El documento no tiene texto extraído'
      });
    }

    let title = document.filename.replace('.pdf', '').replace(/_/g, ' ') || 'Resumen del documento';
    let description = '';

    // Intentar usar Gemini Pro para generar un resumen inteligente
    if (geminiClient) {
      try {
        // Gemini puede manejar hasta ~30,000 tokens (aproximadamente 120,000 caracteres)
        // Pasamos el texto completo del PDF para mejor contexto
        const textForGemini = text.length > 100000 ? text.substring(0, 100000) + '...' : text;
        
        const prompt = `Genera un micro resumen conciso (máximo 200 palabras) del siguiente documento. El resumen debe ser claro, informativo y capturar los puntos principales.

Documento completo:
${textForGemini}`;

        const geminiResponse = await generateWithGemini(prompt, 500);
        if (geminiResponse) {
          description = geminiResponse.trim();
          console.log('✅ Micro summary generado con Gemini Pro');
        }
      } catch (error) {
        console.error('Error al generar con Gemini Pro, usando fallback:', error.message);
      }
    }

    // Fallback si Gemini no está disponible o falla
    if (!description) {
      const summaryLength = Math.min(300, text.length);
      description = text.substring(0, summaryLength) + (text.length > summaryLength ? '...' : '');
      console.log('ℹ️ Micro summary generado con lógica simple (fallback)');
    }
    
    const microSummary = {
      id: `micro-summary-${id}`,
      title: title,
      description: description,
      documentId: id
    };

    // Guardar micro summary en el documento
    if (!document.pills) document.pills = {};
    document.pills.microSummary = microSummary;
    documentsStore.set(id, document);

    res.json({
      success: true,
      microSummary: microSummary
    });
  } catch (error) {
    console.error('Error al generar micro summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al generar el micro summary'
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

    // Verificar si ya existen flashcards (evitar regenerar)
    if (document.pills && document.pills.flashcards && document.pills.flashcards.length > 0) {
      console.log(`✅ ${document.pills.flashcards.length} flashcards ya existen, retornando desde cache`);
      return res.json({
        success: true,
        flashcards: document.pills.flashcards,
        count: document.pills.flashcards.length,
        cached: true
      });
    }

    const text = document.text || '';
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El documento no tiene texto extraído'
      });
    }

    let flashcards = [];

    // Intentar usar Gemini Pro para generar flashcards inteligentes
    if (geminiClient) {
      try {
        // Pasar el texto completo del PDF para mejor contexto
        const textForGemini = text.length > 100000 ? text.substring(0, 100000) + '...' : text;
        
        const prompt = `Genera ${count} flashcards educativas basadas en el siguiente documento. Cada flashcard debe tener:
1. Un título que sea una pregunta clara y concisa
2. Una descripción que sea la respuesta detallada

IMPORTANTE: Responde SOLO con un JSON array válido, sin texto adicional antes o después.

Formato de respuesta (JSON array):
[
  {
    "title": "Pregunta aquí",
    "description": "Respuesta detallada aquí"
  }
]

Documento completo:
${textForGemini}`;

        const geminiResponse = await generateWithGemini(prompt, 2000);
        if (geminiResponse) {
          try {
            // Intentar parsear JSON (Gemini puede devolver texto con JSON)
            const jsonMatch = geminiResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              flashcards = parsed.slice(0, count).map((fc, i) => ({
                id: `flashcard-${i + 1}`,
                title: fc.title || `Pregunta ${i + 1}`,
                description: fc.description || '',
                documentId: id
              }));
              console.log(`✅ ${flashcards.length} flashcards generadas con Gemini Pro`);
            }
          } catch (parseError) {
            console.error('Error al parsear respuesta de Gemini:', parseError.message);
          }
        }
      } catch (error) {
        console.error('Error al generar con Gemini Pro, usando fallback:', error.message);
      }
    }

    // Fallback si Gemini no está disponible o falla
    if (flashcards.length === 0) {
      const sentences = document.text.split('.').filter(s => s.trim().length > 20);
      for (let i = 0; i < Math.min(count, sentences.length); i++) {
        const sentence = sentences[i].trim();
        const questionText = sentence.substring(0, 50);
        flashcards.push({
          id: `flashcard-${i + 1}`,
          title: `¿Qué información se menciona sobre: "${questionText}..."?`,
          description: sentence,
          documentId: id
        });
      }
      console.log(`ℹ️ ${flashcards.length} flashcards generadas con lógica simple (fallback)`);
    }

    // Guardar flashcards en el documento
    if (!document.pills) document.pills = {};
    document.pills.flashcards = flashcards;
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

// ✅ Endpoint para generar Highlight Concepts
app.post('/api/v1/documents/:id/highlight-concepts', async (req, res) => {
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

    // Verificar si ya existen conceptos destacados (evitar regenerar)
    if (document.pills && document.pills.highlightConcepts && document.pills.highlightConcepts.length > 0) {
      console.log(`✅ ${document.pills.highlightConcepts.length} conceptos destacados ya existen, retornando desde cache`);
      return res.json({
        success: true,
        concepts: document.pills.highlightConcepts,
        count: document.pills.highlightConcepts.length,
        cached: true
      });
    }

    const text = document.text || '';
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El documento no tiene texto extraído'
      });
    }

    let concepts = [];

    // Intentar usar Gemini Pro para extraer conceptos clave
    if (geminiClient) {
      try {
        // Pasar el texto completo del PDF para mejor contexto
        const textForGemini = text.length > 100000 ? text.substring(0, 100000) + '...' : text;
        
        const prompt = `Extrae los ${count} conceptos más importantes del siguiente documento. Para cada concepto, proporciona:
1. Un título corto y claro del concepto
2. Una descripción breve que explique el concepto en el contexto del documento

IMPORTANTE: Responde SOLO con un JSON array válido, sin texto adicional antes o después.

Formato de respuesta (JSON array):
[
  {
    "title": "Nombre del concepto",
    "description": "Explicación del concepto en el contexto del documento"
  }
]

Documento completo:
${textForGemini}`;

        const geminiResponse = await generateWithGemini(prompt, 2000);
        if (geminiResponse) {
          try {
            // Intentar parsear JSON
            const jsonMatch = geminiResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              concepts = parsed.slice(0, count).map((c, i) => ({
                id: `concept-${i + 1}`,
                title: c.title || `Concepto ${i + 1}`,
                description: c.description || '',
                documentId: id
              }));
              console.log(`✅ ${concepts.length} conceptos destacados generados con Gemini Pro`);
            }
          } catch (parseError) {
            console.error('Error al parsear respuesta de Gemini:', parseError.message);
          }
        }
      } catch (error) {
        console.error('Error al generar con Gemini Pro, usando fallback:', error.message);
      }
    }

    // Fallback si Gemini no está disponible o falla
    if (concepts.length === 0) {
      const sentences = text.split('.').filter(s => s.trim().length > 30);
      const words = text.split(/\s+/).filter(w => w.length > 5);
      const uniqueWords = [...new Set(words)].slice(0, count);
      
      for (let i = 0; i < Math.min(count, uniqueWords.length); i++) {
        const concept = uniqueWords[i].replace(/[.,;:!?]/g, '');
        const relatedSentence = sentences.find(s => s.includes(concept)) || sentences[i] || '';
        
        concepts.push({
          id: `concept-${i + 1}`,
          title: concept.charAt(0).toUpperCase() + concept.slice(1),
          description: relatedSentence.trim().substring(0, 150) + (relatedSentence.length > 150 ? '...' : ''),
          documentId: id
        });
      }
      console.log(`ℹ️ ${concepts.length} conceptos destacados generados con lógica simple (fallback)`);
    }

    // Guardar conceptos en el documento
    if (!document.pills) document.pills = {};
    document.pills.highlightConcepts = concepts;
    documentsStore.set(id, document);

    res.json({
      success: true,
      concepts: concepts,
      count: concepts.length
    });
  } catch (error) {
    console.error('Error al generar conceptos destacados:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al generar los conceptos destacados'
    });
  }
});

// ✅ Endpoint para obtener todas las pills de un documento
app.get('/api/v1/documents/:id/pills', async (req, res) => {
  try {
    const { id } = req.params;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    const pills = document.pills || {};

    res.json({
      success: true,
      pills: {
        microSummary: pills.microSummary || null,
        flashcards: pills.flashcards || [],
        highlightConcepts: pills.highlightConcepts || [],
        savedPills: pills.savedPills || []
      }
    });
  } catch (error) {
    console.error('Error al obtener pills:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al obtener las pills'
    });
  }
});

// ✅ Endpoint para guardar una pill (Saved Pills)
app.post('/api/v1/documents/:id/pills/save', async (req, res) => {
  try {
    const { id } = req.params;
    const { pillId, title, description } = req.body;
    const document = documentsStore.get(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado'
      });
    }

    if (!pillId || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'pillId, title y description son requeridos'
      });
    }

    // Guardar pill
    if (!document.pills) document.pills = {};
    if (!document.pills.savedPills) document.pills.savedPills = [];
    
    const savedPill = {
      id: pillId,
      title: title,
      description: description,
      documentId: id,
      savedAt: new Date().toISOString()
    };

    // Evitar duplicados
    const existingIndex = document.pills.savedPills.findIndex(p => p.id === pillId);
    if (existingIndex >= 0) {
      document.pills.savedPills[existingIndex] = savedPill;
    } else {
      document.pills.savedPills.push(savedPill);
    }

    documentsStore.set(id, document);

    res.json({
      success: true,
      savedPill: savedPill
    });
  } catch (error) {
    console.error('Error al guardar pill:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al guardar la pill'
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
    const { message, conversationHistory = [], model = 'gemini-2.5-flash' } = req.body;
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

    const text = document.text || '';
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El documento no tiene texto extraído'
      });
    }

    // Usar Gemini Pro para generar respuesta contextual
    let response = '';
    
    if (geminiClient) {
      try {
        // Preparar el contexto del documento (limitar a 100,000 caracteres)
        const textForGemini = text.length > 100000 ? text.substring(0, 100000) + '...' : text;
        
        // Construir el historial de conversación para contexto
        let conversationContext = '';
        if (conversationHistory && conversationHistory.length > 0) {
          conversationContext = '\n\nHistorial de conversación:\n';
          conversationHistory.slice(-5).forEach((msg, idx) => {
            conversationContext += `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}\n`;
          });
        }
        
        const prompt = `Eres un asistente experto que ayuda a los usuarios a entender documentos. 
        
Documento: "${document.filename}"
Contenido del documento:
${textForGemini}
${conversationContext}

Instrucciones:
- Responde de manera natural y conversacional en español
- Basa tus respuestas únicamente en el contenido del documento proporcionado
- Si la pregunta no está relacionada con el documento, indícalo amablemente
- Sé conciso pero informativo
- Usa un tono profesional pero amigable

Pregunta del usuario: ${message}

Respuesta:`;

        const geminiResponse = await generateWithGemini(prompt, 2000, 60000, model);
        if (geminiResponse) {
          response = geminiResponse.trim();
          console.log(`✅ Respuesta generada con Gemini Pro (modelo: ${model})`);
        } else {
          throw new Error('Gemini no generó respuesta');
        }
      } catch (error) {
        console.error('Error al generar con Gemini Pro, usando fallback:', error.message);
        // Fallback simple
        response = `Basándome en el documento "${document.filename}", puedo ayudarte. Sin embargo, hubo un problema al procesar tu pregunta con el modelo avanzado. Por favor, intenta reformular tu pregunta.`;
      }
    } else {
      // Fallback si Gemini no está configurado
      response = `Basándome en el documento "${document.filename}", puedo ayudarte. Sin embargo, el asistente avanzado no está disponible en este momento. Por favor, intenta más tarde.`;
    }

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

// ✅ Endpoint TTS: Generar audio desde texto usando Gemini-TTS
app.post('/api/v1/tts/speak', async (req, res) => {
  try {
    const { text, lang = 'es', voiceDescription, voiceType, voiceStyle, documentId } = req.body; // Aceptar voiceStyle y voiceDescription

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Texto requerido'
      });
    }

    // Limitar el texto a 5000 caracteres por solicitud
    const textToConvert = text.substring(0, 5000);
    
    // Priorizar voiceStyle y voiceDescription sobre voiceType (para compatibilidad)
    const finalVoiceType = voiceType || 'femenina';
    const finalVoiceStyle = voiceStyle || null;
    const finalVoiceDescription = voiceDescription || null;
    
    // Generar hash único para el cache basado en: texto + voiceStyle/voiceType + lang + voiceDescription
    // Esto permite reutilizar el audio si el texto y la voz no cambian
    const cacheKeyInput = finalVoiceStyle 
      ? `${textToConvert}|${finalVoiceStyle}|${lang}|${finalVoiceDescription || ''}`
      : `${textToConvert}|${finalVoiceType}|${lang}`;
    
    const cacheKey = crypto
      .createHash('sha256')
      .update(cacheKeyInput)
      .digest('hex');
    
    // Directorio para cache de audio
    const audioCacheDir = path.join(__dirname, '../audio_cache');
    if (!fs.existsSync(audioCacheDir)) {
      fs.mkdirSync(audioCacheDir, { recursive: true });
    }
    
    // Ruta del archivo de audio en cache
    const cachedAudioPath = path.join(audioCacheDir, `${cacheKey}.mp3`);
    
    // Verificar si el audio ya existe en cache
    if (fs.existsSync(cachedAudioPath)) {
      const styleInfo = finalVoiceStyle ? `estilo: ${finalVoiceStyle}` : `voz: ${finalVoiceType}`;
      console.log(`✅ Audio encontrado en cache: ${cacheKey.substring(0, 16)}... (${styleInfo})`);
      
      const audioBuffer = fs.readFileSync(cachedAudioPath);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
      
      res.send(audioBuffer);
      return;
    }
    
    const styleInfo = finalVoiceStyle ? `estilo: ${finalVoiceStyle}` : `voz: ${finalVoiceType}`;
    console.log(`🔄 Generando nuevo audio (no encontrado en cache): ${cacheKey.substring(0, 16)}... (${styleInfo})`);
    
    // Si hay voiceDescription, usarlo para generar un prompt más detallado para Google Cloud TTS
    // Google Cloud TTS no soporta directamente descripciones de voz personalizadas,
    // pero podemos usar la descripción para seleccionar parámetros de audio más apropiados
    const useCustomDescription = finalVoiceDescription && finalVoiceDescription.trim().length > 0;
    
    // Prioridad: 1) Google Cloud Text-to-Speech, 2) gTTS (fallback)
    // Las credenciales ADC se buscan automáticamente en ~/.config/gcloud/application_default_credentials.json
    // También se puede configurar GOOGLE_APPLICATION_CREDENTIALS o GOOGLE_CLOUD_PROJECT
    const useGoogleTTS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                         process.env.GOOGLE_CLOUD_PROJECT || 
                         fs.existsSync(path.join(require('os').homedir(), '.config/gcloud/application_default_credentials.json'));
    
    // Intentar usar Google Cloud Text-to-Speech primero
    if (useGoogleTTS) {
      try {
        const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
        const client = new TextToSpeechClient();
        
        // Mapeo de voces Google Cloud Text-to-Speech según estilo o tipo
        // Usando modelo Gemini-TTS (gemini-2.5-flash-tts) para voces más naturales
        const voiceMap = {
          'es': {
            'masculina': 'Kore',    // Voz masculina en español
            'femenina': 'Callirrhoe', // Voz femenina en español
            'profesor': 'Kore',     // Profesor estricto - voz masculina autoritaria
            'podcast': 'Kore',      // Podcast animador - voz masculina dinámica
            'cuentos': 'Callirrhoe'  // Cuentos para dormir - voz femenina suave
          },
          'en': {
            'masculina': 'Orus',
            'femenina': 'Charon',
            'profesor': 'Orus',
            'podcast': 'Orus',
            'cuentos': 'Charon'
          }
        };
        
        // Normalizar código de idioma
        let normalizedLang = lang.includes('-') ? lang.split('-')[0] : lang;
        if (!voiceMap[normalizedLang]) {
          normalizedLang = 'es'; // Fallback a español
        }
        
        // Determinar qué voz usar: priorizar voiceStyle, luego voiceType
        const voiceKey = finalVoiceStyle || finalVoiceType;
        const voiceName = voiceMap[normalizedLang]?.[voiceKey] || voiceMap[normalizedLang]?.['femenina'];
        const languageCode = normalizedLang === 'es' ? 'es-ES' : `${normalizedLang}-US`;
        
        // Ajustar parámetros de audio según el estilo de voz
        let speakingRate = 1.0;
        let pitch = 0.0;
        let volumeGainDb = 0.0;
        
        if (finalVoiceStyle === 'podcast') {
          // Podcast animador: ritmo variado, tono muy expresivo y extrovertido
          speakingRate = 1.15;
          pitch = 4.0; // Pitch mucho más alto para sonar más extrovertido
          volumeGainDb = 2.0; // Más volumen
        } else if (finalVoiceStyle === 'cuentos') {
          // Cuentos para dormir: ritmo lento, tono suave
          speakingRate = 0.85;
          pitch = -2.0;
          volumeGainDb = -1.0;
        } else if (finalVoiceStyle === 'profesor') {
          // Profesor estricto: ritmo moderado, tono claro y enfático
          speakingRate = 1.0;
          pitch = 1.0;
          volumeGainDb = 0.5;
        }
        
        // Usar Google Cloud Text-to-Speech con el modelo gemini-2.5-flash-tts
        // Para voces Gemini-TTS, el modelo DEBE estar dentro del objeto voice
        const request = {
          input: { text: textToConvert },
          voice: {
            languageCode: languageCode,
            name: voiceName,
            model: 'gemini-2.5-flash-tts' // Modelo Gemini-TTS requerido para voces Kore y Callirrhoe
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speakingRate,
            pitch: pitch,
            volumeGainDb: volumeGainDb
          }
        };
        
        const styleInfo2 = finalVoiceStyle ? `estilo=${finalVoiceStyle}` : `tipo=${finalVoiceType}`;
        console.log(`🔍 Google Cloud TTS Request: voice=${voiceName}, lang=${languageCode}, model=gemini-2.5-flash-tts, ${styleInfo2}, rate=${speakingRate}, pitch=${pitch}, textLength=${textToConvert.length}`);
        
        let response;
        try {
          [response] = await client.synthesizeSpeech(request);
        } catch (googleError) {
          // Si falla con Gemini-TTS, intentar con voces estándar de Google Cloud TTS
          if (googleError.message && googleError.message.includes('model')) {
            console.log(`⚠️ Error con Gemini-TTS, intentando con voces estándar de Google Cloud TTS...`);
            const standardVoiceMap = {
              'es': {
                'masculina': 'es-ES-Standard-B',    // Voz masculina estándar
                'femenina': 'es-ES-Standard-C'       // Voz femenina estándar
              },
              'en': {
                'masculina': 'en-US-Standard-B',
                'femenina': 'en-US-Standard-C'
              }
            };
            const standardVoiceName = standardVoiceMap[normalizedLang]?.[finalVoiceType] || standardVoiceMap[normalizedLang]?.['femenina'];
            
            const standardRequest = {
              input: { text: textToConvert },
              voice: {
                languageCode: languageCode,
                name: standardVoiceName
              },
              audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: 1.0,
                pitch: 0.0,
                volumeGainDb: 0.0
              }
            };
            
            console.log(`🔍 Google Cloud TTS Request (estándar): voice=${standardVoiceName}, lang=${languageCode}, textLength=${textToConvert.length}`);
            [response] = await client.synthesizeSpeech(standardRequest);
          } else {
            throw googleError;
          }
        }
        
        const audioBuffer = Buffer.from(response.audioContent);
        
        const styleInfo3 = finalVoiceStyle ? `estilo: ${finalVoiceStyle}` : `voz: ${finalVoiceType}`;
        console.log(`✅ Audio generado con Google Cloud Text-to-Speech: ${audioBuffer.length} bytes, ${styleInfo3} (${voiceName})`);
        
        // Guardar audio en cache para reutilización
        fs.writeFileSync(cachedAudioPath, audioBuffer);
        console.log(`💾 Audio guardado en cache: ${cacheKey.substring(0, 16)}...`);
        
        // Configurar headers para streaming de audio
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', audioBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
        
        // Enviar el audio
        res.send(audioBuffer);
        return;
      } catch (googleError) {
        console.error('⚠️ Error con Google Cloud Text-to-Speech, usando gTTS como fallback:', googleError.message);
        console.error('Detalles del error:', googleError);
        // Continuar con gTTS como fallback
      }
    } else {
      console.log('ℹ️ Google Cloud Text-to-Speech no configurado, usando gTTS. Para usar Google Cloud TTS, configura GOOGLE_APPLICATION_CREDENTIALS o GOOGLE_CLOUD_PROJECT');
    }
    
    // Fallback a gTTS si Google Cloud TTS no está disponible o falla
    // Verificar si ya existe en cache (también para gTTS)
    if (fs.existsSync(cachedAudioPath)) {
      console.log(`✅ Audio encontrado en cache (gTTS): ${cacheKey.substring(0, 16)}... (voz: ${finalVoiceType})`);
      
      const audioBuffer = fs.readFileSync(cachedAudioPath);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      res.send(audioBuffer);
      return;
    }
    
    const gtts = require('gtts');
    const audioDir = path.join(__dirname, '../audio');
    
    // Crear directorio de audio temporal si no existe (para gTTS)
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Usar el mismo cache key para gTTS también
    const tempAudioPath = path.join(audioDir, `${cacheKey}-temp.mp3`);
    
    // Validar y normalizar el código de idioma
    let normalizedLang = lang;
    if (lang.includes('-')) {
      normalizedLang = lang.split('-')[0];
      console.log(`Código de idioma normalizado de '${lang}' a '${normalizedLang}'`);
    }
    
    // Validar que el código sea válido
    const validLangs = ['es', 'en', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi'];
    if (!validLangs.includes(normalizedLang)) {
      console.warn(`Código de idioma '${normalizedLang}' no está en la lista de válidos, usando 'es' por defecto`);
      normalizedLang = 'es';
    }
    
    const tts = new gtts(textToConvert, normalizedLang);
    
    return new Promise((resolve, reject) => {
      tts.save(tempAudioPath, async (err) => {
        if (err) {
          console.error('Error al generar audio con gTTS:', err);
          return res.status(500).json({
            success: false,
            message: 'Error al generar el audio: ' + err.message
          });
        }
        
        // Verificar que el archivo se creó correctamente
        if (!fs.existsSync(tempAudioPath)) {
          console.error('El archivo de audio no se creó');
          return res.status(500).json({
            success: false,
            message: 'Error: El archivo de audio no se generó correctamente'
          });
        }
        
        try {
          // Leer el archivo y guardarlo en cache
          const audioBuffer = fs.readFileSync(tempAudioPath);
          
          if (audioBuffer.length === 0) {
            console.error('El archivo de audio está vacío');
            // Limpiar archivo temporal
            if (fs.existsSync(tempAudioPath)) {
              fs.unlinkSync(tempAudioPath);
            }
            return res.status(500).json({
              success: false,
              message: 'Error: El archivo de audio está vacío'
            });
          }
          
          console.log(`✅ Audio generado exitosamente con gTTS: ${audioBuffer.length} bytes`);
          
          // Guardar en cache para reutilización
          fs.writeFileSync(cachedAudioPath, audioBuffer);
          console.log(`💾 Audio guardado en cache (gTTS): ${cacheKey.substring(0, 16)}...`);
          
          // Limpiar archivo temporal
          if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
          }
          
          // Configurar headers para streaming de audio
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Length', audioBuffer.length);
          res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
          
          // Enviar el audio
          res.send(audioBuffer);
          
          resolve();
        } catch (readError) {
          console.error('Error al leer el archivo de audio:', readError);
          // Limpiar archivo temporal en caso de error
          if (fs.existsSync(tempAudioPath)) {
            fs.unlinkSync(tempAudioPath);
          }
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

// ✅ Endpoints de Google Calendar
// Obtener URL de autenticación
app.get('/api/v1/calendar/auth', (req, res) => {
  try {
    // Incluir scope de userinfo para poder obtener el email del usuario
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email'
    ];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('Error al generar URL de autenticación:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Callback de OAuth2
app.get('/api/v1/calendar/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Código de autorización no proporcionado' });
    }

    console.log('🔄 Intercambiando código por tokens...');
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log('✅ Tokens obtenidos, intentando obtener información del usuario...');
    
    // Intentar obtener información del usuario, pero si falla, usar un ID temporal
    let userId = 'user-' + Date.now();
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      userId = userInfo.data.email || userInfo.data.id || userId;
      console.log('✅ Información del usuario obtenida:', userId);
    } catch (userInfoError) {
      console.warn('⚠️ No se pudo obtener información del usuario, usando ID temporal:', userInfoError.message);
      // Si no podemos obtener el email, usamos un ID temporal basado en el token
      userId = tokens.access_token ? `user-${tokens.access_token.substring(0, 20)}` : userId;
    }
    
    // Guardar tokens (en producción usar base de datos)
    userTokens.set(userId, tokens);
    console.log('✅ Tokens guardados para usuario:', userId);
    console.log('📋 Token info:', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'
    });
    
    // Redirigir al frontend con el token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/dashboard/calendar-success?userId=${encodeURIComponent(userId)}`);
  } catch (error) {
    console.error('❌ Error en callback de OAuth2:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/dashboard/calendar-error?error=${encodeURIComponent(error.message)}`);
  }
});

// Crear evento recurrente en Google Calendar
app.post('/api/v1/calendar/create-event', async (req, res) => {
  try {
    const { userId, documentId, documentName, daysOfWeek, time, durationWeeks = 52, timezone = 'America/Santiago' } = req.body;

    if (!userId || !documentId || !documentName || !daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !time) {
      return res.status(400).json({
        success: false,
        message: 'userId, documentId, documentName, daysOfWeek (array), y time son requeridos'
      });
    }

    // Obtener tokens del usuario
    const tokens = userTokens.get(userId);
    console.log('🔍 Buscando tokens para userId:', userId, 'Encontrados:', !!tokens);
    
    if (!tokens) {
      console.error('❌ No se encontraron tokens para userId:', userId);
      console.log('📋 Usuarios con tokens guardados:', Array.from(userTokens.keys()));
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado. Por favor, autoriza el acceso a Google Calendar primero.'
      });
    }

    // Verificar si el token está expirado y refrescarlo si es necesario
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
      console.log('🔄 Token expirado, refrescando...');
      try {
        oauth2Client.setCredentials(tokens);
        const { credentials } = await oauth2Client.refreshAccessToken();
        tokens.access_token = credentials.access_token;
        tokens.expiry_date = credentials.expiry_date;
        userTokens.set(userId, tokens);
        console.log('✅ Token refrescado exitosamente');
      } catch (refreshError) {
        console.error('❌ Error al refrescar token:', refreshError);
        userTokens.delete(userId);
        return res.status(401).json({
          success: false,
          message: 'Sesión expirada. Por favor, autoriza el acceso a Google Calendar nuevamente.'
        });
      }
    }

    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Convertir días de la semana a formato RRULE (0=Domingo, 1=Lunes, ..., 6=Sábado)
    const dayMap = {
      0: 'SU', // Domingo
      1: 'MO', // Lunes
      2: 'TU', // Martes
      3: 'WE', // Miércoles
      4: 'TH', // Jueves
      5: 'FR', // Viernes
      6: 'SA'  // Sábado
    };

    const rruleDays = daysOfWeek.map(day => dayMap[day]).join(',');

    // Parsear hora (formato HH:MM)
    const [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return res.status(400).json({
        success: false,
        message: 'Formato de hora inválido. Use HH:MM (24 horas).'
      });
    }

    // Crear fecha de inicio (próxima ocurrencia de los días seleccionados)
    const now = new Date();
    const today = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    const selectedDays = daysOfWeek.sort((a, b) => a - b);
    
    console.log('📅 Fecha actual:', now.toISOString(), 'Día de hoy:', today, 'Timezone:', timezone);
    console.log('📅 Días seleccionados:', selectedDays, 'Hora:', time);
    
    // Crear fecha base para hoy con la hora seleccionada
    const startDate = new Date(now);
    startDate.setHours(hours, minutes, 0, 0);
    startDate.setSeconds(0, 0);
    startDate.setMilliseconds(0);
    
    let daysToAdd = 0;
    
    // Verificar si hoy es uno de los días seleccionados
    const isTodaySelected = selectedDays.includes(today);
    
    if (isTodaySelected) {
      // Si hoy está seleccionado y la hora aún no ha pasado, usar hoy
      if (startDate > now) {
        daysToAdd = 0;
        console.log('📅 Hoy está seleccionado y la hora aún no ha pasado, usando hoy');
      } else {
        // La hora ya pasó, buscar el próximo día
        for (const day of selectedDays) {
          if (day > today) {
            daysToAdd = day - today;
            break;
          }
        }
        // Si no hay día después de hoy, usar el primer día de la próxima semana
        if (daysToAdd === 0) {
          daysToAdd = (7 - today) + selectedDays[0];
          console.log('📅 La hora ya pasó hoy, usando el primer día de la próxima semana');
        }
      }
    } else {
      // Hoy no está seleccionado, buscar el próximo día
      for (const day of selectedDays) {
        if (day > today) {
          daysToAdd = day - today;
          break;
        }
      }
      // Si no hay día después de hoy, usar el primer día de la próxima semana
      if (daysToAdd === 0) {
        daysToAdd = (7 - today) + selectedDays[0];
        console.log('📅 No hay día esta semana, usando el primer día de la próxima semana');
      }
    }
    
    // Aplicar el desplazamiento de días
    startDate.setDate(startDate.getDate() + daysToAdd);
    startDate.setHours(hours, minutes, 0, 0);
    startDate.setSeconds(0, 0);
    startDate.setMilliseconds(0);
    
    // Asegurar que la fecha no esté en el pasado
    if (startDate <= now) {
      console.warn('⚠️ La fecha calculada está en el pasado, agregando una semana más');
      startDate.setDate(startDate.getDate() + 7);
    }
    
    console.log('📅 Fecha final calculada:', startDate.toISOString(), 'Días agregados:', daysToAdd);
    console.log('📅 Fecha en formato local:', startDate.toLocaleString('es-ES', { timeZone: timezone }));

    // Fecha de fin (1 hora después)
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    // Obtener información del calendario antes de crear el evento
    let calendarInfo = null;
    try {
      const calendarList = await calendar.calendarList.list();
      const primaryCal = calendarList.data.items?.find(c => c.primary) || calendarList.data.items?.[0];
      calendarInfo = {
        id: primaryCal?.id,
        summary: primaryCal?.summary,
        timeZone: primaryCal?.timeZone,
        accessRole: primaryCal?.accessRole
      };
      console.log('📅 Información del calendario principal:', calendarInfo);
    } catch (calError) {
      console.warn('⚠️ No se pudo obtener información del calendario:', calError.message);
    }

    // Crear evento recurrente
    const event = {
      summary: `📚 Repaso de Pills: ${documentName}`,
      description: `Recordatorio para repasar las Flash Pills del documento "${documentName}".\n\nDocumento ID: ${documentId}\n\nEste evento se repetirá semanalmente en los días seleccionados.`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: timezone
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: timezone
      },
      recurrence: [
        durationWeeks > 0 
          ? `RRULE:FREQ=WEEKLY;BYDAY=${rruleDays};WKST=SU;COUNT=${durationWeeks}`
          : `RRULE:FREQ=WEEKLY;BYDAY=${rruleDays};WKST=SU`
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 día antes por email
          { method: 'popup', minutes: 15 } // 15 minutos antes por popup
        ]
      },
      colorId: '10', // Color verde para eventos de estudio
      visibility: 'default',
      transparency: 'opaque'
    };
    
    console.log('📅 Evento a crear:', {
      summary: event.summary,
      start: event.start.dateTime,
      end: event.end.dateTime,
      timeZone: event.start.timeZone,
      recurrence: event.recurrence,
      rruleDays: rruleDays
    });

    console.log('📅 Creando evento en Google Calendar:', {
      userId,
      documentName,
      daysOfWeek,
      time,
      startDate: startDate.toISOString(),
      rruleDays,
      calendarId: 'primary'
    });

    try {
      console.log('🔄 Insertando evento en Google Calendar...');
      console.log('📋 Detalles del evento:', JSON.stringify({
        summary: event.summary,
        start: event.start,
        end: event.end,
        recurrence: event.recurrence
      }, null, 2));
      
      // Crear el evento usando events.insert() como se especifica en la documentación
      const response = await calendar.events.insert({
        calendarId: 'primary', // Calendario principal del usuario
        resource: event,
        sendUpdates: 'none' // No enviar notificaciones ya que no hay asistentes
      });
      
      console.log('📡 Respuesta completa de events.insert():', {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data
      });

      const calendarId = response.data.organizer?.email || userId || 'primary';
      
      console.log('✅ Evento insertado en Google Calendar API:', {
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
        startTime: response.data.start.dateTime,
        summary: response.data.summary,
        calendarId: calendarId,
        organizerEmail: response.data.organizer?.email,
        creatorEmail: response.data.creator?.email,
        status: response.data.status,
        created: response.data.created,
        updated: response.data.updated,
        recurrence: response.data.recurrence,
        attendees: response.data.attendees?.length || 0,
        visibility: response.data.visibility,
        transparency: response.data.transparency
      });

      // Verificar que el evento realmente existe haciendo una consulta inmediata
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1 segundo
        const verifyEvent = await calendar.events.get({
          calendarId: 'primary',
          eventId: response.data.id
        });
        console.log('✅ Evento verificado exitosamente en Google Calendar:', {
          verified: true,
          eventId: verifyEvent.data.id,
          summary: verifyEvent.data.summary,
          status: verifyEvent.data.status,
          start: verifyEvent.data.start.dateTime,
          recurrence: verifyEvent.data.recurrence
        });
        
        // También listar eventos próximos para confirmar
        try {
          const listResponse = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date().toISOString(),
            maxResults: 50,
            singleEvents: false
          });
          
          console.log('📋 Total de eventos encontrados en el calendario:', listResponse.data.items?.length || 0);
          
          const matchingEvents = listResponse.data.items?.filter(e => 
            e.summary?.includes('Repaso de Pills') || e.id === response.data.id
          ) || [];
          
          console.log('📋 Eventos de repaso encontrados en el calendario:', matchingEvents.length);
          if (matchingEvents.length > 0) {
            console.log('📅 Calendario usado: primary (', calendarId, ')');
            matchingEvents.forEach(e => {
              console.log('  ✅', e.summary, '| ID:', e.id, '| Start:', e.start?.dateTime || e.start?.date, '| Status:', e.status, '| Organizer:', e.organizer?.email);
            });
            // Mostrar el evento recién creado específicamente
            const newlyCreated = matchingEvents.find(e => e.id === response.data.id);
            if (newlyCreated) {
              console.log('🎯 Evento recién creado encontrado en la lista:', {
                id: newlyCreated.id,
                summary: newlyCreated.summary,
                start: newlyCreated.start?.dateTime || newlyCreated.start?.date,
                recurrence: newlyCreated.recurrence,
                organizer: newlyCreated.organizer?.email,
                calendarId: 'primary'
              });
            } else {
              console.warn('⚠️ El evento recién creado (ID:', response.data.id, ') no aparece en la lista de eventos de repaso');
            }
          } else {
            console.warn('⚠️ No se encontraron eventos de repaso en la lista, pero el evento fue creado con ID:', response.data.id);
            console.log('📋 Primeros 5 eventos en el calendario:');
            listResponse.data.items?.slice(0, 5).forEach(e => {
              console.log('  -', e.summary || '(sin título)', '| Start:', e.start?.dateTime || e.start?.date, '| Organizer:', e.organizer?.email);
            });
          }
        } catch (listError) {
          console.error('⚠️ Error al listar eventos:', listError.message);
        }
      } catch (verifyError) {
        console.error('❌ Error al verificar evento:', {
          message: verifyError.message,
          code: verifyError.code,
          details: verifyError.response?.data
        });
      }

      res.json({
        success: true,
        message: 'Evento creado exitosamente en Google Calendar',
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
        calendarLink: `https://calendar.google.com/calendar/u/0/r`,
        startTime: response.data.start.dateTime,
        calendarId: calendarId,
        calendarSummary: calendarInfo?.summary || 'Calendario principal',
        eventSummary: response.data.summary,
        recurrence: response.data.recurrence,
        // Información adicional para debugging
        debug: {
          organizerEmail: response.data.organizer?.email,
          creatorEmail: response.data.creator?.email,
          status: response.data.status,
          visibility: response.data.visibility,
          calendarInfo: calendarInfo
        }
      });
    } catch (calendarError) {
      console.error('❌ Error al insertar evento en Google Calendar:', {
        error: calendarError.message,
        code: calendarError.code,
        userId: userId,
        hasTokens: !!tokens
      });
      throw calendarError; // Re-lanzar para que se maneje en el catch externo
    }
  } catch (error) {
    console.error('❌ Error al crear evento en Google Calendar:', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: error.message || 'Error al crear el evento en Google Calendar',
      details: error.code || 'Unknown error'
    });
  }
});

// Endpoint de prueba para listar eventos de repaso
app.get('/api/v1/calendar/list-events/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const tokens = userTokens.get(userId);
    
    if (!tokens) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const listResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 100,
      singleEvents: false,
      q: 'Repaso de Pills'
    });

    const allEvents = listResponse.data.items || [];
    const repasoEvents = allEvents.filter(e => e.summary?.includes('Repaso de Pills'));

    res.json({
      success: true,
      totalEvents: allEvents.length,
      repasoEvents: repasoEvents.length,
      events: repasoEvents.map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        status: e.status,
        recurrence: e.recurrence
      }))
    });
  } catch (error) {
    console.error('Error al listar eventos:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Verificar si el usuario está autenticado
app.get('/api/v1/calendar/check-auth/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const tokens = userTokens.get(userId);
    
    if (!tokens) {
      return res.json({ success: false, authenticated: false });
    }

    // Verificar si el token es válido
    oauth2Client.setCredentials(tokens);
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.calendarList.list({ maxResults: 1 });
      res.json({ success: true, authenticated: true });
    } catch (error) {
      // Token inválido o expirado
      userTokens.delete(userId);
      res.json({ success: false, authenticated: false });
    }
  } catch (error) {
    console.error('Error al verificar autenticación:', error);
    res.status(500).json({ success: false, message: error.message });
  }
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


