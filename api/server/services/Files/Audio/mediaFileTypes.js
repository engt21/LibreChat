const transcribableMediaPattern =
  /\.(aac|aif|aiff|amr|avi|caf|flac|m4a|m4b|m4p|m4r|mkv|mov|mp2|mp3|mp4|mpeg|mpga|oga|ogg|opus|wav|webm|wma)$/i;

function isTranscribableMediaFile({ filename, mimetype }) {
  return Boolean(
    (typeof mimetype === 'string' &&
      (mimetype.startsWith('audio/') ||
        mimetype.startsWith('video/') ||
        mimetype === 'application/ogg')) ||
    (typeof filename === 'string' && transcribableMediaPattern.test(filename)),
  );
}

module.exports = {
  transcribableMediaPattern,
  isTranscribableMediaFile,
};
