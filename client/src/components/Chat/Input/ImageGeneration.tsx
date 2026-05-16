import React, { memo } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

function ImageGeneration() {
  const localize = useLocalize();
  const { imageGeneration } = useBadgeRowContext();
  const { toggleState, debouncedChange, isPinned } = imageGeneration;

  const canGenerateImages = useHasAccess({
    permissionType: PermissionTypes.IMAGE_GEN,
    permission: Permissions.USE,
  });

  if (!canGenerateImages) {
    return null;
  }

  return (
    (toggleState || isPinned) && (
      <CheckboxButton
        className="max-w-fit"
        checked={toggleState}
        setValue={debouncedChange}
        label={localize('com_ui_image_generation') || 'Image'}
        isCheckedClassName="border-pink-600/40 bg-pink-500/10 hover:bg-pink-700/10"
        icon={<ImageIcon className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(ImageGeneration);
