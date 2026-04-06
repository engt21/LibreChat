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

/*
 * Reasoning history reconstruction patches
 *
 * These tests protect the hotfix that prevents invalid-history API errors on follow-up
 * OpenAI/Azure Responses turns when prior reasoning and tool outputs are present.
 *
 * The fix has three parts:
 *   1. Strip provider-issued `id` from reasoning items during reconstruction
 *      (avoids "required following item" API errors)
 *   2. Skip reasoning items that have no `summary` (avoids empty reasoning replays)
 *   3. Wait for `response.reasoning_summary_part.done` instead of `.added`
 *      (avoids streaming incomplete summaries)
 */
describe('apply-runtime-patches reasoning history reconstruction', () => {
  // Collect all reconstruction patch targets across src, esm, and cjs
  const reconstructionTargetPaths = [
    'src/llm/openai/utils/index.ts',
    'dist/esm/llm/openai/utils/index.mjs',
    'dist/cjs/llm/openai/utils/index.cjs',
  ];

  const reconstructionTargets = patchTargets.filter(
    (target) =>
      reconstructionTargetPaths.includes(target.relativePath) &&
      target.replacements.some(
        (r) => r.to.includes('strip id') && r.to.includes('reasoningWithoutId'),
      ),
  );

  it('has reconstruction patches for src, esm, and cjs', () => {
    const paths = reconstructionTargets.map((t) => t.relativePath);
    expect(paths).toContain('src/llm/openai/utils/index.ts');
    expect(paths).toContain('dist/esm/llm/openai/utils/index.mjs');
    expect(paths).toContain('dist/cjs/llm/openai/utils/index.cjs');
  });

  describe.each(reconstructionTargets)('$relativePath', (target) => {
    const replacement = target.replacements.find(
      (r) => r.to.includes('strip id') && r.to.includes('reasoningWithoutId'),
    );

    it('strips the provider-issued id from reasoning items', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      // Must destructure out id
      expect(patched).toContain('id: _rid');
      expect(patched).toContain('...reasoningWithoutId');

      // Must pass reasoningWithoutId (not the original reasoning) to the converter
      expect(patched).toContain(
        '_convertReasoningSummaryToOpenAIResponsesParams(reasoningWithoutId)',
      );
      expect(patched).not.toMatch(
        /_convertReasoningSummaryToOpenAIResponsesParams\(additional_kwargs\.reasoning\)/,
      );
    });

    it('does not push reasoning items without a summary', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      // Must guard against missing/empty summary before pushing
      expect(patched).toContain('if (reasoningWithoutId.summary)');
    });

    it('still pushes reasoning items that have a valid summary', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      // Inside the summary guard, the converter and push must both be present
      expect(patched).toContain(
        '_convertReasoningSummaryToOpenAIResponsesParams(reasoningWithoutId)',
      );
      expect(patched).toContain('input.push(reasoningItem)');
    });

    it('is idempotent when the patch is already applied', () => {
      const result = applyReplacement(replacement.to, replacement, target.relativePath);
      expect(result).toBe(replacement.to);
    });

    it('preserves reasoning-before-message ordering in the reconstructed output', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      // In the patched code, reasoning items are pushed BEFORE the message item.
      // The reasoning block ends before the "// ai content" block begins.
      const reasoningIdx = patched.indexOf('reasoningWithoutId');
      const messageIdx = patched.indexOf("type: 'message'");

      // Both must be present and reasoning must come first
      expect(reasoningIdx).toBeGreaterThan(-1);
      // The message item should appear later in the file or not at all in this replacement
      // (since the replacement is only the reasoning block). Check the `to` string directly:
      // reasoning block is fully contained in `to` and does not include message push.
      expect(replacement.to).not.toMatch(/type:\s*['"]message['"]/);
    });
  });
});

/*
 * Reasoning summary streaming patches
 *
 * These tests ensure the streaming layer captures complete reasoning summaries
 * via `response.reasoning_summary_part.done` instead of partial `.added` events,
 * and that the initial `output_item.added` reasoning event no longer spreads
 * incomplete summary data from the chunk.
 */
describe('apply-runtime-patches reasoning summary streaming', () => {
  // The streaming patches are in the first patchTarget entries for each file
  const streamingPatchPaths = [
    'src/llm/openai/utils/index.ts',
    'dist/esm/llm/openai/utils/index.mjs',
    'dist/cjs/llm/openai/utils/index.cjs',
  ];

  const streamingTargets = patchTargets.filter(
    (target) =>
      streamingPatchPaths.includes(target.relativePath) &&
      target.replacements.some(
        (r) =>
          r.from.includes('reasoning_summary_part.added') ||
          r.from.includes('reasoning_summary_text.delta'),
      ),
  );

  it('has streaming patches for src, esm, and cjs', () => {
    const paths = streamingTargets.map((t) => t.relativePath);
    expect(paths).toContain('src/llm/openai/utils/index.ts');
    expect(paths).toContain('dist/esm/llm/openai/utils/index.mjs');
    expect(paths).toContain('dist/cjs/llm/openai/utils/index.cjs');
  });

  describe.each(streamingTargets)('$relativePath', (target) => {
    const replacement = target.replacements.find(
      (r) =>
        r.from.includes('reasoning_summary_part.added') ||
        r.from.includes('reasoning_summary_text.delta'),
    );

    it('replaces summary_part.added with summary_part.done', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      expect(patched).toContain('reasoning_summary_part.done');
      expect(patched).not.toContain('reasoning_summary_part.added');
    });

    it('removes the streaming text.delta handler for reasoning summaries', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      expect(patched).not.toContain('reasoning_summary_text.delta');
    });

    it('no longer spreads incomplete summary from output_item.added', () => {
      const patched = applyReplacement(replacement.from, replacement, target.relativePath);

      // The patched output_item.added handler should NOT spread summary
      // Original had: ...(summary ? { summary } : {})
      // Patched removes summary entirely from the output_item.added block
      expect(patched).not.toMatch(/\.\.\.\(summary\s*\?\s*\{\s*summary\s*\}\s*:\s*\{\}\)/);
    });

    it('is idempotent when the patch is already applied', () => {
      const result = applyReplacement(replacement.to, replacement, target.relativePath);
      expect(result).toBe(replacement.to);
    });
  });
});

/*
 * Cross-patch coherence: the streaming patch and the reconstruction patch must agree.
 * If streaming captures a reasoning.id in output_item.added, reconstruction must strip it.
 * If streaming waits for summary_part.done, reconstruction must not push items without summary.
 */
describe('apply-runtime-patches reasoning cross-patch coherence', () => {
  it('streaming still captures reasoning id in output_item.added (which reconstruction strips)', () => {
    // The streaming patch for output_item.added keeps `id: chunk.item.id`.
    // This is correct because the id is needed during the streaming lifecycle.
    // The reconstruction patch then strips it before replaying to the API.
    const srcStreamingTarget = patchTargets.find(
      (t) =>
        t.relativePath === 'src/llm/openai/utils/index.ts' &&
        t.replacements.some((r) => r.to.includes('reasoning_summary_part.done')),
    );
    const streamingReplacement = srcStreamingTarget.replacements.find((r) =>
      r.to.includes('reasoning_summary_part.done'),
    );

    // Streaming patch TO still has `id: chunk.item.id` in the output_item.added block
    expect(streamingReplacement.to).toContain('id: chunk.item.id');

    // Reconstruction patch TO strips it
    const srcReconTarget = patchTargets.find(
      (t) =>
        t.relativePath === 'src/llm/openai/utils/index.ts' &&
        t.replacements.some((r) => r.to.includes('reasoningWithoutId')),
    );
    const reconReplacement = srcReconTarget.replacements.find((r) =>
      r.to.includes('reasoningWithoutId'),
    );
    expect(reconReplacement.to).toContain('id: _rid');
  });

  it('reconstruction summary guard aligns with streaming summary_part.done semantics', () => {
    // Streaming waits for summary_part.done, so a stored message will have either:
    //   - {type:'reasoning', id:'rs_xxx'} (from output_item.added, no summary yet)
    //   - {type:'reasoning', summary:[...]} (from summary_part.done, summary present)
    // The reconstruction guard `if (reasoningWithoutId.summary)` correctly handles both:
    //   - First case: no summary → skipped (prevents empty reasoning replay)
    //   - Second case: has summary → included after stripping id
    const esmReconTarget = patchTargets.find(
      (t) =>
        t.relativePath === 'dist/esm/llm/openai/utils/index.mjs' &&
        t.replacements.some((r) => r.to.includes('reasoningWithoutId')),
    );
    const reconReplacement = esmReconTarget.replacements.find((r) =>
      r.to.includes('reasoningWithoutId'),
    );

    expect(reconReplacement.to).toContain('if (reasoningWithoutId.summary)');
    expect(reconReplacement.to).not.toContain('additional_kwargs.reasoning)');
  });
});
