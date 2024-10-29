/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown, Pause, MessageCircle, Minimize2, Settings } from 'react-feather';
import { Button } from '../components/button/Button';

import './ConsolePage.scss';

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

// Додаємо новий інтерфейс для візуалізатора
interface AudioVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  analyser: AnalyserNode;
  dataArray: Uint8Array;
  animationId: number;
}

// Додаємо новий інтерфейс для аудіо даних
interface AudioLevel {
  level: number;
  id: number;
}

export function ConsolePage() {
  /**
   * Add this near the top with other state declarations
   */
  const [isChatOpen, setIsChatOpen] = useState(false);

  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});

  // Змінюємо початковий стан для canPushToTalk на false (тобто VAD режим)
  const [canPushToTalk, setCanPushToTalk] = useState(false);

  // Додамо нові стани
  const [fontSize, setFontSize] = useState('normal'); // 'small' | 'normal' | 'large'
  const [showSettings, setShowSettings] = useState(false);

  // Додаємо новий стан на початку компонента
  const [isReady, setIsReady] = useState(false);

  // Додаємо новий стан для візуалізатора
  const [visualizer, setVisualizer] = useState<AudioVisualizer | null>(null);

  // Додаємо новий стан для анімації
  const [isRecordingActive, setIsRecordingActive] = useState(false);

  // Додаємо нові стани
  const [audioLevels, setAudioLevels] = useState<AudioLevel[]>([
    { level: 20, id: 1 },
    { level: 20, id: 2 },
    { level: 20, id: 3 },
    { level: 20, id: 4 },
    { level: 20, id: 5 },
  ]);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>();

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  // Оновлюємо функцію changeTurnEndType
  const changeTurnEndType = async (value: string) => {
    try {
      const client = clientRef.current;
      const wavRecorder = wavRecorderRef.current;
      
      if (!client || !wavRecorder) return;
      
      // Спочатку зупиняємо поточний запис, якщо він активний
      if (wavRecorder.getStatus() === 'recording') {
        await wavRecorder.pause();
        setIsRecording(false);
      }
      
      // Оновлюємо налашування сесії
      if (client.isConnected()) {
        await client.updateSession({
          turn_detection: value === 'none' ? null : { type: 'server_vad' },
        });
        
        // Якщо вибрано VAD режим, починаємо новий запис
        if (value === 'server_vad') {
          // Невелика затримка для впевненості, що попередній запис зупинено
          await new Promise(resolve => setTimeout(resolve, 100));
          
          await wavRecorder.record((data) => {
            if (client.isConnected()) {
              client.appendInputAudio(data.mono);
            }
          });
        }
      }
      
      setCanPushToTalk(value === 'none');
    } catch (error) {
      console.error('Error changing turn end type:', error);
    }
  };

  // Додаємо функцію для створення візуалізатора
  const createVisualizer = useCallback((stream: MediaStream) => {
    const canvas = clientCanvasRef.current;
    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get canvas context');
      return;
    }
    
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 256;
    source.connect(analyser);
    
    // Встановлюємо розміри канвасу
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    canvas.style.width = `${canvas.offsetWidth}px`;
    canvas.style.height = `${canvas.offsetHeight}px`;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const newVisualizer: AudioVisualizer = {
      canvas,
      ctx,
      analyser,
      dataArray,
      animationId: 0
    };
    
    setVisualizer(newVisualizer);
    
    // Починаємо анімацію
    function animate() {
      const animationId = requestAnimationFrame(animate);
      newVisualizer.animationId = animationId;
      
      if (!canvas || !ctx) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      // Очищаємо канвас
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Малюємо фон
      ctx.fillStyle = 'rgba(17, 24, 39, 0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / dataArray.length) * 2.5;
      let barHeight;
      let x = 0;
      
      for(let i = 0; i < dataArray.length; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.7;
        
        // Градієнт для кожної смуги
        const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
        gradient.addColorStop(0, '#818cf8');
        gradient.addColorStop(1, '#4f46e5');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    }
    
    animate();
  }, []);

  // Оновлюємо функцію updateAudioLevels
  const updateAudioLevels = useCallback(() => {
    const wavRecorder = wavRecorderRef.current;
    
    if (wavRecorder && wavRecorder.recording) {
      const frequencies = wavRecorder.getFrequencies('voice');
      if (frequencies && frequencies.values) {
        // Збільшуємо амплітуду коливань
        const amplifiedValues = Array.from(frequencies.values).map(val => val * 2.5);
        const average = amplifiedValues.reduce((acc, val) => acc + val, 0) 
          / amplifiedValues.length;
        
        // Додаємо більше випадковості та динаміки
        setAudioLevels(prev => 
          prev.map((level, index) => {
            const randomFactor = Math.random() * 20 - 10; // Випадкове значення від -10 до 10
            const baseLevel = Math.min(100, Math.max(20, (average * 150) + (index * 10))); // Збільшили множник до 150
            const newLevel = baseLevel + randomFactor;
            
            return {
              id: level.id,
              level: Math.min(100, Math.max(20, newLevel)) // Обмежуємо значення між 20 та 100
            };
          })
        );
      }
    } else {
      // Коли запис не йде, встановлюємо мінімальні значення з невеликими коливаннями
      setAudioLevels(prev => 
        prev.map(level => ({
          id: level.id,
          level: 20 + Math.random() * 5
        }))
      );
    }

    animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecordingActive(true);
      
      // Запускаємо анімацію одразу після встановлення isRecordingActive
      animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
      
      console.log('Starting connection...');
      try {
        const client = clientRef.current;
        const wavRecorder = wavRecorderRef.current;
        const wavStreamPlayer = wavStreamPlayerRef.current;

        if (!client || !wavRecorder || !wavStreamPlayer) {
          console.error('Required components are not initialized');
          return;
        }

        console.log('Components checked, proceeding with connection...');
        startTimeRef.current = new Date().toISOString();
        setIsConnected(true);
        setRealtimeEvents([]);
        setItems(client.conversation.getItems());

        await wavRecorder.begin();
        await wavStreamPlayer.connect();
        await client.connect();

        if (client.isConnected()) {
          console.log('Successfully connected!');
          await client.updateSession({
            turn_detection: { type: 'server_vad' },
          });
          
          client.sendUserMessageContent([
            {
              type: 'input_text',
              text: 'Привіт!',
            },
          ]);

          await wavRecorder.record((data) => {
            if (client.isConnected()) {
              client.appendInputAudio(data.mono);
            }
          });
        }
      } catch (error) {
        console.error('Error connecting conversation:', error);
        setIsConnected(false);
        setIsRecordingActive(false);
      }
    } catch (error) {
      console.error('Error connecting:', error);
      setIsConnected(false);
      setIsRecordingActive(false);
    }
  }, [updateAudioLevels]);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    if (audioContext) {
      await audioContext.close();
    }
    
    setAudioContext(null);
    setAnalyser(null);
    setIsRecordingActive(false);
    setIsConnected(false);
    
    // Скидаємо рівні до початкових значень
    setAudioLevels(prev => prev.map(level => ({ ...level, level: 20 })));
    
    setIsRecording(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, [audioContext]);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth * window.devicePixelRatio;
            clientCanvas.height = clientCanvas.offsetHeight * window.devicePixelRatio;
            clientCanvas.style.width = `${clientCanvas.offsetWidth}px`;
            clientCanvas.style.height = `${clientCanvas.offsetHeight}px`;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#4F46E5',
              20,
              2,
              16
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      // Додаємо повну перевірку всіх необхідних властивостей
      if (!realtimeEvent || !realtimeEvent.event) {
        console.warn('Received invalid realtime event:', realtimeEvent);
        return;
      }

      setRealtimeEvents((prevEvents) => {
        const lastEvent = prevEvents[prevEvents.length - 1];
        
        // Перевіряємо наявність всіх необхідних властивостей
        if (lastEvent?.event?.type && 
            realtimeEvent?.event?.type && 
            lastEvent.event.type === realtimeEvent.event.type) {
          
          const updatedLastEvent = {
            ...lastEvent,
            count: (lastEvent.count || 1) + 1
          };
          
          return [...prevEvents.slice(0, -1), updatedLastEvent];
        }
        
        return [...prevEvents, {
          ...realtimeEvent,
          count: 1
        }];
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    // В кінці ініціалізації встановлюємо готовність
    setIsReady(true);

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  useEffect(() => {
    const audioElements = document.querySelectorAll('audio');
    
    audioElements.forEach(audio => {
      let animationFrameId: number;
      
      const updateProgress = () => {
        const progress = audio.parentElement?.querySelector('.audio-progress-bar') as HTMLElement;
        const timeDisplay = audio.parentElement?.querySelector('.audio-time') as HTMLElement;
        
        if (progress && timeDisplay) {
          const percentage = (audio.currentTime / audio.duration) * 100;
          progress.style.width = `${percentage}%`;
          
          const minutes = Math.floor(audio.currentTime / 60);
          const seconds = Math.floor(audio.currentTime % 60);
          timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          if (!audio.paused) {
            animationFrameId = requestAnimationFrame(updateProgress);
          }
        }
      };

      audio.addEventListener('play', () => {
        animationFrameId = requestAnimationFrame(updateProgress);
      });

      audio.addEventListener('pause', () => {
        cancelAnimationFrame(animationFrameId);
      });
      
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(animationFrameId);
        const playButton = audio.parentElement?.querySelector('button');
        if (playButton) {
          playButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          `;
        }
      });

      // Cleanup
      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    });
  }, [items]);

  // Додаємо функції для ручного режиму
  const startRecording = async () => {
    const wavRecorder = wavRecorderRef.current;
    const client = clientRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    
    // Перевряємо чи не йде вже запис
    if (wavRecorder.getStatus() !== 'recording') {
      setIsRecording(true);
      
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
      
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    
    // Перевіряємо чи йде запис перед викликом pause()
    if (wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    
    client.createResponse();
  };

  // Додаємо новий useEffect для автопідключення
  useEffect(() => {
    const autoConnect = async () => {
      // Перевіряємо готовність компонента та наявність API ключа
      if (isReady && !isConnected && (apiKey !== '' || LOCAL_RELAY_SERVER_URL)) {
        console.log('Attempting auto-connection...'); // Для дебагу
        try {
          await connectConversation();
        } catch (error) {
          console.error('Auto-connection failed:', error);
        }
      }
    };

    autoConnect();
  }, [isReady, isConnected, apiKey, LOCAL_RELAY_SERVER_URL, connectConversation]);

  // Додаємо функцію для отримання розміру тексту
  const getFontSize = (size: string) => {
    switch (size) {
      case 'small': return 'text-xl';
      case 'large': return 'text-3xl';
      default: return 'text-2xl';
    }
  };

  // Додаємо новий useEffect для автоскролу
  useEffect(() => {
    const messagesContainer = document.querySelector('.overflow-y-auto');
    if (messagesContainer) {
      // Додаємо невелику затримку, щоб дочекатися завершення анімації
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }, [items]);

  /**
   * Render the application
   */
  return (
    <div className="h-screen bg-gradient-to-b from-slate-950 to-gray-900 text-gray-100">
      {/* Кнопка налаштувань */}
      <button 
        onClick={() => setShowSettings(!showSettings)}
        className="fixed top-4 right-4 w-12 h-12 flex items-center justify-center rounded-full bg-gray-800/50 backdrop-blur-sm hover:bg-gray-700/50 transition-all z-50"
      >
        <Settings size={24} className="text-gray-300" />
      </button>

      {/* Панель нааштувань */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40">
          <div className="bg-gradient-to-b from-gray-800 to-gray-900 p-6 rounded-3xl shadow-2xl max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-6">Налаштування</h2>
            
            <div className="space-y-6">
              <div>
                <label className="text-lg font-medium mb-3 block">Розмір тексту</label>
                <div className="flex gap-3">
                  {['small', 'normal', 'large'].map((size) => (
                    <button
                      key={size}
                      onClick={() => setFontSize(size)}
                      className={`flex-1 py-3 px-4 rounded-xl transition-all ${
                        fontSize === size 
                          ? 'bg-indigo-600 text-white' 
                          : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {size === 'small' ? 'A' : size === 'normal' ? 'AA' : 'AAA'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="mt-8 w-full py-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl transition-all"
            >
              Закрити
            </button>
          </div>
        </div>
      )}

      <main className="h-full flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 relative">
          <div className="space-y-6 min-h-full flex flex-col justify-end">
            {items
              .filter(item => {
                // Перевіряємо наявність контенту перед відображенням
                return (
                  item.formatted.transcript || 
                  item.formatted.text || 
                  (item.formatted.file && item.formatted.file.url)
                );
              })
              .map((item, index) => (
                <div 
                  key={item.id}
                  className={`flex ${item.role === 'assistant' ? 'justify-start' : 'justify-end'} animate-fade-slide-up`}
                  style={{
                    animationDelay: `${index * 0.1}s`,
                    opacity: 0,
                    animation: 'fade-slide-up 0.5s ease forwards'
                  }}
                >
                  <div className={`max-w-[90%] rounded-3xl p-6 shadow-2xl backdrop-blur-sm transform transition-all duration-300 hover:scale-[1.02] ${
                    item.role === 'assistant' 
                      ? 'bg-gradient-to-br from-gray-800/90 to-gray-900/90 border border-gray-700/30' 
                      : 'bg-gradient-to-br from-indigo-600/90 to-indigo-800/90 border border-indigo-500/30'
                  }`}>
                    <div className={`${getFontSize(fontSize)} font-medium leading-relaxed`}>
                      {item.formatted.transcript || item.formatted.text || '...'}
                    </div>
                    
                    {item.formatted.file && (
                      <div className="mt-4 transform transition-all duration-300">
                        <audio
                          src={item.formatted.file.url}
                          preload="metadata"
                          className="hidden"
                        />
                        <div className="flex items-center gap-4 bg-black/20 rounded-2xl p-4 backdrop-blur-sm">
                          <button 
                            onClick={(e) => {
                              const audio = e.currentTarget.parentElement?.previousElementSibling as HTMLAudioElement;
                              if (audio.paused) {
                                audio.play();
                                e.currentTarget.innerHTML = `
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                  </svg>
                                `;
                              } else {
                                audio.pause();
                                e.currentTarget.innerHTML = `
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                  </svg>
                                `;
                              }
                            }}
                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-indigo-600/80 hover:bg-indigo-600 transition-all"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                          </button>
                          
                          <div className="flex-1 h-2 bg-black/20 rounded-full overflow-hidden">
                            <div className="audio-progress-bar h-full bg-indigo-500 rounded-full w-0" />
                          </div>
                          
                          <span className="audio-time text-lg font-medium">0:00</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-gradient-to-t from-gray-900 to-gray-800/50 p-6 border-t border-gray-800/50 backdrop-blur-sm">
          <div className="flex flex-col gap-4">
            <div className="flex justify-center gap-4 mb-2">
              <button
                onClick={() => changeTurnEndType('none')}
                className={`px-6 py-4 rounded-2xl text-lg font-medium transition-all ${
                  canPushToTalk 
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/20' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
                }`}
              >
                Ручний режим
              </button>
              <button
                onClick={() => changeTurnEndType('server_vad')}
                className={`px-6 py-4 rounded-2xl text-lg font-medium transition-all ${
                  !canPushToTalk 
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/20' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
                }`}
              >
                Авто режим
              </button>
            </div>

            {isConnected ? (
              <>
                {canPushToTalk ? (
                  <button
                    className={`h-24 rounded-2xl text-xl font-medium transition-all shadow-lg select-none touch-none ${
                      isRecording 
                        ? 'bg-gradient-to-r from-red-500 to-red-600 shadow-red-500/20' 
                        : 'bg-gradient-to-r from-indigo-600 to-indigo-700 shadow-indigo-500/20'
                    }`}
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    onTouchCancel={stopRecording}
                  >
                    {isRecording ? 'Відпустіть для надсилання' : 'Натисніть для розмови'}
                  </button>
                ) : (
                  <div className="relative h-24 rounded-2xl bg-gradient-to-r from-gray-800/90 to-gray-900/90 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center gap-4">
                      {/* Індикатор запису */}
                      <div className={`w-3 h-3 rounded-full bg-red-500 ${isRecordingActive ? 'animate-pulse' : ''}`} />
                      
                      <div className="flex items-center gap-3">
                        {/* Анімовані смуги, що реагують на звук */}
                        <div className="flex items-end gap-1 h-12">
                          {audioLevels.map(({ level, id }) => (
                            <div
                              key={id}
                              className="w-1.5 bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-full transition-all duration-75" // Зменшили duration
                              style={{
                                height: `${level}%`,
                                transform: `scaleY(${level / 50})`, // Додаємо масштабування для більшої виразності
                              }}
                            />
                          ))}
                        </div>
                        
                        <p className="text-xl text-gray-300 font-medium px-4 py-2 rounded-full bg-gray-900/50 backdrop-blur-sm">
                          Говоріть...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={connectConversation}
                className="h-24 bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-2xl text-xl font-medium transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-500/20"
              >
                <Zap size={24} />
                <span>Підключитися</span>
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
