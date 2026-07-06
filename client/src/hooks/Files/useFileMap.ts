import { useGetFiles } from '~/data-provider';
import { mapFiles } from '~/utils';

const EMPTY_FILE_MAP = Object.freeze({}) as ReturnType<typeof mapFiles>;

export default function useFileMap({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { data: fileMap } = useGetFiles({
    select: mapFiles,
    enabled: isAuthenticated,
  });

  return fileMap ?? EMPTY_FILE_MAP;
}
