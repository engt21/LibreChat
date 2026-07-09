import {
  ArrowLeft,
  Check,
  GitBranch,
  GitMerge,
  Keyboard,
  MousePointerClick,
  Undo2,
} from 'lucide-react';
import useLocalize from '~/hooks/useLocalize';

type ConversationTreeHelpProps = {
  onClose: () => void;
  onStartGuided: () => void;
};

function HelpStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3">
      <div className="flex size-7 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-text-primary">
        {number}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
    </li>
  );
}

function ExampleBranch({
  label,
  children,
  emphasized = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? 'border-l-4 border-blue-500 bg-blue-500/10 px-3 py-2'
          : 'border-l-4 border-border-medium bg-surface-secondary px-3 py-2'
      }
    >
      <div className="text-xs font-semibold uppercase text-text-secondary">{label}</div>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

export default function ConversationTreeHelp({
  onClose,
  onStartGuided,
}: ConversationTreeHelpProps) {
  const localize = useLocalize();

  return (
    <div
      data-testid="generation-tree-help"
      className="absolute inset-0 z-40 flex min-h-0 flex-col bg-surface-primary text-text-primary"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border-light px-3 py-3 sm:px-5">
        <button
          type="button"
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          aria-label={localize('com_ui_back')}
          onClick={onClose}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">
            {localize('com_ui_generation_tree_help_title')}
          </h2>
          <p className="truncate text-sm text-text-secondary">
            {localize('com_ui_generation_tree_help_intro')}
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
          <section aria-labelledby="generation-tree-help-steps">
            <div className="flex items-center gap-2">
              <MousePointerClick className="size-5 text-text-secondary" aria-hidden="true" />
              <h2
                id="generation-tree-help-steps"
                className="text-lg font-semibold text-text-primary"
              >
                {localize('com_ui_generation_tree_help_quick_title')}
              </h2>
            </div>
            <ol className="mt-2 divide-y divide-border-light">
              <HelpStep
                number={1}
                title={localize('com_ui_generation_tree_help_source_title')}
                description={localize('com_ui_generation_tree_help_source_desc')}
              />
              <HelpStep
                number={2}
                title={localize('com_ui_generation_tree_help_destination_title')}
                description={localize('com_ui_generation_tree_help_destination_desc')}
              />
              <HelpStep
                number={3}
                title={localize('com_ui_generation_tree_help_scope_title')}
                description={localize('com_ui_generation_tree_help_scope_desc')}
              />
              <HelpStep
                number={4}
                title={localize('com_ui_generation_tree_help_review_title')}
                description={localize('com_ui_generation_tree_help_review_desc')}
              />
            </ol>
          </section>

          <section
            aria-labelledby="generation-tree-help-example"
            className="mt-7 border-t border-border-light pt-6"
          >
            <div className="flex items-center gap-2">
              <GitBranch className="size-5 text-text-secondary" aria-hidden="true" />
              <h2
                id="generation-tree-help-example"
                className="text-lg font-semibold text-text-primary"
              >
                {localize('com_ui_generation_tree_help_example_title')}
              </h2>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ExampleBranch label={localize('com_ui_generation_tree_help_branch_copy')}>
                {localize('com_ui_generation_tree_help_branch_copy_desc')}
              </ExampleBranch>
              <ExampleBranch label={localize('com_ui_generation_tree_help_branch_keep')} emphasized>
                {localize('com_ui_generation_tree_help_branch_keep_desc')}
              </ExampleBranch>
            </div>
            <div className="mt-3 flex items-start gap-2 border-l-4 border-green-600 bg-green-500/10 px-3 py-2 text-sm text-text-primary">
              <Check className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden="true" />
              <span>{localize('com_ui_generation_tree_help_result')}</span>
            </div>
          </section>

          <section
            aria-labelledby="generation-tree-help-advanced"
            className="mt-7 border-t border-border-light pt-6"
          >
            <h2
              id="generation-tree-help-advanced"
              className="text-lg font-semibold text-text-primary"
            >
              {localize('com_ui_generation_tree_help_advanced_title')}
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <GitMerge
                  className="mt-0.5 size-4 shrink-0 text-text-secondary"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {localize('com_ui_generation_tree_help_drag_title')}
                  </h3>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {localize('com_ui_generation_tree_help_drag_desc')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Keyboard
                  className="mt-0.5 size-4 shrink-0 text-text-secondary"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {localize('com_ui_generation_tree_help_keyboard_title')}
                  </h3>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {localize('com_ui_generation_tree_help_keyboard_desc')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Undo2 className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {localize('com_ui_generation_tree_help_undo_title')}
                  </h3>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {localize('com_ui_generation_tree_help_undo_desc')}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border-light bg-surface-primary px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl justify-end">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-surface-submit px-4 py-2 text-sm font-medium text-white hover:bg-surface-submit-hover sm:w-auto"
            onClick={onStartGuided}
          >
            <GitMerge className="size-4" aria-hidden="true" />
            {localize('com_ui_generation_tree_help_start')}
          </button>
        </div>
      </footer>
    </div>
  );
}
