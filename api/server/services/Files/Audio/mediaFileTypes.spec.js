const { isTranscribableMediaFile } = require('./mediaFileTypes');

describe('isTranscribableMediaFile', () => {
  it('accepts common audio and video mime aliases', () => {
    expect(isTranscribableMediaFile({ mimetype: 'video/matroska' })).toBe(true);
    expect(isTranscribableMediaFile({ mimetype: 'video/x-matroska' })).toBe(true);
    expect(isTranscribableMediaFile({ mimetype: 'audio/x-ms-wma' })).toBe(true);
    expect(isTranscribableMediaFile({ mimetype: 'application/ogg' })).toBe(true);
  });

  it('falls back to the filename extension when the mimetype is missing', () => {
    expect(isTranscribableMediaFile({ filename: 'concert.mkv' })).toBe(true);
    expect(isTranscribableMediaFile({ filename: 'lecture.aiff' })).toBe(true);
  });

  it('rejects non-media files', () => {
    expect(isTranscribableMediaFile({ mimetype: 'application/pdf', filename: 'notes.pdf' })).toBe(
      false,
    );
  });
});
