import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ErrorMessage,
  Lozenge,
  Popup,
  Stack,
  Spinner,
  Text,
  Tooltip,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const statuses = {
  readyForAcceptanceTest: {
    label: 'READY FOR ACCEPTANCE TEST',
    appearance: 'inprogress',
  },
  inAcceptanceTest: {
    label: 'IN ACCEPTANCE TEST',
    appearance: 'moved',
  },
  notAccepted: {
    label: 'NOT ACCEPTED',
    appearance: 'removed',
  },
  acceptedForRelease: {
    label: 'ACCEPTED FOR RELEASE',
    appearance: 'success',
  },
};

const statusEntries = Object.entries(statuses).map(([value, details]) => ({
  value,
  ...details,
}));

const formatDate = (isoDate) => {
  if (!isoDate) return 'unknown date';

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(isoDate));
};

const getDaysInState = (isoDate) => {
  if (!isoDate) return null;

  const changedAt = Date.parse(isoDate);

  if (Number.isNaN(changedAt)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - changedAt) / MS_PER_DAY));
};

const getTooltipContent = (status, changedAt) => {
  const daysInState = getDaysInState(changedAt);

  if (daysInState === null) {
    return `${status.label} — no timestamp saved yet`;
  }

  const dayText = daysInState === 1 ? 'day' : 'days';

  return `${status.label} since ${formatDate(changedAt)} — ${daysInState} ${dayText} in this state`;
};

const App = () => {
  const [contentId, setContentId] = useState(null);
  const [localId, setLocalId] = useState(null);
  const [selectedStatusKey, setSelectedStatusKey] = useState('readyForAcceptanceTest');
  const [statusChangedAt, setStatusChangedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const context = await view.getContext();
        const pageId =
          context?.extension?.content?.id ||
          context?.content?.id ||
          context?.extension?.context?.contentId;
        const macroLocalId = context?.localId;

        if (!pageId) {
          throw new Error('Unable to resolve Confluence page ID from macro context.');
        }

        if (!macroLocalId) {
          throw new Error('Unable to resolve macro instance ID from Forge context.');
        }

        setContentId(pageId);
        setLocalId(macroLocalId);

        const savedState = await invoke('getStatus', {
          contentId: pageId,
          localId: macroLocalId,
        });
        setSelectedStatusKey(savedState.status || 'readyForAcceptanceTest');
        setStatusChangedAt(savedState.statusChangedAt || null);
      } catch (loadError) {
        // When the user has not yet clicked "Allow access" on the Forge
        // consent banner, the resolver promise rejects without a proper
        // Error instance. @forge/bridge surfaces that as a confusing
        // "Expected reject to be called with Error" diagnostic. We swallow
        // those pre-consent rejections so only real failures are shown.
        const message =
          loadError && typeof loadError.message === 'string' ? loadError.message : '';
        if (message && !message.includes('Expected reject to be called with Error')) {
          setError(message);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadStatus();
  }, []);

  const onStatusChange = async (nextStatus) => {
    if (!nextStatus || !contentId || !localId || nextStatus === selectedStatusKey || isSaving) {
      setIsOpen(false);
      return;
    }

    const previousStatus = selectedStatusKey;
    const previousChangedAt = statusChangedAt;

    setError('');
    setSelectedStatusKey(nextStatus);
    setIsSaving(true);
    // Close the popup as soon as a choice is made — the lozenge updates
    // optimistically while the resolver request completes in the background.
    setIsOpen(false);

    try {
      const updatedState = await invoke('setStatus', {
        contentId,
        localId,
        status: nextStatus,
      });

      setSelectedStatusKey(updatedState.status || nextStatus);
      setStatusChangedAt(updatedState.statusChangedAt || null);
    } catch (saveError) {
      setSelectedStatusKey(previousStatus);
      setStatusChangedAt(previousChangedAt);
      setError(saveError.message || 'Failed to save status.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedStatus = statuses[selectedStatusKey] || statuses.readyForAcceptanceTest;

  if (isLoading) {
    return (
      <Stack space="space.100">
        <Spinner size="small" />
        <Text>Loading status...</Text>
      </Stack>
    );
  }

  // The lozenge itself is the control: clicking it opens a popup containing
  // the status Select. We wrap the lozenge in a subtle Button so the trigger
  // is keyboard-accessible and gets the proper aria/role plumbing from
  // @forge/react Popup, while still looking like a plain badge.
  const triggerLabel = getTooltipContent(selectedStatus, statusChangedAt);

  return (
    <Stack space="space.100">
      <Popup
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        placement="bottom-start"
        trigger={(triggerProps) => (
          <Tooltip content={triggerLabel} position="mouse">
            <Button
              {...triggerProps}
              appearance="subtle"
              spacing="none"
              isDisabled={isSaving || !contentId || !localId}
              onClick={() => setIsOpen((open) => !open)}
              aria-label={`Status: ${selectedStatus.label}. Click to change.`}
            >
              <Lozenge appearance={selectedStatus.appearance} isBold>
                {selectedStatus.label}
              </Lozenge>
            </Button>
          </Tooltip>
        )}
        content={() => (
          // The popup body is just a vertical stack of lozenge buttons. One
          // click on any of them commits the new status and closes the popup,
          // so changing state takes a single click after opening — no extra
          // dropdown/confirmation step.
          <Box xcss={{ padding: 'space.100' }}>
            <Stack space="space.050">
              {statusEntries.map((entry) => (
                <Button
                  key={entry.value}
                  appearance="subtle"
                  spacing="compact"
                  isDisabled={isSaving}
                  onClick={() => onStatusChange(entry.value)}
                >
                  <Lozenge appearance={entry.appearance} isBold>
                    {entry.label}
                  </Lozenge>
                </Button>
              ))}
            </Stack>
          </Box>
        )}
      />

      {isSaving && <Text>Saving status...</Text>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);