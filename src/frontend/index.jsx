import React from 'react';
import ForgeReconciler, {
  Box,
  Lozenge,
  Text,
  Tooltip,
  useConfig,
} from '@forge/react';

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
  const config = useConfig();

  const selectedStatus =
    statuses[config?.status] || statuses.readyForAcceptanceTest;

  return (
    <Box>
      <Tooltip
        content={getTooltipContent(selectedStatus, config?.statusChangedAt)}
        position="mouse"
      >
        <Lozenge appearance={selectedStatus.appearance} isBold>
          {selectedStatus.label}
        </Lozenge>
      </Tooltip>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);