import AddedConvo from './AddedConvo';
import type { AddedConversationEntry } from '~/store/families';

export default function TextareaHeader({
  addedConvos,
  removeAddedConvo,
}: {
  addedConvos: AddedConversationEntry[];
  removeAddedConvo: (index: string | number) => void;
}) {
  if (addedConvos.length === 0) {
    return null;
  }
  return (
    <div className="m-1.5 flex flex-col divide-y overflow-hidden rounded-b-lg rounded-t-2xl bg-surface-secondary-alt">
      {addedConvos.map((entry) => (
        <AddedConvo
          key={entry.index}
          addedConvo={entry.conversation}
          onRemove={() => removeAddedConvo(entry.index)}
        />
      ))}
    </div>
  );
}
