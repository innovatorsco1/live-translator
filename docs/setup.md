# Live Translator - Guía de Configuración para el Evento

## Requisitos Previos

- **Node.js** 18+ instalado
- **Google Chrome** o **Microsoft Edge** (necesario para Web Speech API)
- **API Key de OpenAI** con acceso a GPT-4
- Conexión a internet estable (para traducción y speech-to-text)
- Micrófono conectado al equipo del operador

## Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd live-translator

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env.local
```

Editar `.env.local` y agregar la API key de OpenAI:

```
OPENAI_API_KEY=sk-tu-api-key-aqui
WS_PORT=3001
PORT=3000
```

## Ejecución

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm run build
npm start
```

Esto inicia:
- Servidor HTTP (Next.js) en el puerto **3000**
- Servidor WebSocket en el puerto **3001**

## Arquitectura del Sistema

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Micrófono   │────▶│   Control    │────▶│  OpenAI API  │
│  del speaker │     │   Panel      │     │  (GPT-4)     │
└─────────────┘     │  :3000/control│     └──────┬───────┘
                     └──────┬───────┘            │
                            │                     │
                     WebSocket (:3001)      Traducción
                            │                     │
                     ┌──────▼───────┐            │
                     │   Display    │◀───────────┘
                     │  :3000/display│
                     │  (Proyector) │
                     └──────────────┘
```

## Setup para el Día del Evento

### Equipos Necesarios

1. **Laptop del operador** - Ejecuta el servidor y el panel de control
2. **Pantalla/Proyector** - Muestra los subtítulos al público
3. **Micrófono** - Captura la voz del conferencista

### Paso a Paso

#### 1. Preparar el servidor (30 min antes)

```bash
cd live-translator
npm run build
npm start
```

Verificar que aparezca:
```
[server] Next.js ready   → http://0.0.0.0:3000
[server] WebSocket ready → ws://0.0.0.0:3001
```

#### 2. Abrir el panel de control

En **Chrome** en la laptop del operador:
```
http://localhost:3000/control
```

- Verificar que el indicador de conexión esté en verde ("Connected")
- Probar el micrófono con el botón START

#### 3. Abrir el display en el proyector

En la pantalla/proyector, abrir Chrome en modo fullscreen (F11):
```
http://<IP-DEL-SERVIDOR>:3000/display
```

Si el proyector está conectado a la misma laptop:
```
http://localhost:3000/display
```

#### Parámetros de display personalizables (URL):

| Parámetro     | Valores         | Default | Ejemplo |
|---------------|-----------------|---------|---------|
| `fontSize`    | 24-96 (px)      | 48      | `?fontSize=64` |
| `maxLines`    | 1-5             | 3       | `?maxLines=2` |
| `showOriginal`| true/false      | true    | `?showOriginal=false` |
| `theme`       | dark/light      | dark    | `?theme=light` |

Ejemplo completo:
```
http://localhost:3000/display?fontSize=56&maxLines=2&showOriginal=false
```

#### 4. Verificar la red

Si el display está en otro equipo en la red:
- Ambos equipos deben estar en la **misma red WiFi/LAN**
- Usar la IP del servidor (ej: `http://192.168.1.100:3000/display`)
- Asegurar que los puertos **3000** y **3001** estén abiertos en el firewall

### Durante el Evento

1. **Operador**: Presionar **START** cuando el conferencista comience
2. **Monitorear**: El panel muestra el texto original y la traducción
3. **Ajustar**: Usar los controles de configuración si es necesario
4. **Limpiar**: Usar "Clear Display" entre secciones si se acumula texto
5. **Pausar**: Presionar **STOP** durante breaks o cambios de tema

### Troubleshooting

| Problema | Solución |
|----------|----------|
| "Web Speech API not supported" | Usar Google Chrome o Edge |
| No se escucha el micrófono | Verificar permisos del navegador (icono de candado) |
| Display desconectado | Verificar que ambos equipos estén en la misma red |
| Traducción lenta | Verificar conexión a internet; GPT-4 requiere ~1-2s |
| Texto cortado | Reducir maxLines o aumentar fontSize |
| Subtítulos ilegibles | Ajustar fontSize vía URL o panel de control |

### Tips para Mejor Rendimiento

- Usar **conexión por cable (ethernet)** cuando sea posible
- Mantener el micrófono **cerca del conferencista** (< 2 metros)
- Hablar claramente y a velocidad moderada
- El **tema oscuro** funciona mejor con proyectores
- Hacer una **prueba completa 1 hora antes** del evento
