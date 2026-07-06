import React, { memo } from 'react';
import { Telescope } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useBadgeRowContext } from '~/Providers';
import { useHasAccess, useLocalize } from '~/hooks';

function DeepResearch() {
  const localize = useLocalize();
  const { deepResearch, supportsDeepResearch } = useBadgeRowContext();
  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });

  if (!supportsDeepResearch || !canUseWebSearch || !canRunCode) {
    return null;
  }

  const enabled = deepResearch.toggleState === true;
  return (
    (enabled || deepResearch.isPinned) && (
      <CheckboxButton
        className="max-w-fit"
        checked={enabled}
        setValue={deepResearch.debouncedChange}
        label={localize('com_ui_deep_research')}
        isCheckedClassName="border-cyan-600/40 bg-cyan-500/10 hover:bg-cyan-700/10"
        icon={<Telescope className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(DeepResearch);
