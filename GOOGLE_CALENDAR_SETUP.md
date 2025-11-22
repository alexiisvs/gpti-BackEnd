# Configuración de Google Calendar API

Para habilitar la funcionalidad de programar repasos de Flash Pills en Google Calendar, necesitas configurar las credenciales de OAuth2.

## Pasos para configurar:

1. **Crear un proyecto en Google Cloud Console:**
   - Ve a https://console.cloud.google.com/
   - Crea un nuevo proyecto o selecciona uno existente

2. **Habilitar Google Calendar API:**
   - En el menú lateral, ve a "APIs & Services" > "Library"
   - Busca "Google Calendar API"
   - Haz clic en "Enable"

3. **Crear credenciales OAuth2:**
   - Ve a "APIs & Services" > "Credentials"
   - Haz clic en "Create Credentials" > "OAuth client ID"
   - Si es la primera vez, configura la pantalla de consentimiento OAuth:
     - Tipo de aplicación: "Web application"
     - Nombre: "AudIA Calendar Integration"
     - Authorized redirect URIs: `http://localhost:3000/api/v1/calendar/oauth2callback`
   - Crea el OAuth client ID
   - Descarga el archivo JSON o copia el Client ID y Client Secret

4. **Configurar variables de entorno:**
   Agrega las siguientes variables a tu archivo `.env`:
   ```
   GOOGLE_CLIENT_ID=tu_client_id_aqui
   GOOGLE_CLIENT_SECRET=tu_client_secret_aqui
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/calendar/oauth2callback
   FRONTEND_URL=http://localhost:5173
   ```

5. **Reiniciar el backend:**
   ```bash
   npm start
   ```

## Uso:

1. En el Player, haz clic en "Programar repasos"
2. Si no estás autenticado, se te pedirá conectar tu cuenta de Google Calendar
3. Selecciona los días de la semana y la hora para los repasos
4. Los eventos se crearán automáticamente en tu Google Calendar con recordatorios

## Notas:

- Los eventos se crean como eventos recurrentes semanales por 52 semanas (1 año)
- Los recordatorios se configuran para:
  - Email: 1 día antes
  - Popup: 15 minutos antes
- Los tokens de autenticación se almacenan en memoria (en producción, usar una base de datos)

