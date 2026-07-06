import React from 'react';
import useLocalize from '~/hooks/useLocalize';
import type { PositionedTreeNode } from './types';

type ConversationTreeInspectorProps = {
  sourceNode: PositionedTreeNode | null;
  destinationNode: PositionedTreeNode | null;
  previewRequested: boolean;
  statusText: string;
  listOpen: boolean;
  onToggleList: () => void;
  listContent: React.ReactNode;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-medium bg-surface-secondary px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className="mt-1 text-sm text-text-primary">{value}</div>
    </div>
  );
}

export default function ConversationTreeInspector({
  sourceNode,
  destinationNode,
  previewRequested,
  statusText,
  listOpen,
  onToggleList,
  listContent,
}: ConversationTreeInspectorProps) {
  const localize = useLocalize();

  return (
    <div data-testid="generation-tree-inspector" className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_sidepanel_conversation_tree')}
          </h3>
          <p className="text-xs text-text-secondary">{statusText}</p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-secondary"
          onClick={onToggleList}
        >
          {localize('com_ui_generation_tree_list')}
        </button>
      </div>

      <SummaryRow
        label={localize('com_ui_generation_tree_source')}
        value={sourceNode?.message.text?.toString() ?? localize('com_ui_none')}
      />
      <SummaryRow
        label={localize('com_ui_generation_tree_destination')}
        value={destinationNode?.message.text?.toString() ?? localize('com_ui_none')}
      />

      <div className="rounded-xl border border-dashed border-border-medium bg-surface-secondary px-3 py-3 text-sm text-text-secondary">
        {previewRequested
          ? localize('com_ui_generation_tree_status_preview')
          : localize('com_ui_generation_tree_preview_pending')}
      </div>

      {listOpen ? <div className="min-h-0 flex-1 overflow-auto">{listContent}</div> : null}
    </div>
  );
}
