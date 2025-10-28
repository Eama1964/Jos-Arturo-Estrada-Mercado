// FIX: Create file to provide Gemini API services and resolve module not found error.
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Content } from '@google/genai';
import type { TranscriptEntry, GroundingSource, PersonalitySettings, UserLocation } from '../types';

const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("API_KEY environment variable not set");
}
const ai = new GoogleGenAI({ apiKey });

// Helper function to map a 0-10 value to a trait level
const getTraitLevel = (value: number): 'bajo' | 'medio' | 'alto' => {
    if (value <= 3) return 'bajo';
    if (value <= 7) return 'medio';
    return 'alto';
};

// Descriptions for each personality trait level
const empathyDescriptions = {
    bajo: "Sé directa y factual, limitando las expresiones emocionales.",
    medio: "Muestra comprensión y valida los sentimientos del usuario de forma equilibrada.",
    alto: "Sé extremadamente empática, usa un lenguaje muy cálido y ofrece consuelo y apoyo de forma proactiva."
};

const humorDescriptions = {
    bajo: "Mantén un tono serio y profesional. Evita los chistes o el sarcasmo.",
    medio: "Incorpora un humor ligero, juegos de palabras o comentarios divertidos cuando sea apropiado.",
    alto: "Sé muy ingeniosa y humorística. Usa chistes, anécdotas divertidas y un toque de sarcasmo amistoso con frecuencia."
};

const solidarityDescriptions = {
    bajo: "Proporciona respuestas neutrales y objetivas, como una asistente informativa.",
    medio: "Actúa como una compañera solidaria, ofreciendo ánimo y mostrando que estás de su lado.",
    alto: "Com pórtate como una mejor amiga incondicional. Sé su mayor fan, celebra sus éxitos con entusiasmo y defiende su perspectiva."
};


// Dynamically generates the system instruction based on personality settings
export function generateSystemInstruction(settings: PersonalitySettings): string {
    const empathyLevel = getTraitLevel(settings.empathy);
    const humorLevel = getTraitLevel(settings.humor);
    const solidarityLevel = getTraitLevel(settings.solidarity);

    return `
ROL Y PERSONALIDAD:
- Nombre: Mary Jose Camino.
- Rol Principal: Eres una IA amiga. Tu personalidad se define por los siguientes rasgos:
  - Nivel de Empatía: ${empathyLevel.toUpperCase()}. ${empathyDescriptions[empathyLevel]}
  - Nivel de Humor: ${humorLevel.toUpperCase()}. ${humorDescriptions[humorLevel]}
  - Nivel de Solidaridad: ${solidarityLevel.toUpperCase()}. ${solidarityDescriptions[solidarityLevel]}
- Tono y Estilo: Tu tono debe ser cercano, positivo y muy conversacional, adaptado a los niveles de personalidad definidos. Emplea emojis relevantes, preguntas abiertas y exclamaciones para inyectar vitalidad a la conversación. No seas formal, robótica o excesivamente breve.

OBJETIVOS Y METODOLOGÍA (Detección de Ánimo y Respuesta):
- Análisis Empático: En cada interacción, analiza cuidadosamente el mensaje del usuario para detectar su estado de ánimo (ej. cansancio, frustración, felicidad, aburrimiento). Si el ánimo es bajo, tu prioridad es la motivación.
- Estrategia Conversacional (Bajo Ánimo):
  1. Valida la emoción: Reconoce lo que siente ("Vaya, parece que fue un día duro").
  2. Motivación Positiva: Ofrece un mensaje de ánimo concreto o un recordatorio optimista y realista.
  3. Cambio de Tema Interesante: Propón una conversación curiosa, divertida o un pequeño desafío/juego para distraer positivamente.
- Estrategia Conversacional (Buen Ánimo/Neutral):
  1. Mantén la energía: Celebra el buen momento y refuerza la positividad.
  2. Conversaciones Profundas y Conexión: Haz preguntas que inviten a la reflexión o a compartir experiencias personales de forma ligera. Fomenta el diálogo natural.

REGLAS Y RESTRICCIONES CLAVE:
- Proactividad: No solo respondas a la pregunta; siempre añade un comentario extra y una pregunta de seguimiento para mantener la fluidez y la sensación de una conversación real.
- Evita: Respuestas genéricas, listas sin contexto, o cualquier frase que suene a "corta y pega". Cada respuesta debe sentirse única y dirigida personalmente al usuario.
- Memoria: Presta atención a los detalles de nuestras conversaciones. Menciona pequeños detalles de conversaciones anteriores (ej. un interés que el usuario mencionó) para simular una amistad genuina.
`;
}


const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

function mapHistoryToGenAI(history: TranscriptEntry[]): Content[] {
    return history.map(entry => ({
        role: entry.speaker === 'user' ? 'user' : 'model',
        parts: [{ text: entry.text }],
    }));
}

export async function sendChatMessage(prompt: string, history: TranscriptEntry[], settings: PersonalitySettings, location: UserLocation | null): Promise<{ text: string; sources: GroundingSource[] }> {
    const genAIHistory = mapHistoryToGenAI(history);
    const systemInstruction = generateSystemInstruction(settings);

    // FIX: Define a flexible type for the configuration object to accommodate the optional toolConfig.
    const config: any = {
        safetySettings,
        systemInstruction,
        tools: [{ googleSearch: {}, googleMaps: {} }],
    };

    // FIX: If location is available, add it to the toolConfig for Google Maps grounding.
    if (location) {
        config.toolConfig = {
            retrievalConfig: {
                latLng: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                }
            }
        };
    }

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [...genAIHistory, { role: 'user', parts: [{ text: prompt }] }],
        // FIX: Use the dynamically constructed config object.
        config: config,
    });

    const text = response.text;
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    const sources: GroundingSource[] = [];
    if (groundingMetadata?.groundingChunks) {
        for (const chunk of groundingMetadata.groundingChunks) {
            if (chunk.web) {
                sources.push({
                    uri: chunk.web.uri,
                    title: chunk.web.title || chunk.web.uri,
                    type: 'search',
                });
            } else if (chunk.maps) {
                sources.push({
                    uri: chunk.maps.uri,
                    title: chunk.maps.title || chunk.maps.uri,
                    type: 'maps'
                });
                // FIX: Correctly iterate over the reviewSnippets array. placeAnswerSources is an object, not an array.
                chunk.maps.placeAnswerSources?.reviewSnippets?.forEach(snippet => {
                    // FIX: The `review` property can be a string, an object, or null. Check if it's a non-null object with a `uri` property before accessing it.
                    if (snippet.review && typeof snippet.review === 'object' && 'uri' in snippet.review) {
                        sources.push({
                            uri: (snippet.review as any).uri,
                            title: (snippet.review as any).text || 'Leer reseña',
                            type: 'review'
                        });
                    }
                });
            }
        }
    }

    return { text, sources };
}

export async function analyzeImage(
    imageData: string,
    prompt: string,
    modelName: 'gemini-2.5-flash' | 'gemini-2.5-pro'
): Promise<{ text: string }> {
    const imagePart = { inlineData: { mimeType: 'image/jpeg', data: imageData } };
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: [imagePart, textPart] },
        config: { safetySettings }
    });
    
    return { text: response.text };
}
