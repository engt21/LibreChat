export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return window.btoa(binary);
}

export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export function pcm16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] / 0x8000;
  }

  return output;
}

export function resampleFloat32(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (inputSampleRate === outputSampleRate || input.length === 0) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const sourceIndex = i * ratio;
    const beforeIndex = Math.floor(sourceIndex);
    const afterIndex = Math.min(beforeIndex + 1, input.length - 1);
    const weight = sourceIndex - beforeIndex;
    output[i] = input[beforeIndex] * (1 - weight) + input[afterIndex] * weight;
  }

  return output;
}

export function encodePCM16Base64(input: Float32Array): string {
  const pcm = floatTo16BitPCM(input);
  return uint8ArrayToBase64(new Uint8Array(pcm.buffer));
}

export function decodePCM16Base64(base64: string): Float32Array {
  const bytes = base64ToUint8Array(base64);
  const pcm = new Int16Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return pcm16ToFloat32(pcm);
}
