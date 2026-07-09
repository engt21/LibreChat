import type useLocalize from '~/hooks/useLocalize';
import type { ConversationTreeNode, PositionedTreeNode } from './types';

type Localize = ReturnType<typeof useLocalize>;
type TreeNodeLike = ConversationTreeNode | PositionedTreeNode;

export function getTreeNodeLabel(localize: Localize, node: TreeNodeLike | null): string {
  if (node == null) {
    return localize('com_ui_none');
  }

  if (node.role === 'assistant' && node.generationIndex > 0) {
    if (node.generationCount > 1) {
      return localize('com_ui_generation_tree_generation_position', {
        index: node.generationIndex,
        count: node.generationCount,
      });
    }

    return localize('com_ui_generation_tree_generation_label', {
      index: node.generationIndex,
    });
  }

  if (node.role === 'graft_bridge') {
    return localize('com_ui_generation_tree_node_graft_bridge');
  }

  return localize('com_ui_generation_tree_node_prompt');
}

export function getTreeNodeExcerpt(localize: Localize, node: TreeNodeLike | null): string {
  if (node == null) {
    return localize('com_ui_none');
  }

  if (typeof node.message.text === 'string' && node.message.text.trim().length > 0) {
    return node.message.text.trim();
  }

  if (typeof node.message.content === 'string' && node.message.content.trim().length > 0) {
    return node.message.content.trim();
  }

  return localize('com_ui_generation_tree_node_empty');
}
