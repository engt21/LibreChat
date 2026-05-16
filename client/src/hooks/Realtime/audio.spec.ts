import {
  decodePCM16Base64,
  encodePCM16Base64,
  resampleFloat32,
} from './audio';

describe('realtime audio helpers', () => {
  it('round-trips PCM16 audio through base64', () => {
    const source = new Float32Array([0, 0.5, -0.5, 0.25, -0.25]);

    const encoded = encodePCM16Base64(source);
    const decoded = decodePCM16Base64(encoded);

    expect(decoded).toHaveLength(source.length);
    decoded.forEach((sample, index) => {
      expect(sample).toBeCloseTo(source[index], 2);
    });
  });

  it('resamples audio to the requested sample rate', () => {
    const source = new Float32Array([0, 1, 0, -1]);
    const resampled = resampleFloat32(source, 4, 2);

    expect(resampled).toHaveLength(2);
    expect(Array.from(resampled)).toEqual(expect.arrayContaining([0, 0]));
  });
});
