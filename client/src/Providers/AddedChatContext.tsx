import { createContext, useContext } from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { ConvoGenerator } from '~/common';
import type { AddedConversationEntry } from '~/store/families';

type TAddedChatContext = {
  conversation: TConversation | null;
  conversations: TConversation[];
  entries: AddedConversationEntry[];
  setConversation: SetterOrUpdater<TConversation | null>;
  setConversationAtIndex: (index: string | number, value: TConversation | null) => void;
  removeConversation: (index: string | number) => void;
  generateConversation: ConvoGenerator;
};

export const AddedChatContext = createContext<TAddedChatContext>({} as TAddedChatContext);
export const useAddedChatContext = () => useContext(AddedChatContext);
