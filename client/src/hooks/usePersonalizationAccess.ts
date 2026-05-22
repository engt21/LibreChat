import { PermissionTypes, Permissions } from 'librechat-data-provider';
import useHasAccess from './Roles/useHasAccess';
import { useGetStartupConfig } from '~/data-provider';

export default function usePersonalizationAccess() {
  const { data: startupConfig } = useGetStartupConfig();
  const hasMemoryOptOut = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.OPT_OUT,
  });
  const hasModelSteering = startupConfig?.modelSteeringEnabled === true;

  const hasAnyPersonalizationFeature = hasMemoryOptOut || hasModelSteering;

  return {
    hasMemoryOptOut,
    hasModelSteering,
    hasAnyPersonalizationFeature,
  };
}
