# Cómo encontrar tu Client Secret de Google Calendar API

## Pasos:

1. **Ve a Google Cloud Console:**
   - https://console.cloud.google.com/

2. **Navega a Credentials:**
   - En el menú lateral, ve a "APIs & Services" > "Credentials"

3. **Busca tu OAuth 2.0 Client ID:**
   - Deberías ver una lista con tu Client ID (algo como `xxxxx-xxxxx.apps.googleusercontent.com`)
   - Haz clic en el nombre del OAuth client ID (o en el ícono de lápiz para editarlo)

4. **Ver el Client Secret:**
   - En la página de detalles, verás:
     - **Client ID:** (ya lo tienes)
     - **Client secret:** (este es el que necesitas)
   - Si no ves el secret, puede que esté oculto. Haz clic en "Show" o en el ícono del ojo 👁️ para revelarlo

5. **Si no puedes verlo:**
   - Puede que necesites regenerarlo
   - Haz clic en "Reset secret" o "Regenerate secret"
   - **⚠️ IMPORTANTE:** Si regeneras el secret, el anterior dejará de funcionar

## Alternativa: Descargar el JSON

Si descargaste el archivo JSON cuando creaste las credenciales:
- Busca un archivo llamado algo como `client_secret_*.json`
- Abre ese archivo y busca el campo `client_secret`

