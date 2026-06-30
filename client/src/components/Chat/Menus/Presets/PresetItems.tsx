import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { Close } from '@radix-ui/react-popover';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Flipper, Flipped } from 'react-flip-toolkit';
import { useDrag, useDrop } from 'react-dnd';
import { getEndpointField } from 'librechat-data-provider';
import {
  Dialog,
  Label,
  PinIcon,
  EditIcon,
  TrashIcon,
  DialogTrigger,
  TooltipAnchor,
  DialogTemplate,
} from '@librechat/client';
import type { TPreset } from 'librechat-data-provider';
import type { FC, ReactNode } from 'react';
import FileUpload from '~/components/Chat/Input/Files/FileUpload';
import { useGetEndpointsQuery } from '~/data-provider';
import { getPresetTitle, getIconKey } from '~/utils';
import { MenuSeparator, MenuItem } from '../UI';
import { icons } from '~/hooks/Endpoint/Icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

interface DraggablePresetItemProps {
  id: string;
  index: number;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  onDrop: () => void;
  children: ReactNode;
}

const DraggablePresetItem = ({
  id,
  index,
  moveItem,
  onDrop,
  children,
}: DraggablePresetItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [{ handlerId }, drop] = useDrop<{ index: number; id: string }, unknown, { handlerId: any }>(
    {
      accept: 'preset-item',
      collect(monitor) {
        return {
          handlerId: monitor.getHandlerId(),
        };
      },
      hover(item, monitor) {
        if (!ref.current) {
          return;
        }

        const dragIndex = item.index;
        const hoverIndex = index;
        if (dragIndex === hoverIndex) {
          return;
        }

        const hoverBoundingRect = ref.current.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) {
          return;
        }

        const hoverClientY = clientOffset.y - hoverBoundingRect.top;
        if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
          return;
        }
        if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
          return;
        }

        moveItem(dragIndex, hoverIndex);
        item.index = hoverIndex;
      },
    },
  );

  const [{ isDragging }, drag] = useDrag({
    type: 'preset-item',
    item: () => ({ id, index }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDrop();
    },
  });

  drag(drop(ref));

  return (
    <div ref={ref} style={{ opacity: isDragging ? 0.4 : 1 }} data-handler-id={handlerId}>
      {children}
    </div>
  );
};

const PresetItems: FC<{
  presets?: Array<TPreset | undefined>;
  onSetDefaultPreset: (preset: TPreset, remove?: boolean) => void;
  onSelectPreset: (preset: TPreset) => void;
  onChangePreset: (preset: TPreset) => void;
  onDeletePreset: (preset: TPreset) => void;
  onReorderPresets: (presets: TPreset[], persist?: boolean) => void;
  clearAllPresets: () => void;
  onFileSelected: (jsonData: Record<string, unknown>) => void;
}> = ({
  presets,
  onSetDefaultPreset,
  onSelectPreset,
  onChangePreset,
  onDeletePreset,
  onReorderPresets,
  clearAllPresets,
  onFileSelected,
}) => {
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const defaultPreset = useRecoilValue(store.defaultPreset);
  const localize = useLocalize();
  const safePresets = useMemo(
    () => (presets ?? []).filter((preset): preset is TPreset => Boolean(preset?.presetId)),
    [presets],
  );
  const draggedPresetsRef = useRef<TPreset[]>(safePresets);

  useEffect(() => {
    draggedPresetsRef.current = safePresets;
  }, [safePresets]);

  const commitOrder = useCallback(
    (nextPresets: TPreset[], persist = false) => {
      draggedPresetsRef.current = nextPresets;
      onReorderPresets(nextPresets, persist);
    },
    [onReorderPresets],
  );

  const movePreset = useCallback(
    (dragIndex: number, hoverIndex: number, persist = false) => {
      if (
        dragIndex === hoverIndex ||
        hoverIndex < 0 ||
        hoverIndex >= draggedPresetsRef.current.length
      ) {
        return;
      }

      const nextPresets = [...draggedPresetsRef.current];
      const [draggedPreset] = nextPresets.splice(dragIndex, 1);
      if (!draggedPreset) {
        return;
      }

      nextPresets.splice(hoverIndex, 0, draggedPreset);
      commitOrder(nextPresets, persist);
    },
    [commitOrder],
  );

  const handleDrop = useCallback(() => {
    onReorderPresets(draggedPresetsRef.current, true);
  }, [onReorderPresets]);

  return (
    <>
      <div
        role="menuitem"
        className="pointer-none group m-1.5 flex h-8 min-w-[170px] gap-2 rounded px-5 py-2.5 !pr-3 text-sm !opacity-100 focus:ring-0 radix-disabled:pointer-events-none radix-disabled:opacity-50 md:min-w-[240px]"
        tabIndex={-1}
      >
        <div className="flex h-full grow items-center justify-end gap-2">
          <label
            htmlFor="default-preset"
            className="w-40 truncate rounded bg-transparent py-1 text-xs font-medium text-gray-600 transition-colors dark:bg-transparent dark:text-gray-300 sm:w-72"
          >
            {defaultPreset
              ? `${localize('com_endpoint_preset_default_item')} ${defaultPreset.title}`
              : localize('com_endpoint_preset_default_none')}
          </label>
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="mr-1 flex h-[32px] cursor-pointer items-center rounded bg-transparent px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-red-700 focus:ring-ring dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-red-700"
                aria-label={localize('com_ui_clear_all')}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mr-1 flex w-[22px] items-center"
                  aria-hidden="true"
                >
                  <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1M6.854 7.146 8 8.293l1.146-1.147a.5.5 0 1 1 .708.708L8.707 9l1.147 1.146a.5.5 0 0 1-.708.708L8 9.707l-1.146 1.147a.5.5 0 0 1-.708-.708L7.293 9 6.146 7.854a.5.5 0 1 1 .708-.708"></path>
                </svg>
                {localize('com_ui_clear_all')}
              </button>
            </DialogTrigger>
            <DialogTemplate
              showCloseButton={false}
              title={localize('com_ui_clear_presets')}
              className="max-w-[450px]"
              main={
                <>
                  <div className="flex w-full flex-col items-center gap-2">
                    <div className="grid w-full items-center gap-2">
                      <Label
                        htmlFor="preset-item-clear-all"
                        className="text-left text-sm font-medium"
                      >
                        {localize('com_endpoint_presets_clear_warning')}
                      </Label>
                    </div>
                  </div>
                </>
              }
              selection={{
                selectHandler: clearAllPresets,
                selectClasses: 'bg-red-600 hover:bg-red-700 dark:hover:bg-red-600 text-white',
                selectText: localize('com_ui_clear'),
              }}
            />
            <FileUpload onFileSelected={onFileSelected} />
          </Dialog>
        </div>
      </div>
      {presets && safePresets.length === 0 && (
        <div
          role="menuitem"
          className="pointer-none group m-1.5 flex h-8 min-w-[170px] gap-2 rounded px-5 py-2.5 !pr-3 text-sm !opacity-100 focus:ring-0 radix-disabled:pointer-events-none radix-disabled:opacity-50 md:min-w-[240px]"
          tabIndex={-1}
        >
          <div className="flex h-full grow items-center justify-end gap-2 text-gray-600 dark:text-gray-300">
            {/* TODO: Create Preset from here */}
            {localize('com_endpoint_no_presets')}
          </div>
        </div>
      )}
      <Flipper flipKey={safePresets.map((preset) => preset.presetId).join('.')}>
        {safePresets.length > 0 &&
          safePresets.map((preset, i) => {
            const presetId = preset.presetId ?? '';

            const iconKey = getIconKey({ endpoint: preset.endpoint, endpointsConfig });
            const Icon = icons[iconKey];

            return (
              <DraggablePresetItem
                key={`preset-${presetId}`}
                id={presetId}
                index={i}
                moveItem={movePreset}
                onDrop={handleDrop}
              >
                <Close asChild>
                  <div>
                    <Flipped flipId={presetId}>
                      <MenuItem
                        key={`preset-item-${presetId}`}
                        textClassName="text-xs max-w-[150px] sm:max-w-[200px] truncate md:max-w-full "
                        title={getPresetTitle(preset)}
                        onClick={() => onSelectPreset(preset)}
                        icon={
                          Icon != null && (
                            <Icon
                              context="menu-item"
                              iconURL={getEndpointField(
                                endpointsConfig,
                                preset.endpoint,
                                'iconURL',
                              )}
                              className="icon-md mr-1 dark:text-white"
                              endpoint={preset.endpoint}
                            />
                          )
                        }
                        selected={false}
                        data-testid={`preset-item-${presetId}`}
                      >
                        <div className="flex h-full items-center justify-end gap-1">
                          <GripVertical
                            aria-hidden="true"
                            className="size-4 shrink-0 text-gray-400 sm:invisible sm:group-focus-within:visible sm:group-hover:visible"
                          />
                          <TooltipAnchor
                            description={localize('com_ui_move_up')}
                            aria-label={localize('com_ui_move_up')}
                            render={
                              <button
                                type="button"
                                disabled={i === 0}
                                className="m-0 h-full rounded-md bg-transparent p-2 text-gray-400 hover:text-gray-700 focus:text-gray-700 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:text-gray-200 dark:focus:text-gray-200 sm:invisible sm:group-focus-within:visible sm:group-hover:visible"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  movePreset(i, i - 1, true);
                                }}
                              >
                                <ChevronUp className="size-4" />
                              </button>
                            }
                          />
                          <TooltipAnchor
                            description={localize('com_ui_move_down')}
                            aria-label={localize('com_ui_move_down')}
                            render={
                              <button
                                type="button"
                                disabled={i === safePresets.length - 1}
                                className="m-0 h-full rounded-md bg-transparent p-2 text-gray-400 hover:text-gray-700 focus:text-gray-700 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:text-gray-200 dark:focus:text-gray-200 sm:invisible sm:group-focus-within:visible sm:group-hover:visible"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  movePreset(i, i + 1, true);
                                }}
                              >
                                <ChevronDown className="size-4" />
                              </button>
                            }
                          />
                          <TooltipAnchor
                            description={
                              defaultPreset?.presetId === presetId
                                ? localize('com_ui_unpin')
                                : localize('com_ui_pin')
                            }
                            aria-label={
                              defaultPreset?.presetId === presetId
                                ? localize('com_ui_unpin')
                                : localize('com_ui_pin')
                            }
                            render={
                              <button
                                className={cn(
                                  'm-0 h-full rounded-md bg-transparent p-2 text-gray-400 hover:text-gray-700 focus:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:focus:text-gray-200',
                                  defaultPreset?.presetId === presetId
                                    ? ''
                                    : 'sm:invisible sm:group-focus-within:visible sm:group-hover:visible',
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onSetDefaultPreset(preset, defaultPreset?.presetId === presetId);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSetDefaultPreset(
                                      preset,
                                      defaultPreset?.presetId === presetId,
                                    );
                                  }
                                }}
                              >
                                <PinIcon unpin={defaultPreset?.presetId === presetId} />
                              </button>
                            }
                          />
                          <TooltipAnchor
                            description={localize('com_ui_edit')}
                            aria-label={localize('com_ui_edit')}
                            render={
                              <button
                                className="m-0 h-full rounded-md p-2 text-gray-400 hover:text-gray-700 focus:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:focus:text-gray-200 sm:invisible sm:group-focus-within:visible sm:group-hover:visible"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onChangePreset(preset);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onChangePreset(preset);
                                  }
                                }}
                              >
                                <EditIcon />
                              </button>
                            }
                          />
                          <TooltipAnchor
                            description={localize('com_ui_delete')}
                            aria-label={localize('com_ui_delete')}
                            render={
                              <button
                                className="m-0 h-full rounded-md p-2 text-gray-400 hover:text-gray-600 focus:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200 dark:focus:text-gray-200 sm:invisible sm:group-focus-within:visible sm:group-hover:visible"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onDeletePreset(preset);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onDeletePreset(preset);
                                  }
                                }}
                              >
                                <TrashIcon />
                              </button>
                            }
                          />
                        </div>
                      </MenuItem>
                    </Flipped>
                    {i !== safePresets.length - 1 && <MenuSeparator />}
                  </div>
                </Close>
              </DraggablePresetItem>
            );
          })}
      </Flipper>
    </>
  );
};

export default PresetItems;
