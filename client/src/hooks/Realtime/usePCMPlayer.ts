import { useCallback, useRef } from 'react';
import { decodePCM16Base64 } from './audio';

export default function usePCMPlayer() {
  const contextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const ensureContext = useCallback(async () => {
    if (!contextRef.current) {
      contextRef.current = new AudioContext();
    }

    if (contextRef.current.state === 'suspended') {
      await contextRef.current.resume();
    }

    return contextRef.current;
  }, []);

  const stopAll = useCallback(async () => {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // no-op
      }
    }

    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (contextRef.current) {
      await contextRef.current.close().catch(() => undefined);
      contextRef.current = null;
    }
  }, []);

  const enqueue = useCallback(
    async (audio: string, sampleRate: number) => {
      const context = await ensureContext();
      const samples = decodePCM16Base64(audio);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      const channelSamples = new Float32Array(samples.length);

      channelSamples.set(samples);
      buffer.copyToChannel(channelSamples, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const startTime = Math.max(context.currentTime, nextStartTimeRef.current);
      source.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;

      sourcesRef.current.add(source);
      source.onended = () => {
        sourcesRef.current.delete(source);
      };
    },
    [ensureContext],
  );

  return {
    enqueue,
    stopAll,
  };
}
