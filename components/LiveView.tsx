import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import type { TranscriptEntry, GroundingSource, PersonalitySettings, UserLocation } from '../types';
import { sendChatMessage, analyzeImage } from '../services/geminiService';
import ChatInput from './ChatInput';
import { IconLoader, IconWifi, IconWifiOff, IconThumbUp, IconThumbDown, IconLink, IconSparkles, IconSearch, IconMapPin, IconMessageCircle, IconMic, IconSliders } from './IconComponents';

const CHAT_HISTORY_KEY = 'maryJoseCaminoChatHistory';
const PERSONALITY_SETTINGS_KEY = 'maryJoseCaminoPersonalitySettings';

const StatusIndicator: React.FC<{ status: string; locationStatus: 'idle' | 'fetching' | 'success' | 'error'; }> = ({ status, locationStatus }) => {
    if (locationStatus === 'fetching') {
         return (
            <div className={`absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-gray-900/70 backdrop-blur-sm rounded-full text-sm font-medium text-blue-400`}>
                <IconMapPin className="animate-pulse h-4 w-4" />
                <span>Obteniendo ubicación...</span>
            </div>
        );
    }
    const statusMap: { [key: string]: { text: string; icon: React.ReactElement; color: string } } = {
        connecting: { text: "Conectando...", icon: <IconLoader className="animate-spin h-4 w-4" />, color: 'text-yellow-400' },
        connected: { text: "Conectada", icon: <IconWifi className="h-4 w-4" />, color: 'text-green-400' },
        disconnected: { text: "Desconectada", icon: <IconWifiOff className="h-4 w-4" />, color: 'text-gray-400' },
        error: { text: "Error de Conexión", icon: <IconWifiOff className="h-4 w-4" />, color: 'text-red-400' },
        idle: { text: "Inactiva", icon: <IconWifiOff className="h-4 w-4" />, color: 'text-gray-500' },
    };
    const currentStatus = statusMap[status] || statusMap.idle;
    const showLocationError = (status === 'connected' || status === 'connecting') && locationStatus === 'error';

    return (
        <div className={`absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-gray-900/70 backdrop-blur-sm rounded-full text-sm font-medium ${currentStatus.color}`}>
            {currentStatus.icon}
            <span>{currentStatus.text}</span>
            {showLocationError && (
                 <span className="text-yellow-400" title="No se pudo obtener la ubicación. Las funciones de mapa pueden estar limitadas.">(sin GPS)</span>
            )}
        </div>
    );
};

const TranscriptBubble: React.FC<{ entry: TranscriptEntry; onFeedback: (id: number, feedback: 'up' | 'down') => void; }> = ({ entry, onFeedback }) => {
    const isUser = entry.speaker === 'user';
    const finalOpacity = entry.isFinal ? 'opacity-100' : 'opacity-70';
    const hasFeedback = entry.feedback === 'up' || entry.feedback === 'down';

    const SourceIcon: React.FC<{ type: GroundingSource['type'] }> = ({ type }) => {
        switch (type) {
            case 'search':
                return <IconSearch className="h-3 w-3 flex-shrink-0" />;
            case 'maps':
                return <IconMapPin className="h-3 w-3 flex-shrink-0" />;
            case 'review':
                return <IconMessageCircle className="h-3 w-3 flex-shrink-0" />;
            default:
                // Fallback icon
                return <IconLink className="h-3 w-3 flex-shrink-0" />;
        }
    };

    return (
        <div className={`flex flex-col mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl ${finalOpacity} ${isUser ? 'bg-purple-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'}`}>
                <p>{entry.text}</p>
            </div>
            {!isUser && entry.isFinal && entry.sources && entry.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 pl-2">
                    {entry.sources.map((source, index) => (
                        <a
                            key={index}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 px-2 py-1 rounded-full transition-colors"
                        >
                            <SourceIcon type={source.type} />
                            <span className="truncate max-w-48">{source.title}</span>
                        </a>
                    ))}
                </div>
            )}
            {!isUser && entry.isFinal && (
                <div className="flex items-center gap-2 mt-1.5 pl-2">
                    <button
                        onClick={() => onFeedback(entry.id, 'up')}
                        disabled={hasFeedback}
                        className={`transition-colors duration-200 disabled:opacity-50 ${entry.feedback === 'up' ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}
                        aria-label="Good response"
                    >
                        <IconThumbUp className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => onFeedback(entry.id, 'down')}
                        disabled={hasFeedback}
                        className={`transition-colors duration-200 disabled:opacity-50 ${entry.feedback === 'down' ? 'text-red-400' : 'text-gray-400 hover:text-white'}`}
                        aria-label="Bad response"
                    >
                        <IconThumbDown className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
    );
};


const LiveView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const [chatHistory, setChatHistory] = useState<TranscriptEntry[]>(() => {
    try {
      const savedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory);
        if (Array.isArray(parsedHistory)) {
          return parsedHistory;
        }
      }
    } catch (error) {
      console.error("Failed to load chat history from localStorage:", error);
    }
    // Default initial message if nothing is saved or loading fails
    return [{
      id: Date.now(),
      speaker: 'mary',
      text: "¡Hola! ¡Qué alegría verte por aquí! ✨ Soy Mary Jose Camino, tu amiga virtual de la energía positiva. Cuéntame, ¿cómo ha estado tu día realmente ? ¿Alguna pequeña victoria o algo que te tenga con esa sonrisa?",
      isFinal: true,
    }];
  });
  
  const [personalitySettings, setPersonalitySettings] = useState<PersonalitySettings>(() => {
    try {
        const saved = localStorage.getItem(PERSONALITY_SETTINGS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Basic validation
            if (typeof parsed.empathy === 'number' && typeof parsed.humor === 'number' && typeof parsed.solidarity === 'number') {
                return parsed;
            }
        }
    } catch (error) {
        console.error("Failed to load personality settings:", error);
    }
    // Default settings
    return { empathy: 8, humor: 7, solidarity: 9 };
  });

  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMicMenuOpen, setIsMicMenuOpen] = useState(false);
  const [isPersonalityMenuOpen, setIsPersonalityMenuOpen] = useState(false);
  const [micSensitivity, setMicSensitivity] = useState(1.0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'fetching' | 'success' | 'error'>('idle');

  const { status, transcripts: liveTranscripts, connect, handleFeedback } = useLiveSession(micSensitivity, personalitySettings, userLocation);

  // Effect to save chat history to localStorage whenever it changes
  useEffect(() => {
    try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory));
    } catch (error) {
        console.error("Failed to save chat history to localStorage:", error);
    }
  }, [chatHistory]);

  // Effect to save personality settings to localStorage
  useEffect(() => {
    try {
        localStorage.setItem(PERSONALITY_SETTINGS_KEY, JSON.stringify(personalitySettings));
    } catch (error) {
        console.error("Failed to save personality settings:", error);
    }
  }, [personalitySettings]);

  useEffect(() => {
    // Este efecto se ejecuta una vez al montar el componente para obtener la ubicación del usuario.
    if (navigator.geolocation) {
      setLocationStatus('fetching');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setLocationStatus('success');
        },
        (error) => {
          console.error("Error obteniendo la geolocalización:", error);
          setLocationStatus('error');
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      console.warn("La geolocalización no es compatible con este navegador.");
      setLocationStatus('error');
    }
  }, []); // El array de dependencias vacío asegura que esto se ejecute solo una vez.


  const allTranscripts = useMemo(() => 
    [...liveTranscripts, ...chatHistory].sort((a, b) => a.id - b.id), 
    [liveTranscripts, chatHistory]
  );
  
  useEffect(() => {
    // Espera a que el intento de geolocalización termine (con éxito o error) antes de conectar.
    const isLocationReadyForConnect = locationStatus === 'success' || locationStatus === 'error';
    if (isLocationReadyForConnect && videoRef.current && canvasRef.current && status === 'idle') {
      connect(videoRef.current, canvasRef.current);
    }
  }, [status, connect, locationStatus]);
  
  useEffect(() => {
    if (transcriptContainerRef.current) {
        transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [allTranscripts]);

  const handleSendMessage = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isChatLoading) return;

    setIsChatLoading(true);

    const newUserMessage: TranscriptEntry = {
        speaker: 'user',
        text: prompt,
        isFinal: true,
        id: Date.now(),
    };
    setChatHistory(prev => [...prev, newUserMessage]);
    
    // Add a temporary thinking message
    const thinkingMessageId = Date.now() + 1;
    const thinkingMessage: TranscriptEntry = {
        speaker: 'mary',
        text: "Pensando...",
        isFinal: false,
        id: thinkingMessageId,
    };
    setChatHistory(prev => [...prev, thinkingMessage]);

    try {
        const historyForApi = [...liveTranscripts, ...chatHistory];
        const { text, sources } = await sendChatMessage(prompt, historyForApi, personalitySettings, userLocation);
        const newBotMessage: TranscriptEntry = {
            speaker: 'mary',
            text: text,
            isFinal: true,
            id: thinkingMessageId,
            sources: sources,
        };
        setChatHistory(prev => prev.map(m => m.id === thinkingMessageId ? newBotMessage : m));
    } catch (error) {
        console.error("Chat error:", error);
        const errorMessage: TranscriptEntry = {
            speaker: 'mary',
            text: "Lo siento, estoy teniendo problemas para conectarme ahora mismo.",
            isFinal: true,
            id: thinkingMessageId,
        };
        setChatHistory(prev => prev.map(m => m.id === thinkingMessageId ? errorMessage : m));
    } finally {
        setIsChatLoading(false);
    }
  }, [isChatLoading, liveTranscripts, chatHistory, personalitySettings, userLocation]);

  const handleImageAnalysis = useCallback(async (
      prompt: string,
      model: 'gemini-2.5-flash' | 'gemini-2.5-pro'
    ) => {
        if (isAnalyzing) return;
    
        setIsActionMenuOpen(false);
        setIsAnalyzing(true);

        const thinkingMessageId = Date.now();
        const thinkingMessage: TranscriptEntry = {
            speaker: 'mary',
            text: "Analizando la imagen...",
            isFinal: false,
            id: thinkingMessageId,
        };
        setChatHistory(prev => [...prev, thinkingMessage]);
    
        try {
            const canvas = canvasRef.current;
            const video = videoRef.current;
            const ctx = canvas?.getContext('2d');

            if (!video || !canvas || !ctx) {
                throw new Error("Video or canvas context not available.");
            }
            
            // Draw current video frame to canvas to ensure we get the latest image
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        
            const imageData = await new Promise<string | null>(resolve => {
                canvas.toBlob(blob => {
                    if (!blob) {
                        resolve(null);
                        return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = (reader.result as string)?.split(',')[1];
                        resolve(base64data);
                    };
                    reader.readAsDataURL(blob);
                }, 'image/jpeg', 0.8);
            });
    
            if (!imageData) throw new Error("Failed to capture image data.");
            
            const { text } = await analyzeImage(imageData, prompt, model);
    
            const newBotMessage: TranscriptEntry = {
                speaker: 'mary',
                text: text,
                isFinal: true,
                id: thinkingMessageId,
            };
            setChatHistory(prev => prev.map(m => m.id === thinkingMessageId ? newBotMessage : m));
    
        } catch (error) {
            console.error("Image analysis error:", error);
            const errorMessage: TranscriptEntry = {
                speaker: 'mary',
                text: "Lo siento, no pude analizar la imagen.",
                isFinal: true,
                id: thinkingMessageId,
            };
            setChatHistory(prev => prev.map(m => m.id === thinkingMessageId ? errorMessage : m));
        } finally {
            setIsAnalyzing(false);
        }
    }, [isAnalyzing]);
    
    const handlePersonalityChange = (trait: keyof PersonalitySettings, value: string) => {
        setPersonalitySettings(prev => ({
            ...prev,
            [trait]: parseFloat(value)
        }));
    };

  return (
    <div className="w-full h-full relative flex flex-col justify-end overflow-hidden">
        <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        
        <StatusIndicator status={status} locationStatus={locationStatus} />

        <div className="relative p-4 w-full max-w-3xl mx-auto flex flex-col">
            <div 
                ref={transcriptContainerRef}
                className="flex-grow max-h-[50vh] overflow-y-auto pr-2 mb-4"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 #1F2937' }}
            >
                {allTranscripts.map((entry) => (
                    <TranscriptBubble key={entry.id} entry={entry} onFeedback={handleFeedback} />
                ))}
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
                <div className="flex-grow">
                    <ChatInput onSendMessage={handleSendMessage} isLoading={isChatLoading || isAnalyzing} />
                </div>
                <div className="relative">
                     {isPersonalityMenuOpen && (
                         <div className="absolute bottom-full right-0 mb-2 w-64 bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-xl p-4 z-10 space-y-4">
                            <div>
                                <label htmlFor="empathy-slider" className="block text-sm font-medium text-white mb-2">Empatía</label>
                                <div className="flex items-center gap-2">
                                    <input id="empathy-slider" type="range" min="0" max="10" step="1" value={personalitySettings.empathy} onChange={(e) => handlePersonalityChange('empathy', e.target.value)} className="w-full personality-slider"/>
                                    <span className="text-xs text-gray-300 w-8 text-center">{personalitySettings.empathy}</span>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="humor-slider" className="block text-sm font-medium text-white mb-2">Humor</label>
                                <div className="flex items-center gap-2">
                                    <input id="humor-slider" type="range" min="0" max="10" step="1" value={personalitySettings.humor} onChange={(e) => handlePersonalityChange('humor', e.target.value)} className="w-full personality-slider"/>
                                    <span className="text-xs text-gray-300 w-8 text-center">{personalitySettings.humor}</span>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="solidarity-slider" className="block text-sm font-medium text-white mb-2">Solidaridad</label>
                                <div className="flex items-center gap-2">
                                    <input id="solidarity-slider" type="range" min="0" max="10" step="1" value={personalitySettings.solidarity} onChange={(e) => handlePersonalityChange('solidarity', e.target.value)} className="w-full personality-slider"/>
                                    <span className="text-xs text-gray-300 w-8 text-center">{personalitySettings.solidarity}</span>
                                </div>
                            </div>
                         </div>
                    )}
                    <button
                        onClick={() => {
                            setIsPersonalityMenuOpen(prev => !prev);
                            setIsMicMenuOpen(false);
                            setIsActionMenuOpen(false);
                        }}
                        className="flex-shrink-0 flex items-center justify-center w-14 h-14 bg-gray-600 rounded-full shadow-lg hover:bg-gray-700 transition-colors focus:outline-none focus:ring-4 focus:ring-gray-400 focus:ring-opacity-50"
                        aria-label="Personality Settings"
                    >
                         <IconSliders className="h-7 w-7 text-white" />
                    </button>
                </div>
                <div className="relative">
                    {isMicMenuOpen && (
                         <div className="absolute bottom-full right-0 mb-2 w-56 bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-xl p-4 z-10">
                            <label htmlFor="mic-sensitivity" className="block text-sm font-medium text-white mb-2">
                                Sensibilidad del Micrófono
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    id="mic-sensitivity"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={micSensitivity}
                                    onChange={(e) => setMicSensitivity(parseFloat(e.target.value))}
                                    className="w-full mic-slider"
                                />
                                <span className="text-xs text-gray-300 w-8 text-center">{micSensitivity.toFixed(1)}</span>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={() => {
                            setIsMicMenuOpen(prev => !prev);
                            setIsActionMenuOpen(false);
                            setIsPersonalityMenuOpen(false);
                        }}
                        className="flex-shrink-0 flex items-center justify-center w-14 h-14 bg-gray-600 rounded-full shadow-lg hover:bg-gray-700 transition-colors focus:outline-none focus:ring-4 focus:ring-gray-400 focus:ring-opacity-50"
                        aria-label="Microphone Settings"
                    >
                         <IconMic className="h-7 w-7 text-white" />
                    </button>
                </div>
                <div className="relative">
                    {isActionMenuOpen && (
                        <div className="absolute bottom-full right-0 mb-2 w-56 bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-xl p-2 z-10">
                            <button 
                                onClick={() => handleImageAnalysis("Describe lo que ves en esta escena en detalle.", "gemini-2.5-flash")}
                                disabled={isAnalyzing}
                                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-purple-600 rounded-md transition-colors disabled:opacity-50"
                            >
                                Describe la escena
                            </button>
                             <button 
                                onClick={() => handleImageAnalysis("Mira esta imagen y dame una idea creativa, interesante o divertida relacionada con ella.", "gemini-2.5-pro")}
                                disabled={isAnalyzing}
                                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-purple-600 rounded-md transition-colors disabled:opacity-50"
                            >
                                Dame una idea creativa
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => {
                            setIsActionMenuOpen(prev => !prev);
                            setIsMicMenuOpen(false);
                            setIsPersonalityMenuOpen(false);
                        }}
                        disabled={isAnalyzing}
                        className="flex-shrink-0 flex items-center justify-center w-14 h-14 bg-purple-600 rounded-full shadow-lg hover:bg-purple-700 transition-colors focus:outline-none focus:ring-4 focus:ring-purple-400 focus:ring-opacity-50 disabled:bg-gray-500 disabled:cursor-not-allowed"
                        aria-label="AI Actions"
                    >
                         {isAnalyzing ? <IconLoader className="h-7 w-7 text-white animate-spin" /> : <IconSparkles className="h-7 w-7 text-white" />}
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};

export default LiveView;