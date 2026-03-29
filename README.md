# Live Translator - Subtítulos en Tiempo Real

Sistema de traducción en vivo para eventos. Traduce speech en inglés a subtítulos en español en tiempo real.

## Caso de Uso

Evento en Medellín con conferencista en inglés. La solución debe:
1. Capturar audio del conferencista en tiempo real
2. Transcribir speech-to-text en inglés
3. Traducir a español instantáneamente
4. Mostrar subtítulos en pantalla grande para el público

## Requerimientos Técnicos

### Funcionales
- [ ] Captura de audio en tiempo real (micrófono/línea)
- [ ] Speech-to-text con baja latencia (<1s)
- [ ] Traducción EN→ES en tiempo real
- [ ] Display de subtítulos optimizado para proyección
- [ ] Interfaz de control para operador

### No Funcionales
- Latencia total < 2 segundos
- Precisión de transcripción > 95%
- UI legible a distancia (fuentes grandes, alto contraste)
- Funcionar offline o con conexión limitada

## Stack Sugerido

- **Frontend**: Next.js / React para display de subtítulos
- **Speech-to-Text**: Whisper API / Web Speech API / Deepgram
- **Traducción**: DeepL API / Google Translate API / OpenAI
- **Audio**: Web Audio API para captura

## Estructura del Proyecto

```
live-translator/
├── apps/
│   ├── display/      # Pantalla de subtítulos (fullscreen)
│   └── control/      # Panel de control del operador
├── packages/
│   ├── transcription/ # Módulo speech-to-text
│   ├── translation/   # Módulo de traducción
│   └── shared/        # Tipos y utilidades compartidas
└── docs/
    └── setup.md       # Guía de configuración para el evento
```

## Autor

Innovaitors SAS - Medellín, Colombia
