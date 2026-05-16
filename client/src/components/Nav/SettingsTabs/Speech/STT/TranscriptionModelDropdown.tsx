/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { useRecoilState } from 'recoil';
import { Dropdown } from '@librechat/client';
import store from '~/store';
import { transcriptionModelOptions } from './transcriptionModels';

const TranscriptionModelDropdown: React.FC = () => {
  const [transcriptionModel, setTranscriptionModel] = useRecoilState<string>(
    store.transcriptionModel,
  );

  const labelId = 'transcription-model-dropdown-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>Transcription Model</div>
      <Dropdown
        value={transcriptionModel}
        onChange={setTranscriptionModel}
        options={transcriptionModelOptions}
        sizeClasses="w-[220px]"
        testId="TranscriptionModelDropdown"
        className="z-50"
        aria-labelledby={labelId}
      />
    </div>
  );
};

export default TranscriptionModelDropdown;
