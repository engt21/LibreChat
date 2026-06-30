import { useRecoilCallback } from 'recoil';
import store from '~/store';

/**
 * Hook that provides lazy access to addedConvos without subscribing to changes.
 * Use this to avoid unnecessary re-renders when added conversations change.
 */
export function useGetAddedConvos() {
  return useRecoilCallback(
    ({ snapshot }) =>
      () =>
        snapshot
          .getLoadable(store.addedConversationsSelector)
          .getValue()
          .map((entry) => entry.conversation),
    [],
  );
}

export default function useGetAddedConvo() {
  const getAddedConvos = useGetAddedConvos();
  return () => getAddedConvos()[0] ?? null;
}
