import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  Label,
  Select,
  Stack,
  Text,
} from '@forge/react';
import { view } from '@forge/bridge';

const statusOptions = [
  {
    label: 'READY FOR ACCEPTANCE TEST',
    value: 'readyForAcceptanceTest',
  },
  {
    label: 'IN ACCEPTANCE TEST',
    value: 'inAcceptanceTest',
  },
  {
    label: 'NOT ACCEPTED',
    value: 'notAccepted',
  },
  {
    label: 'ACCEPTED FOR RELEASE',
    value: 'acceptedForRelease',
  },
];

const defaultStatus = 'readyForAcceptanceTest';

const Config = () => {
  const [initialStatus, setInitialStatus] = useState(defaultStatus);
  const [initialStatusChangedAt, setInitialStatusChangedAt] = useState(null);
  const [selectedOption, setSelectedOption] = useState(statusOptions[0]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    view.getContext().then((context) => {
      const config = context.extension?.config || {};

      const status = config.status || defaultStatus;
      const option =
        statusOptions.find((item) => item.value === status) || statusOptions[0];

      setInitialStatus(status);
      setInitialStatusChangedAt(config.statusChangedAt || null);
      setSelectedOption(option);
      setIsLoading(false);
    });
  }, []);

  const submit = async () => {
    const statusChanged =
      selectedOption.value !== initialStatus || !initialStatusChangedAt;

    const statusChangedAt = statusChanged
      ? new Date().toISOString()
      : initialStatusChangedAt;

    await view.submit({
      config: {
        status: selectedOption.value,
        statusChangedAt,
      },
    });
  };

  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <Stack space="space.200">
      <Label labelFor="status">Status</Label>

      <Select
        inputId="status"
        name="status"
        options={statusOptions}
        value={selectedOption}
        onChange={setSelectedOption}
        isRequired
      />

      <Button appearance="primary" onClick={submit}>
        Save
      </Button>

      <Button appearance="subtle" onClick={() => view.close()}>
        Cancel
      </Button>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Config />
  </React.StrictMode>
);