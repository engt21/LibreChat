const {
  applyReplacement,
  patchTargets,
  validatePatchedFile,
} = require('../../../../config/apply-runtime-patches');

describe('apply-runtime-patches web search status patch', () => {
  const streamTargets = patchTargets.filter((target) =>
    ['src/stream.ts', 'dist/esm/stream.mjs', 'dist/cjs/stream.cjs'].includes(target.relativePath),
  );
  const streamTarget = streamTargets.find((target) => target.relativePath === 'src/stream.ts');
  const streamReplacement = streamTarget.replacements.find((replacement) =>
    Array.isArray(replacement.legacy),
  );

  it('patches the stream handler without referencing an outer stepKey', () => {
    const patched = applyReplacement(streamReplacement.from, streamReplacement, 'src/stream.ts');

    expect(patched).toContain('const webSearchStepKey = graph.getStepKey(metadata);');
    expect(patched).toContain('webSearchStepId = graph.getStepIdByKey(webSearchStepKey);');
    expect(patched).not.toContain('graph.getStepIdByKey(stepKey);');
    expect(patched).toContain('{ id: webSearchStepId, status: webSearchStatus }');
  });

  it('upgrades the legacy buggy stream patch in place', () => {
    const patched = applyReplacement(
      streamReplacement.legacy[0],
      streamReplacement,
      'src/stream.ts',
    );

    expect(patched).toBe(streamReplacement.to);
  });

  it('keeps the fixed patch idempotent', () => {
    expect(applyReplacement(streamReplacement.to, streamReplacement, 'src/stream.ts')).toBe(
      streamReplacement.to,
    );
  });

  it('validates the fixed web search status guard across all stream targets', () => {
    for (const target of streamTargets) {
      const replacement = target.replacements.find((candidate) => Array.isArray(candidate.legacy));
      expect(() => validatePatchedFile(target.relativePath, replacement.to)).not.toThrow();
    }
  });

  it('rejects the legacy stepKey-before-initialization regression across all stream targets', () => {
    for (const target of streamTargets) {
      const replacement = target.replacements.find((candidate) => Array.isArray(candidate.legacy));
      expect(() => validatePatchedFile(target.relativePath, replacement.legacy[0])).toThrow(
        /stepKey is referenced before initialization/,
      );
    }
  });
});
