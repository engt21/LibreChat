import { Button } from '@librechat/client';
import useLocalize from '~/hooks/useLocalize';
import { useGenerationTree } from '~/Providers';

export default function ConversationTreePanel() {
  const localize = useLocalize();
  const { openTree } = useGenerationTree();

  return (
    <section
      className="space-y-3 px-3 py-4"
      aria-label={localize('com_sidepanel_conversation_tree')}
    >
      <p className="text-sm text-text-secondary">
        {localize('com_ui_conversation_tree_description')}
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center bg-transparent"
        onClick={() => openTree()}
      >
        {localize('com_ui_open_conversation_tree')}
      </Button>
    </section>
  );
}
