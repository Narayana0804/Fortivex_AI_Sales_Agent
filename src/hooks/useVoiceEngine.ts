import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { LANGUAGE_OPTIONS } from '../lib/salesEngine';
import type { SupportedLanguageCode, VoicePersona } from '../types';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function useVoiceEngine(options: {
  language: SupportedLanguageCode;
  voicePersona: VoicePersona;
  ttsEnabled: boolean;
  handsFreeEnabled: boolean;
  isCallActive: boolean;
  isProcessingTurn: boolean;
  onFinalTranscript: (transcript: string) => void;
}) {
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [isListening, setIsListening] = useState(false); // Browser Web Speech API
  const [isRecordingAudio, setIsRecordingAudio] = useState(false); // Active mic capture (VAD or manual)
  const [speechDetected, setSpeechDetected] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => Array(16).fill(10));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const lastVoiceAtRef = useRef<number>(0);
  const speechDetectedRef = useRef<boolean>(false);
  const cancelRecordingRef = useRef<boolean>(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackTokenRef = useRef<number>(0);
  const speakAnimTimerRef = useRef<number | null>(null);

  const onFinalTranscriptRef = useRef(options.onFinalTranscript);
  const languageRef = useRef(options.language);
  const isCallActiveRef = useRef(options.isCallActive);
  const handsFreeRef = useRef(options.handsFreeEnabled);
  const isProcessingRef = useRef(options.isProcessingTurn);

  useEffect(() => {
    onFinalTranscriptRef.current = options.onFinalTranscript;
  }, [options.onFinalTranscript]);

  useEffect(() => {
    languageRef.current = options.language;
  }, [options.language]);

  useEffect(() => {
    isCallActiveRef.current = options.isCallActive;
  }, [options.isCallActive]);

  useEffect(() => {
    handsFreeRef.current = options.handsFreeEnabled;
  }, [options.handsFreeEnabled]);

  useEffect(() => {
    isProcessingRef.current = options.isProcessingTurn;
  }, [options.isProcessingTurn]);

  const clearVadTimer = useCallback(() => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }, []);

  // Speaking animation when AI TTS is playing (real mic analyser drives bars when recording)
  useEffect(() => {
    if (!isSpeaking) {
      if (speakAnimTimerRef.current !== null) {
        window.clearInterval(speakAnimTimerRef.current);
        speakAnimTimerRef.current = null;
      }
      if (!isRecordingAudio && !isListening) {
        setAudioLevels(Array(16).fill(10));
      }
      return;
    }

    speakAnimTimerRef.current = window.setInterval(() => {
      setAudioLevels((prev) =>
        prev.map((_, idx) => {
          const centerWeight = 1 - Math.abs(idx - 7.5) / 9;
          return Math.min(94, Math.max(14, Math.round(28 + Math.random() * 60 * centerWeight)));
        })
      );
    }, 100);

    return () => {
      if (speakAnimTimerRef.current !== null) {
        window.clearInterval(speakAnimTimerRef.current);
        speakAnimTimerRef.current = null;
      }
    };
  }, [isSpeaking, isRecordingAudio, isListening]);

  // Acquire and retain a live microphone stream + Web Audio AnalyserNode
  const ensureMicrophoneStream = useCallback(async (): Promise<MediaStream | null> => {
    if (mediaStreamRef.current) {
      const hasLiveTrack = mediaStreamRef.current
        .getAudioTracks()
        .some((t) => t.readyState === 'live');
      if (hasLiveTrack) {
        return mediaStreamRef.current;
      }
      mediaStreamRef.current = null;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermission('denied');
      setVoiceError(
        'Microphone capture is unavailable in this browser. Type your message below or use a test scenario.'
      );
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      setMicPermission('granted');

      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtxCtor();
        }
        if (audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume().catch(() => {});
        }
        const source = audioCtxRef.current.createMediaStreamSource(stream);
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        source.connect(analyser);
        analyserRef.current = analyser;
      }

      return stream;
    } catch {
      setMicPermission('denied');
      setVoiceError(
        'Microphone permission was blocked. Allow microphone access in your browser address bar, or type below.'
      );
      return null;
    }
  }, []);

  const releaseMicrophone = useCallback(() => {
    clearVadTimer();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      mediaStreamRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, [clearVadTimer]);

  const stopPlayback = useCallback(() => {
    playbackTokenRef.current += 1;
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.src = '';
      } catch {
        // ignore
      }
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
  }, []);

  // Start capturing microphone audio with real-time amplitude bars + optional hands-free VAD auto-send
  const startMicCapture = useCallback(
    async (autoSendOnSilence: boolean) => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        return;
      }

      setVoiceError(null);
      const stream = await ensureMicrophoneStream();
      if (!stream) return;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        setVoiceError('Audio recording format is not supported in this browser.');
        return;
      }

      const effectiveMime = (mimeType || recorder.mimeType || 'audio/webm').split(';')[0];
      audioChunksRef.current = [];
      cancelRecordingRef.current = false;
      speechDetectedRef.current = false;
      setSpeechDetected(false);
      recordingStartedAtRef.current = Date.now();
      lastVoiceAtRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        clearVadTimer();
        setIsRecordingAudio(false);
        setSpeechDetected(false);
        setAudioLevels(Array(16).fill(10));

        if (mediaRecorderRef.current === recorder) {
          mediaRecorderRef.current = null;
        }

        const elapsedMs = Date.now() - recordingStartedAtRef.current;
        const hadSpeech = speechDetectedRef.current;
        const blob = new Blob(audioChunksRef.current, { type: effectiveMime });
        audioChunksRef.current = [];

        if (cancelRecordingRef.current) {
          return;
        }

        if (elapsedMs < 350 || blob.size < 600) {
          if (!autoSendOnSilence) {
            setVoiceError(
              'Recording was too short. Speak for at least 1 second before clicking Stop & Send.'
            );
          }
          return;
        }

        // In hands-free mode, skip sending pure silence
        if (autoSendOnSilence && !hadSpeech) {
          return;
        }

        setIsTranscribing(true);
        try {
          const base64Audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = typeof reader.result === 'string' ? reader.result : '';
              resolve(result.split(',')[1] ?? '');
            };
            reader.onerror = () => reject(new Error('Failed to encode audio recording.'));
            reader.readAsDataURL(blob);
          });

          if (!base64Audio || cancelRecordingRef.current) {
            return;
          }

          const { transcript } = await api.transcribeAudio({
            base64Audio,
            mimeType: effectiveMime,
            language: languageRef.current,
          });

          if (cancelRecordingRef.current) return;

          if (transcript && transcript.trim()) {
            onFinalTranscriptRef.current(transcript.trim());
          } else {
            if (isCallActiveRef.current && handsFreeRef.current) {
              // Resume listening cleanly if only background noise was heard
              void startMicCapture(true);
            } else {
              setVoiceError('No clear speech detected in recording. Please speak closer to your mic.');
            }
          }
        } catch (err) {
          if (!cancelRecordingRef.current) {
            setVoiceError(
              err instanceof Error ? err.message : 'Failed to transcribe recorded audio.'
            );
          }
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecordingAudio(true);

      // Live real microphone waveform + Voice Activity Detection (VAD) loop
      clearVadTimer();
      const timeData = analyserRef.current
        ? new Uint8Array(analyserRef.current.fftSize)
        : null;
      const freqData = analyserRef.current
        ? new Uint8Array(analyserRef.current.frequencyBinCount)
        : null;

      vadTimerRef.current = window.setInterval(() => {
        if (!analyserRef.current || !timeData || !freqData) return;

        analyserRef.current.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i += 1) {
          const normalized = (timeData[i] - 128) / 128;
          sumSq += normalized * normalized;
        }
        const rms = Math.sqrt(sumSq / timeData.length);

        analyserRef.current.getByteFrequencyData(freqData);
        const step = Math.max(1, Math.floor(freqData.length / 16));
        const nextBars = Array.from({ length: 16 }, (_, idx) => {
          const v = freqData[idx * step] ?? 0;
          return Math.min(96, Math.max(10, Math.round((v / 255) * 85 + Math.min(65, rms * 280))));
        });
        setAudioLevels(nextBars);

        const now = Date.now();
        if (rms > 0.011) {
          lastVoiceAtRef.current = now;
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            setSpeechDetected(true);
          }
        }

        // Hands-free auto-endpointing: 1.5s of silence after speech OR 18s max utterance cap
        if (autoSendOnSilence && speechDetectedRef.current) {
          const silenceDuration = now - lastVoiceAtRef.current;
          const totalDuration = now - recordingStartedAtRef.current;
          if (silenceDuration >= 1500 || totalDuration >= 18000) {
            try {
              if (recorder.state !== 'inactive') {
                recorder.stop();
              }
            } catch {
              // ignore
            }
          }
        }
      }, 90);
    },
    [clearVadTimer, ensureMicrophoneStream]
  );

  const stopMicCapture = useCallback(
    (discard: boolean) => {
      cancelRecordingRef.current = discard;
      clearVadTimer();
      if (mediaRecorderRef.current) {
        const recorder = mediaRecorderRef.current;
        try {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        } catch {
          // ignore
        }
      }
      if (discard) {
        setIsRecordingAudio(false);
        setSpeechDetected(false);
      }
    },
    [clearVadTimer]
  );

  const stopAll = useCallback(() => {
    stopPlayback();

    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        if (typeof rec.abort === 'function') {
          rec.abort();
        } else {
          rec.stop();
        }
      } catch {
        // ignore
      }
    }
    setIsListening(false);
    setInterimTranscript('');

    stopMicCapture(true);
    releaseMicrophone();
  }, [releaseMicrophone, stopMicCapture, stopPlayback]);

  const speakText = useCallback(
    async (text: string, overrideLang?: SupportedLanguageCode) => {
      const resumeHandsFree = () => {
        if (
          isCallActiveRef.current &&
          handsFreeRef.current &&
          !isProcessingRef.current
        ) {
          void startMicCapture(true);
        }
      };

      if (!options.ttsEnabled || !text.trim()) {
        resumeHandsFree();
        return;
      }

      // Pause mic while AI speaks so the mic doesn't transcribe the AI's own voice
      stopMicCapture(true);
      stopPlayback();
      const myToken = playbackTokenRef.current;
      setVoiceError(null);

      const targetLang = overrideLang ?? options.language;
      try {
        setIsSpeaking(true);
        const { base64Wav, mimeType } = await api.synthesizeTts({
          text,
          voiceName: options.voicePersona,
          language: targetLang,
        });

        if (playbackTokenRef.current !== myToken) {
          setIsSpeaking(false);
          return;
        }

        const audio = new Audio(`data:${mimeType || 'audio/wav'};base64,${base64Wav}`);
        activeAudioRef.current = audio;
        audio.onended = () => {
          if (playbackTokenRef.current === myToken) {
            setIsSpeaking(false);
            activeAudioRef.current = null;
            resumeHandsFree();
          }
        };
        audio.onerror = () => {
          if (playbackTokenRef.current === myToken) {
            setIsSpeaking(false);
            activeAudioRef.current = null;
            resumeHandsFree();
          }
        };
        await audio.play().catch(() => {
          if (playbackTokenRef.current === myToken) {
            setIsSpeaking(false);
            activeAudioRef.current = null;
            resumeHandsFree();
          }
        });
      } catch (err) {
        if (playbackTokenRef.current !== myToken) {
          setIsSpeaking(false);
          return;
        }
        setIsSpeaking(false);
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            const utter = new SpeechSynthesisUtterance(text);
            const langEntry = LANGUAGE_OPTIONS.find((l) => l.code === targetLang);
            utter.lang = langEntry?.bcp47 ?? 'en-US';
            utter.onstart = () => {
              if (playbackTokenRef.current === myToken) setIsSpeaking(true);
            };
            utter.onend = () => {
              setIsSpeaking(false);
              if (playbackTokenRef.current === myToken) resumeHandsFree();
            };
            utter.onerror = () => {
              setIsSpeaking(false);
              if (playbackTokenRef.current === myToken) resumeHandsFree();
            };
            window.speechSynthesis.speak(utter);
          } catch {
            setIsSpeaking(false);
            resumeHandsFree();
          }
        } else {
          setVoiceError(err instanceof Error ? err.message : 'Unable to play synthesized voice.');
          resumeHandsFree();
        }
      }
    },
    [options.language, options.ttsEnabled, options.voicePersona, startMicCapture, stopMicCapture, stopPlayback]
  );

  // Manual toggle for Gemini Audio STT (also lets user immediately interrupt AI & send speech!)
  const toggleGeminiAudioStt = useCallback(async () => {
    setVoiceError(null);
    if (isRecordingAudio) {
      // Stop and send captured speech immediately
      speechDetectedRef.current = true;
      stopMicCapture(false);
      return;
    }
    stopPlayback();
    await startMicCapture(options.handsFreeEnabled);
  }, [isRecordingAudio, options.handsFreeEnabled, startMicCapture, stopMicCapture, stopPlayback]);

  // Optional Browser Live Web Speech STT toggle
  const toggleLiveSpeechStt = useCallback(() => {
    setVoiceError(null);
    if (isListening && recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      setInterimTranscript('');
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceError(
        'Browser Web Speech is unavailable here. Use "Speak Now (Mic)" for Gemini Audio STT.'
      );
      return;
    }

    stopMicCapture(true);
    stopPlayback();

    const recognition = new SpeechRec();
    const langEntry = LANGUAGE_OPTIONS.find((l) => l.code === options.language);
    recognition.lang = langEntry?.bcp47 ?? 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) {
          finalChunk += text;
        } else {
          interim += text;
        }
      }
      setInterimTranscript(interim);
      if (finalChunk.trim()) {
        setInterimTranscript('');
        onFinalTranscriptRef.current(finalChunk.trim());
      }
    };

    recognition.onerror = (ev: { error: string }) => {
      setIsListening(false);
      setInterimTranscript('');
      recognitionRef.current = null;
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setVoiceError(
          `Browser Web Speech error (${ev.error}). Use "Speak Now (Mic)" instead for full cross-browser Gemini STT.`
        );
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceError('Could not start browser speech recognition. Use "Speak Now (Mic)" instead.');
    }
  }, [isListening, options.language, stopMicCapture, stopPlayback]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  return {
    micPermission,
    isListening,
    isRecordingAudio,
    speechDetected,
    isTranscribing,
    isSpeaking,
    interimTranscript,
    voiceError,
    audioLevels,
    ensureMicrophoneStream,
    startMicCapture,
    speakText,
    stopPlayback,
    stopAll,
    toggleLiveSpeechStt,
    toggleGeminiAudioStt,
    clearVoiceError: () => setVoiceError(null),
  };
}
