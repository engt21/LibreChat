import { useState, useEffect, useRef } from 'react';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';
import Image from '~/components/Chat/Messages/Content/Image';
import ProgressText from './ProgressText';
import { cn } from '~/utils';

const IMAGE_MAX_H = 'max-h-[45vh]' as const;
const IMAGE_FULL_H = 'h-[45vh]' as const;

export default function OpenAIImageGen({
  initialProgress = 0.1,
  isSubmitting,
  toolName,
  args: _args = '',
  output,
  attachments,
}: {
  initialProgress: number;
  isSubmitting: boolean;
  toolName: string;
  args: string | Record<string, unknown>;
  output?: string | null;
  attachments?: TAttachment[];
}) {
  const [progress, setProgress] = useState(initialProgress);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const error =
    typeof output === 'string' && output.toLowerCase().includes('error processing tool');

  const cancelled = (!isSubmitting && initialProgress < 1) || error === true;

  let quality: 'low' | 'medium' | 'high' = 'high';

  let parsedArgs: Record<string, unknown> = {};
  if (typeof _args === 'string') {
    const args = _args.trim();
    if (args.endsWith('}')) {
      try {
        parsedArgs = JSON.parse(args) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
    }
  } else {
    parsedArgs = _args;
  }

  if (parsedArgs && typeof parsedArgs.quality === 'string') {
    const q = parsedArgs.quality.toLowerCase();
    if (q === 'low' || q === 'medium' || q === 'high') {
      quality = q;
    }
  }

  const persistedAttachments = attachments?.filter((item) => {
    const attachment = item as TFile & TAttachmentMetadata;
    const isTransient =
      attachment.partial != null ||
      attachment.partialImageIndex != null ||
      attachment.filepath?.startsWith('data:image/');
    return !isTransient && (!!attachment.file_id || !!attachment.filepath);
  });
  const latestAttachment = attachments?.[attachments.length - 1];
  let displayAttachments = persistedAttachments ?? [];
  if (displayAttachments.length === 0 && latestAttachment) {
    displayAttachments = [latestAttachment];
  }

  useEffect(() => {
    if (isSubmitting) {
      setProgress(initialProgress);

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      let baseDuration = 20000;
      if (quality === 'low') {
        baseDuration = 10000;
      } else if (quality === 'high') {
        baseDuration = 50000;
      }
      // adding some jitter (±30% of base)
      const jitter = Math.floor(baseDuration * 0.3);
      const totalDuration = Math.floor(Math.random() * jitter) + baseDuration;
      const updateInterval = 200;
      const totalSteps = totalDuration / updateInterval;
      let currentStep = 0;

      intervalRef.current = setInterval(() => {
        currentStep++;

        if (currentStep >= totalSteps) {
          clearInterval(intervalRef.current as NodeJS.Timeout);
          setProgress(0.9);
        } else {
          const progressRatio = currentStep / totalSteps;
          let mapRatio: number;
          if (progressRatio < 0.8) {
            mapRatio = Math.pow(progressRatio, 1.1);
          } else {
            const sub = (progressRatio - 0.8) / 0.2;
            mapRatio = 0.8 + (1 - Math.pow(1 - sub, 2)) * 0.2;
          }
          const scaledProgress = 0.1 + mapRatio * 0.8;

          setProgress(scaledProgress);
        }
      }, updateInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isSubmitting, initialProgress, quality]);

  useEffect(() => {
    if (initialProgress >= 1 || cancelled) {
      setProgress(initialProgress);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [initialProgress, cancelled]);

  return (
    <>
      <div className="relative my-2.5 flex size-5 shrink-0 items-center gap-2.5">
        <ProgressText progress={progress} error={cancelled} toolName={toolName} />
      </div>
      {displayAttachments.map((item, index) => {
        const attachment = item as TFile & TAttachmentMetadata;
        const { filepath, filename = '', width: imgWidth, height: imgHeight } = attachment;
        if (!filepath) {
          return null;
        }

        return (
          <div
            key={attachment.file_id ?? `${filepath}-${index}`}
            className={cn('relative mb-2 flex w-full max-w-lg justify-start', IMAGE_MAX_H)}
          >
            <div
              className={cn('overflow-hidden', progress < 1 ? [IMAGE_FULL_H, 'w-full'] : 'w-auto')}
            >
              <Image
                width={imgWidth}
                args={parsedArgs}
                height={imgHeight}
                altText={filename}
                imagePath={filepath}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
