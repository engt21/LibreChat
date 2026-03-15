import { memo } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import supersub from 'remark-supersub';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { PluggableList } from 'unified';
import { code, codeNoExecution, a, p, img } from './MarkdownComponents';
import { softBreaksPlugin } from './softBreaksPlugin';
import { CodeBlockProvider, ArtifactProvider } from '~/Providers';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { langSubset } from '~/utils';

const MarkdownLite = memo(
  ({
    content = '',
    codeExecution = true,
    softBreaks = false,
  }: {
    content?: string;
    codeExecution?: boolean;
    softBreaks?: boolean;
  }) => {
    const remarkPlugins = [
      supersub,
      remarkGfm,
      [remarkMath, { singleDollarTextMath: false }],
      ...(softBreaks ? [softBreaksPlugin] : []),
    ] as unknown as PluggableList;

    const rehypePlugins = [
      [rehypeKatex],
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ] as unknown as PluggableList;

    return (
      <MarkdownErrorBoundary
        content={content}
        codeExecution={codeExecution}
        softBreaks={softBreaks}
      >
        <ArtifactProvider>
          <CodeBlockProvider>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={
                {
                  code: codeExecution ? code : codeNoExecution,
                  a,
                  p,
                  img,
                } as {
                  [nodeType: string]: React.ElementType;
                }
              }
            >
              {content}
            </ReactMarkdown>
          </CodeBlockProvider>
        </ArtifactProvider>
      </MarkdownErrorBoundary>
    );
  },
);

export default MarkdownLite;
