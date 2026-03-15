const TALKING_TO_LABEL = 'Talking to';
const ACTIVE_MODEL_LABEL = '[latest] Tailwind CSS GPT';

export default function ActiveSetting() {
  return (
    <div className="text-token-text-tertiary space-x-2 overflow-hidden text-ellipsis text-sm font-light">
      {TALKING_TO_LABEL}{' '}
      <span className="text-token-text-secondary font-medium">{ACTIVE_MODEL_LABEL}</span>
    </div>
  );
}
