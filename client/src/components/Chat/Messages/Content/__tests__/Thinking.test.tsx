import React from 'react';
import { render } from '@testing-library/react';
import { ThinkingContent } from '../Parts/Thinking';

describe('ThinkingContent', () => {
  it('renders markdown emphasis without losing whitespace-preserving paragraphs', () => {
    const content =
      '**Searching for restaurant recommendations**\nI need *reliable* sources for current menus.';

    const { container, queryByText } = render(<ThinkingContent>{content}</ThinkingContent>);

    expect(container.querySelector('strong')).toHaveTextContent(
      'Searching for restaurant recommendations',
    );
    expect(container.querySelector('em')).toHaveTextContent('reliable');
    expect(container.querySelector('p.whitespace-pre-wrap')).toBeInTheDocument();
    expect(queryByText(/\*\*Searching for restaurant recommendations\*\*/)).not.toBeInTheDocument();
  });

  it('renders streamed reasoning soft breaks as visible line breaks', () => {
    const content =
      '**Researching amplification at the Met Opera**\nI should search official and community sources.\nThen I can compare the answers.';

    const { container } = render(<ThinkingContent>{content}</ThinkingContent>);

    expect(container.querySelectorAll('br')).toHaveLength(2);
    expect(container.querySelector('.markdown.whitespace-pre-wrap')).toBeInTheDocument();
  });
});
