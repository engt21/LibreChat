import React from 'react';
import { Circle, Loader2 } from 'lucide-react';

interface CircleRenderProps {
  rmsLevel: number;
  isCameraOn: boolean;
  state?: string | null;
}

const CircleRender = ({ rmsLevel, isCameraOn, state }: CircleRenderProps) => {
  const baseScale = isCameraOn ? 0.5 : 1;
  const scaleMultiplier =
    rmsLevel > 0.08
      ? 1.8
      : rmsLevel > 0.07
        ? 1.6
        : rmsLevel > 0.05
          ? 1.4
          : rmsLevel > 0.01
            ? 1.2
            : 1;

  const transformScale = baseScale * scaleMultiplier;

  const iconProps = {
    className: state === 'Thinking' ? 'smooth-transition animate-spin' : 'smooth-transition',
    size: 256,
    style: { transform: `scale(${transformScale})` },
  };

  if (state === 'Thinking') {
    return <Loader2 {...iconProps} />;
  }

  return <Circle {...iconProps} />;
};

export default CircleRender;
