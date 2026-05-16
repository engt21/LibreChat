import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { Tools } from 'librechat-data-provider';
import WebSearch from '../WebSearch';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key, values) => {
    const translations: Record<string, string> = {
      com_ui_web_searched: 'Searched the web',
      com_ui_web_search_source: `${values?.count ?? 0} source`,
      com_ui_web_search_sources: `${values?.count ?? 0} sources`,
      com_ui_web_searching: 'Searching the web',
      com_ui_web_searching_again: 'Searching the web again',
      com_ui_web_search_processing: 'Processing results',
      com_ui_web_search_reading: 'Reading results',
    };
    return translations[key] ?? key;
  },
  useExpandCollapse: () => ({ style: {}, ref: jest.fn() }),
}));

jest.mock('~/components/Web/Sources', () => ({
  StackedFavicons: () => <span data-testid="stacked-favicons" />,
}));

jest.mock('~/components/Web/SourceHovercard', () => ({
  FaviconImage: ({ domain }) => <span data-testid="favicon">{domain}</span>,
  getCleanDomain: (url) => url.replace(/(^\w+:|^)\/\//, '').split('/')[0],
}));

describe('WebSearch', () => {
  it('renders completed web search attachments without crashing', () => {
    render(
      <RecoilRoot>
        <WebSearch
          initialProgress={1}
          isSubmitting={false}
          isLast={false}
          output=""
          attachments={[
            {
              type: Tools.web_search,
              messageId: 'message-1',
              toolCallId: 'tool-1',
              conversationId: 'conversation-1',
              [Tools.web_search]: {
                turn: 0,
                organic: [
                  {
                    link: 'https://example.com/result',
                    title: 'Example result',
                    processed: true,
                  },
                ],
              },
            },
          ]}
        />
      </RecoilRoot>,
    );

    expect(screen.getAllByText('Searched the web')).not.toHaveLength(0);
  });
});
