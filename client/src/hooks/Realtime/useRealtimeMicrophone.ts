import { useCallback, useRef, useState } from 'react';
import { encodePCM16Base64, resampleFloat32 } from './audio';
import { requestMicrophoneStream } from '~/utils/microphonePermission';

type StartRecordingOptions = {
  sampleRate: number;
  onChunk: (chunk: string) => void;
};

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const PROCESSOR_BUFFER_SIZE = 4096;

export default function useRealtimeMicrophone() {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedGainRef = useRef<GainNode | null>(null);
  const onChunkRef = useRef<((chunk: string) => void) | null>(null);

  const [isRecording, setIsRecording] = useState(false);

  const stopRecording = useCallback(async () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mutedGainRef.current?.disconnect();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current = null;
    processorRef.current = null;
    mutedGainRef.current = null;
    onChunkRef.current = null;

    if (contextRef.current) {
      await contextRef.current.close().catch(() => undefined);
      contextRef.current = null;
    }

    setIsRecording(false);
  }, []);

  const startRecording = useCallback(
    async ({ sampleRate, onChunk }: StartRecordingOptions) => {
      if (isRecording) {
        return;
      }

      const stream = await requestMicrophoneStream();

      const AudioContextCtor =
        window.AudioContext || (window as AudioContextWindow).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error('AudioContext is not supported in this browser.');
      }

      const context = new AudioContextCtor();
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      const mutedGain = context.createGain();
      mutedGain.gain.value = 0;

      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      mutedGainRef.current = mutedGain;
      onChunkRef.current = onChunk;

      processor.onaudioprocess = (event) => {
        const audioBuffer = event.inputBuffer.getChannelData(0);
        const copied = new Float32Array(audioBuffer.length);
        copied.set(audioBuffer);

        const resampled = resampleFloat32(copied, context.sampleRate, sampleRate);
        const base64 = encodePCM16Base64(resampled);
        onChunkRef.current?.(base64);
      };

      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(context.destination);
      setIsRecording(true);
    },
    [isRecording],
  );

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
