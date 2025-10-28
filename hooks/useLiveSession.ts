// FIX: Create file to implement the useLiveSession hook and resolve module not found error.
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GoogleGenAI,
  // FIX: Removed 'LiveSession' as it is not an exported member of '@google/genai'.
  LiveServerMessage,
  Modality,
  HarmCategory,
  HarmBlockThreshold,
  Blob,
} from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audio';
import { generateSystemInstruction } from '../services/geminiService';
import type { TranscriptEntry, GroundingSource, PersonalitySettings, UserLocation } from '../types';

// Constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const FRAME_RATE = 1; // 1 frame per second
const JPEG_QUALITY = 0.8;

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

function createPcmBlob(data: Float32Array, sampleRate: number): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
}

// Custom hook
export function useLiveSession(micSensitivity: number, personalitySettings: PersonalitySettings, location: UserLocation | null) {
  const [status, setStatus] = useState('idle');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  // FIX: Changed type from 'LiveSession' to 'any' as 'LiveSession' is not an exported member.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextAudioStartTimeRef = useRef(0);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const currentUserTranscriptIdRef = useRef<number | null>(null);
  const currentMaryTranscriptIdRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    compressorRef.current?.disconnect();
    compressorRef.current = null;

    inputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current?.close().catch(console.error);
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    
    for (const source of audioSourcesRef.current.values()) {
      source.stop();
    }
    audioSourcesRef.current.clear();
    nextAudioStartTimeRef.current = 0;

    sessionPromiseRef.current?.then(session => session.close()).catch(console.error);
    sessionPromiseRef.current = null;
  }, []);

  const handleServerMessage = useCallback(async (message: LiveServerMessage) => {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && outputAudioContextRef.current) {
        const outputAudioContext = outputAudioContextRef.current;
        nextAudioStartTimeRef.current = Math.max(nextAudioStartTimeRef.current, outputAudioContext.currentTime);
        const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, OUTPUT_SAMPLE_RATE, 1);
        const source = outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        if (compressorRef.current) {
            source.connect(compressorRef.current);
        } else {
            source.connect(outputAudioContext.destination);
        }

        source.addEventListener('ended', () => {
            audioSourcesRef.current.delete(source);
        });
        source.start(nextAudioStartTimeRef.current);
        nextAudioStartTimeRef.current += audioBuffer.duration;
        audioSourcesRef.current.add(source);
    }
    
    if (message.serverContent?.interrupted) {
        for (const source of audioSourcesRef.current.values()) {
            source.stop();
        }
        audioSourcesRef.current.clear();
        nextAudioStartTimeRef.current = 0;
    }

    if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      currentInputTranscriptionRef.current += text;
      if (!currentUserTranscriptIdRef.current) {
          currentUserTranscriptIdRef.current = Date.now();
          setTranscripts(prev => [...prev, {
              id: currentUserTranscriptIdRef.current!, speaker: 'user', text: currentInputTranscriptionRef.current, isFinal: false,
          }]);
      } else {
          setTranscripts(prev => prev.map(t =>
              t.id === currentUserTranscriptIdRef.current ? { ...t, text: currentInputTranscriptionRef.current } : t
          ));
      }
    }

    if (message.serverContent?.outputTranscription) {
        const text = message.serverContent.outputTranscription.text;
        currentOutputTranscriptionRef.current += text;
        if (!currentMaryTranscriptIdRef.current) {
            currentMaryTranscriptIdRef.current = Date.now();
            setTranscripts(prev => [...prev, {
                id: currentMaryTranscriptIdRef.current!, speaker: 'mary', text: currentOutputTranscriptionRef.current, isFinal: false,
            }]);
        } else {
            setTranscripts(prev => prev.map(t =>
                t.id === currentMaryTranscriptIdRef.current ? { ...t, text: currentOutputTranscriptionRef.current } : t
            ));
        }
    }
    
    if (message.serverContent?.turnComplete) {
        const groundingMetadata = message.serverContent.groundingMetadata;
        const sources: GroundingSource[] = [];
        if (groundingMetadata?.groundingChunks) {
            for (const chunk of groundingMetadata.groundingChunks) {
                if (chunk.web) {
                    sources.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri, type: 'search' });
                } else if (chunk.maps) {
                    sources.push({ uri: chunk.maps.uri, title: chunk.maps.title || chunk.maps.uri, type: 'maps' });
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
    
        if (currentUserTranscriptIdRef.current) {
            setTranscripts(prev => prev.map(t => t.id === currentUserTranscriptIdRef.current ? { ...t, text: currentInputTranscriptionRef.current, isFinal: true } : t ));
        }

        if (currentMaryTranscriptIdRef.current) {
            setTranscripts(prev => prev.map(t => t.id === currentMaryTranscriptIdRef.current ? { ...t, text: currentOutputTranscriptionRef.current, isFinal: true, sources: sources.length > 0 ? sources : undefined } : t ));
        }

        currentInputTranscriptionRef.current = '';
        currentOutputTranscriptionRef.current = '';
        currentUserTranscriptIdRef.current = null;
        currentMaryTranscriptIdRef.current = null;
    }
  }, []);

  const connect = useCallback(async (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) => {
    if (status !== 'idle' || sessionPromiseRef.current) return;

    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      videoEl.srcObject = stream;
      await videoEl.play();

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

      // Create and configure the compressor for AI output enhancement
      const compressor = outputAudioContextRef.current.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, outputAudioContextRef.current.currentTime);
      compressor.knee.setValueAtTime(40, outputAudioContextRef.current.currentTime);
      compressor.ratio.setValueAtTime(12, outputAudioContextRef.current.currentTime);
      compressor.attack.setValueAtTime(0, outputAudioContextRef.current.currentTime);
      compressor.release.setValueAtTime(0.25, outputAudioContextRef.current.currentTime);
      compressor.connect(outputAudioContextRef.current.destination);
      compressorRef.current = compressor;
      
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API_KEY not found");
      const ai = new GoogleGenAI({ apiKey });

      const systemInstruction = generateSystemInstruction(personalitySettings);
      
      // FIX: Dynamically build the configuration to include location data if available.
      const liveConnectConfig: any = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {}, googleMaps: {} }],
      };

      // FIX: Add location to toolConfig for grounded responses in the live session.
      if (location) {
        liveConnectConfig.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: location.latitude,
              longitude: location.longitude,
            }
          }
        };
      }

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        // FIX: Use the dynamically constructed config.
        config: liveConnectConfig,
        callbacks: {
          onopen: () => {
            setStatus('connected');
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const gainNode = inputAudioContextRef.current!.createGain();
            micGainNodeRef.current = gainNode;
            
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData, INPUT_SAMPLE_RATE);
              sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
            };
            
            source.connect(gainNode);
            gainNode.connect(scriptProcessor);
            // FIX: The scriptProcessor must be connected to the destination for the `onaudioprocess`
            // event to fire. The `echoCancellation` constraint in getUserMedia should prevent feedback.
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
            scriptProcessorRef.current = scriptProcessor;

            const ctx = canvasEl.getContext('2d');
            if (ctx) {
                frameIntervalRef.current = window.setInterval(() => {
                    canvasEl.width = videoEl.videoWidth;
                    canvasEl.height = videoEl.videoHeight;
                    ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
                    canvasEl.toBlob( (blob) => {
                      if (!blob) return;
                      const reader = new FileReader();
                      reader.onloadend = () => {
                          const base64Data = (reader.result as string)?.split(',')[1];
                          if(base64Data) {
                            sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } }));
                          }
                      };
                      reader.readAsDataURL(blob);
                    }, 'image/jpeg', JPEG_QUALITY );
                }, 1000 / FRAME_RATE);
            }
          },
          onmessage: handleServerMessage,
          onerror: (e: ErrorEvent) => {
            console.error('Session error:', e);
            setStatus('error');
            cleanup();
          },
          onclose: () => {
            setStatus('disconnected');
            cleanup();
          },
        },
      });

    } catch (error) {
        console.error('Failed to connect:', error);
        setStatus('error');
        cleanup();
    }
  }, [status, cleanup, handleServerMessage, personalitySettings, location]); // FIX: Add location to the dependency array.
  
  useEffect(() => {
    if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.value = micSensitivity;
    }
  }, [micSensitivity]);
  
  useEffect(() => () => cleanup(), [cleanup]);

  const handleFeedback = useCallback((id: number, feedback: 'up' | 'down') => {
    setTranscripts(prev =>
      prev.map(entry =>
        entry.id === id ? { ...entry, feedback } : entry
      )
    );
  }, []);

  return { status, transcripts, connect, handleFeedback };
}
