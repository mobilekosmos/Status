import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Lozenge,
  Popup,
  Stack,
  Text,
  Tooltip,
} from '@forge/react';
import { invoke } from '@forge/bridge';

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

// @forge/bridge does not always reject with an Error instance (see the
// consent note in loadStatus below), so never assume `.message` exists.
// Its "Expected reject to be called with Error" diagnostic means nothing to
// readers, so the fallback text is shown instead.
const getErrorMessage = (error, fallback) => {
  const message = typeof error?.message === 'string' ? error.message : '';

  if (!message || message.includes('Expected reject to be called with Error')) {
    return fallback;
  }

  return message;
};

const App = () => {
  const [selectedStatusKey, setSelectedStatusKey] = useState('readyForAcceptanceTest');
  const [statusChangedAt, setStatusChangedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadStatus = async () => {
      try {
        // The resolver reads the page and macro IDs from the Forge context
        // itself, so there is nothing to send.
        const savedState = await invoke('getStatus');
        setSelectedStatusKey(savedState.status || 'readyForAcceptanceTest');
        setStatusChangedAt(savedState.statusChangedAt || null);
      } catch (loadError) {
        // Don't fall back to the default status here: readers would take it
        // for the saved one, and editors could overwrite a status they never
        // saw. The macro shows "STATUS UNAVAILABLE" instead.
        //
        // When the user has not yet clicked "Allow access" on the Forge
        // consent banner, the resolver promise rejects without a proper
        // Error instance; getErrorMessage hides the confusing diagnostic
        // @forge/bridge creates for that.
        setLoadFailed(true);
        setError(getErrorMessage(loadError, 'Could not load the status.'));
      } finally {
        setIsLoading(false);
      }
    };

    loadStatus();
  }, []);

  const onStatusChange = async (nextStatus) => {
    if (!nextStatus || nextStatus === selectedStatusKey || isSaving) {
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
      const updatedState = await invoke('setStatus', { status: nextStatus });

      setSelectedStatusKey(updatedState.status || nextStatus);
      setStatusChangedAt(updatedState.statusChangedAt || null);
    } catch (saveError) {
      setSelectedStatusKey(previousStatus);
      setStatusChangedAt(previousChangedAt);
      setError(getErrorMessage(saveError, 'Could not save the status.'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectedStatus = statuses[selectedStatusKey] || statuses.readyForAcceptanceTest;

  if (isLoading) {
    return (
      <Button appearance="subtle" spacing="none" isDisabled>
        <Lozenge appearance="new">LOADING STATUS...</Lozenge>
      </Button>
    );
  }

  if (loadFailed) {
    // Deliberately not a button: nothing can be changed until the saved
    // status is known. Reloading the page tries again.
    return (
      <Tooltip content={error} position="mouse">
        <Lozenge appearance="default" isBold>
          STATUS UNAVAILABLE
        </Lozenge>
      </Tooltip>
    );
  }

  // The lozenge itself is the control: clicking it opens a popup with one
  // button per status. We wrap the lozenge in a subtle Button so the trigger
  // is keyboard-accessible and gets the proper aria/role plumbing from
  // @forge/react Popup, while still looking like a plain badge.
  const triggerLabel = getTooltipContent(selectedStatus, statusChangedAt);
  const tooltipLabel = error ? `${triggerLabel} | ${error}` : triggerLabel;

  return (
    <>
      <Popup
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        placement="bottom-start"
        // Screen readers announce the popup by this name. The UI Kit docs
        // strongly recommend a label, and "dialog" for a popup like this one.
        label="Change status"
        role="dialog"
        trigger={(triggerProps) => (
          <Tooltip content={tooltipLabel} position="mouse">
            <Button
              {...triggerProps}
              appearance="subtle"
              spacing="none"
              isDisabled={isSaving}
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

      {isSaving && <Text>Saving...</Text>}
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);