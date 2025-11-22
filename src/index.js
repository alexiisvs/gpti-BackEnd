require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// ✅ Endpoint TTS: Generar audio desde texto usando Gemini-TTS
app.post('/api/v1/tts/speak', async (req, res) => {
  try {
    const { text, lang = 'es', voiceDescription, voiceType, documentId } = req.body; // Aceptar ambos para compatibilidad

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Texto requerido'
      });
    }

    // Limitar el texto a 5000 caracteres por solicitud
    const textToConvert = text.substring(0, 5000);
    
    // Usar voiceType o 'femenina' por defecto
    const finalVoiceType = voiceType || 'femenina';
    
    // Generar hash único para el cache basado en: texto + voiceType + lang
    // Esto permite reutilizar el audio si el texto y la voz no cambian
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${textToConvert}|${finalVoiceType}|${lang}`)
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
      console.log(`✅ Audio encontrado en cache: ${cacheKey.substring(0, 16)}... (voz: ${finalVoiceType})`);
      
      const audioBuffer = fs.readFileSync(cachedAudioPath);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
      
      res.send(audioBuffer);
      return;
    }
    
    console.log(`🔄 Generando nuevo audio (no encontrado en cache): ${cacheKey.substring(0, 16)}... (voz: ${finalVoiceType})`);
    
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
        
        // Mapeo de voces Google Cloud Text-to-Speech según tipo (masculina/femenina) e idioma
        // Usando modelo Gemini-TTS (gemini-2.5-flash-tts) para voces más naturales
        // Las voces Gemini-TTS requieren que el modelo se especifique en el request
        const voiceMap = {
          'es': {
            'masculina': 'Kore',    // Voz masculina en español
            'femenina': 'Callirrhoe' // Voz femenina en español
          },
          'en': {
            'masculina': 'Orus',
            'femenina': 'Charon'
          }
        };
        
        // Normalizar código de idioma
        let normalizedLang = lang.includes('-') ? lang.split('-')[0] : lang;
        if (!voiceMap[normalizedLang]) {
          normalizedLang = 'es'; // Fallback a español
        }
        
        const voiceName = voiceMap[normalizedLang]?.[finalVoiceType] || voiceMap[normalizedLang]?.['femenina'];
        const languageCode = normalizedLang === 'es' ? 'es-ES' : `${normalizedLang}-US`;
        
        // Usar Google Cloud Text-to-Speech con el modelo gemini-2.5-flash-tts
        // Para voces Gemini-TTS, el modelo DEBE estar dentro del objeto voice
        const request = {
          input: { text: textToConvert },
          voice: {
            languageCode: languageCode,
            name: voiceName,
            model: 'gemini-2.5-flash-tts' // Modelo Gemini-TTS requerido para voces Kore y Callirrhoe (debe estar aquí)
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0.0, // Pitch neutral, se puede ajustar
            volumeGainDb: 0.0
          }
        };
        
        console.log(`🔍 Google Cloud TTS Request: voice=${voiceName}, lang=${languageCode}, model=gemini-2.5-flash-tts, textLength=${textToConvert.length}`);
        
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
        
        console.log(`✅ Audio generado con Google Cloud Text-to-Speech: ${audioBuffer.length} bytes, voz: ${voiceName} (${finalVoiceType})`);
        
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


