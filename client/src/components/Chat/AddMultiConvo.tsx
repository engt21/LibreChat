import { useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { PlusCircle } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { isAssistantsEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useGetConversation, useLocalize } from '~/hooks';
import { useAddedChatContext } from '~/Providers';
import { mainTextareaId } from '~/common';
import store from '~/store';

function AddMultiConvo() {
  const localize = useLocalize();
  const getConversation = useGetConversation(0);
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0));
  const { generateConversation } = useAddedChatContext();

  const clickHandler = useCallback(() => {
    const conversation = getConversation();
    const { title: _t, ...convo } = conversation ?? ({} as TConversation);
    generateConversation({
      template: {
        ...convo,
        title: '',
      } as TConversation,
    });

    const textarea = document.getElementById(mainTextareaId);
    if (textarea) {
      textarea.focus();
    }
  }, [generateConversation, getConversation]);

  if (!endpoint) {
    return null;
  }

  if (isAssistantsEndpoint(endpoint)) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_ui_add_multi_conversation')}
      role="button"
      tabIndex={0}
      aria-label={localize('com_ui_add_multi_conversation')}
      onClick={clickHandler}
      data-testid="add-multi-convo-button"
      className="inline-flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-border-light bg-presentation text-text-primary transition-all ease-in-out hover:bg-surface-tertiary disabled:pointer-events-none disabled:opacity-50 radix-state-open:bg-surface-tertiary"
    >
      <PlusCircle className="icon-lg" aria-hidden="true" />
    </TooltipAnchor>
  );
}

export default AddMultiConvo;
