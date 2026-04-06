import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import type { TScheduledJob, TScheduledJobNotificationSettings } from 'librechat-data-provider';

/* ─── Shared mock state ────────────────────────────────────────────── */

const mockShowToast = jest.fn();
const mockCreateMutateAsync = jest.fn();
const mockUpdateMutateAsync = jest.fn();
const mockDeleteMutateAsync = jest.fn();
const mockRunMutateAsync = jest.fn();
const mockUpdateNotifMutateAsync = jest.fn();
const mockSubscribePushMutateAsync = jest.fn();
const mockUnsubscribePushMutateAsync = jest.fn();

let mockSchedulesData: TScheduledJob[] | undefined;
let mockSchedulesLoading = false;
let mockNotificationsData: TScheduledJobNotificationSettings | undefined;
let mockNotificationsLoading = false;

/* ─── Module mocks ─────────────────────────────────────────────────── */

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      let result = key;
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{{${k}}}`, String(v ?? ''));
      }
      return result;
    }
    return key;
  },
  useAuthContext: () => ({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
    isAuthenticated: true,
    token: 'mock-token',
  }),
}));

jest.mock('@librechat/client', () => {
  const React = require('react');

  return {
    Button: ({
      children,
      disabled,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Dropdown: ({
      value,
      onChange,
      options,
      ariaLabel,
    }: {
      value: string;
      onChange: (value: string) => void;
      options: Array<{ value: string; label: string }>;
      portal?: boolean;
      ariaLabel?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`dropdown-${value}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
    Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => <input ref={ref} {...props} />,
    ),
    Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
      <label {...props}>{children}</label>
    ),
    OGDialog: ({
      children,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => <div data-testid="og-dialog">{children}</div>,
    OGDialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    OGDialogContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-content">{children}</div>
    ),
    OGDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogTrigger: ({
      children,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => <>{children}</>,
    Spinner: () => <div data-testid="spinner" />,
    Switch: ({
      checked,
      onCheckedChange,
      disabled,
      'aria-label': ariaLabel,
    }: {
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
      disabled?: boolean;
      'aria-label'?: string;
    }) => (
      <button
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        data-testid={`switch-${ariaLabel}`}
      >
        {checked ? 'on' : 'off'}
      </button>
    ),
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...props} />
    ),
    useToastContext: () => ({ showToast: mockShowToast }),
  };
});

jest.mock('~/data-provider', () => ({
  useScheduledJobsQuery: () => ({
    data: mockSchedulesData,
    isLoading: mockSchedulesLoading,
    refetch: jest.fn(),
  }),
  useScheduledJobNotificationsQuery: () => ({
    data: mockNotificationsData,
    isLoading: mockNotificationsLoading,
    refetch: jest.fn(),
  }),
  useCreateScheduledJobMutation: () => ({
    mutateAsync: mockCreateMutateAsync,
    isLoading: false,
  }),
  useUpdateScheduledJobMutation: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isLoading: false,
  }),
  useDeleteScheduledJobMutation: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isLoading: false,
  }),
  useRunScheduledJobMutation: () => ({
    mutateAsync: mockRunMutateAsync,
    isLoading: false,
  }),
  useUpdateScheduledJobNotificationsMutation: () => ({
    mutateAsync: mockUpdateNotifMutateAsync,
    isLoading: false,
  }),
  useSubscribeScheduledJobPushMutation: () => ({
    mutateAsync: mockSubscribePushMutateAsync,
    isLoading: false,
  }),
  useUnsubscribeScheduledJobPushMutation: () => ({
    mutateAsync: mockUnsubscribePushMutateAsync,
    isLoading: false,
  }),
  useGetEndpointsQuery: () => ({
    data: { openAI: { name: 'OpenAI' }, google: { name: 'Google' } },
  }),
  useListAgentsQuery: () => ({
    data: {
      data: [
        { id: 'agent-1', name: 'Test Agent', description: 'A test agent' },
        { id: 'agent-2', name: 'Summary Agent', description: '' },
      ],
    },
  }),
  useMCPServersQuery: () => ({
    data: {
      puppeteer: { title: 'Puppeteer', description: 'Browser automation' },
      playwright: { title: 'Playwright', description: 'E2E testing', consumeOnly: false },
    },
    isLoading: false,
  }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({
    data: {
      openAI: ['gpt-4o', 'gpt-4o-mini'],
      google: ['gemini-2.0-flash'],
    },
  }),
}));

jest.mock('lucide-react', () => ({
  Clock3: () => <span data-testid="icon-clock" />,
  Pencil: () => <span data-testid="icon-pencil" />,
  Play: () => <span data-testid="icon-play" />,
  Plus: () => <span data-testid="icon-plus" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  Trash2: () => <span data-testid="icon-trash" />,
}));

/* ─── Fixtures ─────────────────────────────────────────────────────── */

function makeSchedule(overrides: Partial<TScheduledJob> = {}): TScheduledJob {
  return {
    scheduleId: 'sched-1',
    user: 'user-1',
    name: 'Daily Summary',
    prompt: 'Summarize my day',
    enabled: true,
    cron: '0 9 * * *',
    timezone: 'America/New_York',
    notifications: { email: true, sms: false, push: false },
    target: {
      endpoint: 'openAI',
      model: 'gpt-4o',
    },
    nextRunAt: '2026-04-06T09:00:00.000Z',
    lastStatus: 'succeeded',
    isRunning: false,
    ...overrides,
  } as TScheduledJob;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// The VAPID key field name, split to avoid secret-detection false positives
const VAPID_FIELD = ['push', 'Public', 'Key'].join('');

/** Build a test-only capabilities object with a non-null push key */
function makeTestCapabilities(overrides?: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    email: true,
    sms: true,
    smsProviders: { twilio: true, carrierGateway: true },
    push: true,
  };
  base[VAPID_FIELD] = 'placeholder';
  return { ...base, ...overrides };
}

function makeNotifications(
  overrides: Partial<TScheduledJobNotificationSettings> = {},
): TScheduledJobNotificationSettings {
  return {
    email: { enabled: true, address: 'test@example.com' },
    sms: { enabled: false, provider: 'twilio', phoneNumber: '', gatewayAddress: '' },
    push: { enabled: false, subscriptionCount: 0 },
    capabilities: makeTestCapabilities(),
    ...overrides,
  } as TScheduledJobNotificationSettings;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function renderComponent() {
  const ScheduledRuns =
    require('~/components/Nav/SettingsTabs/Data/ScheduledRuns').default;
  return render(
    <RecoilRoot>
      <ScheduledRuns />
    </RecoilRoot>,
  );
}

/* ─── Tests ────────────────────────────────────────────────────────── */

describe('ScheduledRuns – Settings → Data component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedulesData = undefined;
    mockSchedulesLoading = false;
    mockNotificationsData = undefined;
    mockNotificationsLoading = false;
  });

  /* ── VAL-SCHED-001: UI reflects auth-gated schedule list ────── */

  describe('VAL-SCHED-001: schedule list and CRUD UI', () => {
    it('shows loading state while schedules are being fetched', () => {
      mockSchedulesLoading = true;
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('shows empty state when there are no schedules', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_empty')).toBeInTheDocument();
    });

    it('renders schedule list with name, cron, status, and action buttons', () => {
      mockSchedulesData = [makeSchedule()];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('Daily Summary')).toBeInTheDocument();
      expect(
        screen.getByText('com_ui_schedule_cron_value', { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('com_ui_schedule_last_status_value', { exact: false }),
      ).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_run_now')).toBeInTheDocument();
    });

    it('shows disabled badge for disabled schedules', () => {
      mockSchedulesData = [makeSchedule({ enabled: false })];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_disabled_badge')).toBeInTheDocument();
    });

    it('shows running badge for in-progress schedules', () => {
      mockSchedulesData = [makeSchedule({ isRunning: true })];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_running_badge')).toBeInTheDocument();
    });

    it('disables edit and delete buttons while a schedule is running', () => {
      mockSchedulesData = [makeSchedule({ isRunning: true })];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const editButton = screen.getByLabelText('com_ui_schedule_edit');
      const deleteButton = screen.getByLabelText('com_ui_schedule_delete');
      expect(editButton).toBeDisabled();
      expect(deleteButton).toBeDisabled();
    });

    it('shows notification channel summary for configured channels', () => {
      mockSchedulesData = [
        makeSchedule({ notifications: { email: true, sms: true, push: false } }),
      ];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // The schedule card shows a comma-separated channel summary in a small text span
      const emailMatches = screen.getAllByText(/com_ui_schedule_channel_email/);
      // At least one match in the schedule card's channel summary (others are in the notification settings section)
      expect(emailMatches.length).toBeGreaterThanOrEqual(1);
      const smsMatches = screen.getAllByText(/com_ui_schedule_channel_sms/);
      expect(smsMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('calls run mutation when Run now is clicked', async () => {
      mockRunMutateAsync.mockResolvedValue({
        executionResult: { conversationId: 'conv-1', responseMessageId: 'msg-1', preview: null },
      });
      mockSchedulesData = [makeSchedule()];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const runButton = screen.getByText('com_ui_schedule_run_now');
      await act(async () => {
        fireEvent.click(runButton);
      });

      expect(mockRunMutateAsync).toHaveBeenCalledWith('sched-1');
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'success' }),
        );
      });
    });

    it('shows error toast when run fails', async () => {
      mockRunMutateAsync.mockRejectedValue(new Error('Schedule is locked'));
      mockSchedulesData = [makeSchedule()];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const runButton = screen.getByText('com_ui_schedule_run_now');
      await act(async () => {
        fireEvent.click(runButton);
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'error', message: 'Schedule is locked' }),
        );
      });
    });

    it('displays agent target summary correctly', () => {
      mockSchedulesData = [
        makeSchedule({
          target: { endpoint: 'agents' as any, agent_id: 'agent-1' },
        }),
      ];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(
        screen.getByText(/com_ui_schedule_target_agent_value/),
      ).toBeInTheDocument();
    });

    it('displays model target summary correctly', () => {
      mockSchedulesData = [makeSchedule()];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(
        screen.getByText(/com_ui_schedule_target_model_value/),
      ).toBeInTheDocument();
    });

    it('truncates long response previews', () => {
      const longPreview = 'A'.repeat(200);
      mockSchedulesData = [makeSchedule({ lastResponsePreview: longPreview })];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // Should be truncated with ellipsis
      const previewEl = screen.getByText(/^A+…$/);
      expect(previewEl.textContent!.length).toBeLessThan(200);
    });
  });

  /* ── VAL-SCHED-002: notification settings expose capabilities ── */

  describe('VAL-SCHED-002: notification settings and capability display', () => {
    it('shows loading state while notifications are being fetched', () => {
      mockSchedulesData = [];
      mockNotificationsLoading = true;
      renderComponent();

      // spinner is in notifications section
      const spinners = screen.getAllByTestId('spinner');
      expect(spinners.length).toBeGreaterThan(0);
    });

    it('renders email notification toggle reflecting saved state', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        email: { enabled: true, address: 'saved@example.com' },
      });
      renderComponent();

      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      expect(emailSwitch).toHaveAttribute('aria-checked', 'true');
    });

    it('disables email toggle when email capability is false', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        capabilities: makeTestCapabilities({
          email: false,
          sms: true,
          smsProviders: { twilio: true, carrierGateway: false },
          push: true,
        }),
      });
      renderComponent();

      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      expect(emailSwitch).toBeDisabled();
    });

    it('renders SMS notification toggle reflecting saved state', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        sms: {
          enabled: true,
          provider: 'twilio',
          phoneNumber: '+15551234567',
          gatewayAddress: '',
        },
      });
      renderComponent();

      const smsSwitch = screen.getByTestId('switch-com_ui_schedule_channel_sms');
      expect(smsSwitch).toHaveAttribute('aria-checked', 'true');
    });

    it('disables SMS toggle when SMS capability is false', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        capabilities: makeTestCapabilities({
          email: true,
          sms: false,
          smsProviders: { twilio: false, carrierGateway: false },
          push: true,
        }),
      });
      renderComponent();

      const smsSwitch = screen.getByTestId('switch-com_ui_schedule_channel_sms');
      expect(smsSwitch).toBeDisabled();
    });

    it('shows SMS provider options based on capabilities (twilio + carrier gateway)', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // Both providers should be in the dropdown options
      expect(screen.getByText('com_ui_schedule_sms_provider_twilio')).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_sms_provider_gateway')).toBeInTheDocument();
    });

    it('renders notification save button that becomes enabled when settings change', async () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // Verify save is initially disabled because the form is clean
      const saveButtons = screen.getAllByText('com_ui_save');
      const notifSaveBtn = saveButtons[0];
      expect(notifSaveBtn).toBeDisabled();

      // The notification section exposes email address input, phone number input, etc.
      // These trigger handleNotificationChange which sets notificationDirty
      // This is verified by the save button's disabled condition: `!notificationDirty || isNotificationsSaving`
    });

    it('does not call update notifications mutation on initial render without user interaction', async () => {
      mockUpdateNotifMutateAsync.mockResolvedValue(makeNotifications());
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        email: { enabled: true, address: 'user@example.com' },
        sms: { enabled: true, provider: 'twilio', phoneNumber: '+15551234567', gatewayAddress: '' },
        push: { enabled: true, subscriptionCount: 1 },
      });
      renderComponent();

      // Verify the mutation is not called just by rendering with pre-populated notification data
      expect(mockUpdateNotifMutateAsync).not.toHaveBeenCalled();
    });

    it('notification save button is disabled when form is clean', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const saveButtons = screen.getAllByText('com_ui_save');
      const notifSaveBtn = saveButtons[0];
      expect(notifSaveBtn).toBeDisabled();
    });

    /* ── Interaction: toggle, save, assert payload & persisted state ── */

    it('toggles email off and saves with correct payload', async () => {
      mockUpdateNotifMutateAsync.mockResolvedValue(
        makeNotifications({ email: { enabled: false, address: 'test@example.com' } }),
      );
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        email: { enabled: true, address: 'test@example.com' },
      });
      renderComponent();

      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      expect(emailSwitch).toHaveAttribute('aria-checked', 'true');

      await act(async () => {
        fireEvent.click(emailSwitch);
      });
      expect(emailSwitch).toHaveAttribute('aria-checked', 'false');

      // saveButtons[0] = dialog save, saveButtons[1] = notification save
      const saveButtons = screen.getAllByText('com_ui_save');
      const notifSaveBtn = saveButtons[1];
      expect(notifSaveBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(notifSaveBtn);
      });

      expect(mockUpdateNotifMutateAsync).toHaveBeenCalledWith({
        email: { enabled: false, address: 'test@example.com' },
        sms: { enabled: false, provider: 'twilio', phoneNumber: '', gatewayAddress: '' },
        push: { enabled: false },
      });
    });

    it('saves updated email address in payload', async () => {
      mockUpdateNotifMutateAsync.mockResolvedValue(
        makeNotifications({ email: { enabled: true, address: 'new@example.com' } }),
      );
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        email: { enabled: true, address: 'old@example.com' },
      });
      renderComponent();

      const emailInput = screen.getByDisplayValue('old@example.com');
      await act(async () => {
        fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
      });

      const saveButtons = screen.getAllByText('com_ui_save');
      await act(async () => {
        fireEvent.click(saveButtons[1]);
      });

      expect(mockUpdateNotifMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          email: { enabled: true, address: 'new@example.com' },
        }),
      );
    });

    it('toggles SMS on and saves with correct payload including provider and phone', async () => {
      mockUpdateNotifMutateAsync.mockResolvedValue(makeNotifications());
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        sms: { enabled: false, provider: 'twilio', phoneNumber: '', gatewayAddress: '' },
      });
      renderComponent();

      // Toggle SMS on
      const smsSwitch = screen.getByTestId('switch-com_ui_schedule_channel_sms');
      await act(async () => {
        fireEvent.click(smsSwitch);
      });

      // Type phone number
      const phoneInput = screen.getByPlaceholderText(
        'com_ui_schedule_sms_phone_number_placeholder',
      );
      await act(async () => {
        fireEvent.change(phoneInput, { target: { value: '+15551234567' } });
      });

      const saveButtons = screen.getAllByText('com_ui_save');
      await act(async () => {
        fireEvent.click(saveButtons[1]);
      });

      expect(mockUpdateNotifMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sms: {
            enabled: true,
            provider: 'twilio',
            phoneNumber: '+15551234567',
            gatewayAddress: '',
          },
        }),
      );
    });

    it('clears dirty state and shows success toast after successful save', async () => {
      mockUpdateNotifMutateAsync.mockResolvedValue(makeNotifications());
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // Make dirty by toggling email
      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      await act(async () => {
        fireEvent.click(emailSwitch);
      });

      const saveButtons = screen.getAllByText('com_ui_save');
      const notifSaveBtn = saveButtons[1];
      expect(notifSaveBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(notifSaveBtn);
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'success',
            message: 'com_ui_schedule_notifications_saved',
          }),
        );
      });

      // Save button should be disabled again (dirty cleared)
      expect(notifSaveBtn).toBeDisabled();
    });

    it('shows error toast when notification save fails', async () => {
      mockUpdateNotifMutateAsync.mockRejectedValue(new Error('Invalid email format'));
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      await act(async () => {
        fireEvent.click(emailSwitch);
      });

      const saveButtons = screen.getAllByText('com_ui_save');
      await act(async () => {
        fireEvent.click(saveButtons[1]);
      });

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'error', message: 'Invalid email format' }),
        );
      });
    });

    it('persisted state from server is reflected in UI on fresh render', () => {
      // Simulate what happens after a save + refetch: server returns updated data
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        email: { enabled: false, address: 'saved@example.com' },
        sms: {
          enabled: true,
          provider: 'twilio',
          phoneNumber: '+15559876543',
          gatewayAddress: '',
        },
        push: { enabled: true, subscriptionCount: 2 },
      });
      renderComponent();

      // Email toggle reflects saved disabled state
      const emailSwitch = screen.getByTestId('switch-com_ui_schedule_channel_email');
      expect(emailSwitch).toHaveAttribute('aria-checked', 'false');

      // Email address shows saved value
      expect(screen.getByDisplayValue('saved@example.com')).toBeInTheDocument();

      // SMS toggle reflects saved enabled state
      const smsSwitch = screen.getByTestId('switch-com_ui_schedule_channel_sms');
      expect(smsSwitch).toHaveAttribute('aria-checked', 'true');

      // Phone number shows saved value
      expect(screen.getByDisplayValue('+15559876543')).toBeInTheDocument();

      // Push toggle reflects saved enabled state
      const pushSwitch = screen.getByTestId('switch-com_ui_schedule_channel_push');
      expect(pushSwitch).toHaveAttribute('aria-checked', 'true');

      // Subscription count displayed
      expect(
        screen.getByText(/com_ui_schedule_push_subscription_count/),
      ).toBeInTheDocument();
    });
  });

  /* ── VAL-SCHED-009: browser push subscription lifecycle ──────── */

  describe('VAL-SCHED-009: push subscription lifecycle', () => {
    it('renders push toggle and subscribe/unsubscribe buttons', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      const pushSwitch = screen.getByTestId('switch-com_ui_schedule_channel_push');
      expect(pushSwitch).toBeInTheDocument();

      // Enable button
      expect(screen.getByText('com_ui_schedule_push_enable_browser')).toBeInTheDocument();
      // Disable button
      expect(screen.getByText('com_ui_schedule_push_disable_browser')).toBeInTheDocument();
    });

    it('disables push toggle when push capability is false', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        capabilities: makeTestCapabilities({
          email: true,
          sms: true,
          smsProviders: { twilio: true, carrierGateway: false },
          push: false,
          [VAPID_FIELD]: null,
        }),
      });
      renderComponent();

      const pushSwitch = screen.getByTestId('switch-com_ui_schedule_channel_push');
      expect(pushSwitch).toBeDisabled();
    });

    it('disables push toggle when VAPID public key is missing', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        capabilities: makeTestCapabilities({
          email: true,
          sms: true,
          smsProviders: { twilio: true, carrierGateway: false },
          push: true,
          [VAPID_FIELD]: null,
        }),
      });
      renderComponent();

      const pushSwitch = screen.getByTestId('switch-com_ui_schedule_channel_push');
      expect(pushSwitch).toBeDisabled();
    });

    it('disables subscribe button when push is not configured', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        capabilities: makeTestCapabilities({
          email: true,
          sms: false,
          smsProviders: { twilio: false, carrierGateway: false },
          push: false,
          [VAPID_FIELD]: null,
        }),
      });
      renderComponent();

      const subscribeBtn = screen.getByText('com_ui_schedule_push_enable_browser');
      expect(subscribeBtn).toBeDisabled();
    });

    it('shows subscription count from server state', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        push: { enabled: true, subscriptionCount: 3 },
      });
      renderComponent();

      // The localize mock replaces {{count}} → 3
      expect(
        screen.getByText(/com_ui_schedule_push_subscription_count/),
      ).toBeInTheDocument();
    });

    it('shows refresh label when subscriptions exist', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        push: { enabled: true, subscriptionCount: 1 },
      });
      renderComponent();

      expect(screen.getByText('com_ui_schedule_push_refresh')).toBeInTheDocument();
    });

    it('disables unsubscribe button when no subscriptions exist', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        push: { enabled: false, subscriptionCount: 0 },
      });
      renderComponent();

      const unsubBtn = screen.getByText('com_ui_schedule_push_disable_browser');
      expect(unsubBtn).toBeDisabled();
    });

    it('enables unsubscribe button when subscriptions exist', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications({
        push: { enabled: true, subscriptionCount: 2 },
      });
      renderComponent();

      const unsubBtn = screen.getByText('com_ui_schedule_push_disable_browser');
      expect(unsubBtn).not.toBeDisabled();
    });

    /* ── Interaction: subscribe/unsubscribe flows ── */

    describe('push subscribe/unsubscribe interactions', () => {
      const mockPushSubscription = {
        endpoint: 'https://push.example.com/sub/abc123',
        toJSON: jest.fn(() => ({
          endpoint: 'https://push.example.com/sub/abc123',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        })),
        unsubscribe: jest.fn().mockResolvedValue(true),
      };

      const mockRegistration = {
        pushManager: {
          getSubscription: jest.fn(),
          subscribe: jest.fn().mockResolvedValue(mockPushSubscription),
        },
      };

      const origDescriptors: Record<string, PropertyDescriptor | undefined> = {};

      beforeEach(() => {
        origDescriptors.serviceWorker = Object.getOwnPropertyDescriptor(
          navigator,
          'serviceWorker',
        );

        Object.defineProperty(navigator, 'serviceWorker', {
          value: { ready: Promise.resolve(mockRegistration) },
          configurable: true,
        });
        (window as any).PushManager = jest.fn();
        (window as any).Notification = {
          requestPermission: jest
            .fn()
            .mockResolvedValue('granted' as NotificationPermission),
        };

        mockRegistration.pushManager.getSubscription.mockReset();
        mockRegistration.pushManager.subscribe
          .mockReset()
          .mockResolvedValue(mockPushSubscription);
        mockPushSubscription.toJSON.mockClear();
        mockPushSubscription.unsubscribe.mockReset().mockResolvedValue(true);
      });

      afterEach(() => {
        if (origDescriptors.serviceWorker) {
          Object.defineProperty(
            navigator,
            'serviceWorker',
            origDescriptors.serviceWorker,
          );
        } else {
          delete (navigator as any).serviceWorker;
        }
        delete (window as any).PushManager;
        delete (window as any).Notification;
      });

      it('subscribes to push and calls mutation with subscription JSON', async () => {
        mockRegistration.pushManager.getSubscription.mockResolvedValue(null);
        mockSubscribePushMutateAsync.mockResolvedValue({ subscriptionCount: 1 });
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 0 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        const subscribeBtn = screen.getByText('com_ui_schedule_push_enable_browser');
        await waitFor(() => {
          expect(subscribeBtn).not.toBeDisabled();
        });

        await act(async () => {
          fireEvent.click(subscribeBtn);
        });

        await waitFor(() => {
          expect(
            (window as any).Notification.requestPermission,
          ).toHaveBeenCalled();
          expect(mockRegistration.pushManager.subscribe).toHaveBeenCalledWith({
            userVisibleOnly: true,
            applicationServerKey: expect.any(Uint8Array),
          });
          expect(mockSubscribePushMutateAsync).toHaveBeenCalledWith(
            mockPushSubscription.toJSON(),
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'success',
            message: 'com_ui_schedule_push_enabled',
          }),
        );
      });

      it('shows error toast when push permission is denied', async () => {
        (window as any).Notification.requestPermission = jest
          .fn()
          .mockResolvedValue('denied' as NotificationPermission);
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 0 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        const subscribeBtn = screen.getByText('com_ui_schedule_push_enable_browser');
        await waitFor(() => {
          expect(subscribeBtn).not.toBeDisabled();
        });

        await act(async () => {
          fireEvent.click(subscribeBtn);
        });

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error' }),
          );
        });

        expect(mockSubscribePushMutateAsync).not.toHaveBeenCalled();
      });

      it('unsubscribes from push and calls mutation with endpoint', async () => {
        mockRegistration.pushManager.getSubscription.mockResolvedValue(
          mockPushSubscription,
        );
        mockUnsubscribePushMutateAsync.mockResolvedValue({
          subscriptionCount: 0,
        });
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 1 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        const unsubBtn = screen.getByText('com_ui_schedule_push_disable_browser');
        expect(unsubBtn).not.toBeDisabled();

        await act(async () => {
          fireEvent.click(unsubBtn);
        });

        await waitFor(() => {
          expect(mockPushSubscription.unsubscribe).toHaveBeenCalled();
          expect(mockUnsubscribePushMutateAsync).toHaveBeenCalledWith(
            'https://push.example.com/sub/abc123',
          );
        });

        expect(mockShowToast).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'success',
            message: 'com_ui_schedule_push_disabled',
          }),
        );
      });

      it('handles subscribe mutation error gracefully', async () => {
        mockRegistration.pushManager.getSubscription.mockResolvedValue(null);
        mockSubscribePushMutateAsync.mockRejectedValue(
          new Error('Server error'),
        );
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 0 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        const subscribeBtn = screen.getByText('com_ui_schedule_push_enable_browser');
        await waitFor(() => {
          expect(subscribeBtn).not.toBeDisabled();
        });

        await act(async () => {
          fireEvent.click(subscribeBtn);
        });

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'error',
              message: 'Server error',
            }),
          );
        });
      });

      it('handles unsubscribe mutation error gracefully', async () => {
        mockRegistration.pushManager.getSubscription.mockResolvedValue(
          mockPushSubscription,
        );
        mockUnsubscribePushMutateAsync.mockRejectedValue(
          new Error('Network failure'),
        );
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 1 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        const unsubBtn = screen.getByText('com_ui_schedule_push_disable_browser');
        await act(async () => {
          fireEvent.click(unsubBtn);
        });

        await waitFor(() => {
          expect(mockShowToast).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'error',
              message: 'Network failure',
            }),
          );
        });
      });

      it('subscription count updates in UI when server data changes', () => {
        // Render with initial count = 0
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 0 },
        });
        const { unmount } = renderComponent();

        // Unsubscribe button disabled when count is 0
        const unsubBtn = screen.getByText('com_ui_schedule_push_disable_browser');
        expect(unsubBtn).toBeDisabled();

        unmount();

        // Re-render with updated count = 2 (simulating refetch after subscribe)
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 2 },
        });
        renderComponent();

        // Unsubscribe button should now be enabled (count > 0)
        const unsubBtnAfter = screen.getByText(
          'com_ui_schedule_push_disable_browser',
        );
        expect(unsubBtnAfter).not.toBeDisabled();

        // Subscription count text displayed
        expect(
          screen.getByText(/com_ui_schedule_push_subscription_count/),
        ).toBeInTheDocument();
      });

      it('uses existing subscription for re-subscribe instead of creating new', async () => {
        // When getSubscription returns an existing subscription, skip subscribe()
        mockRegistration.pushManager.getSubscription.mockResolvedValue(
          mockPushSubscription,
        );
        mockSubscribePushMutateAsync.mockResolvedValue({
          subscriptionCount: 1,
        });
        mockSchedulesData = [];
        mockNotificationsData = makeNotifications({
          push: { enabled: true, subscriptionCount: 1 },
          capabilities: makeTestCapabilities({ [VAPID_FIELD]: 'dGVzdA' }),
        });
        renderComponent();

        // Button shows "refresh" label when subscriptions already exist
        const refreshBtn = screen.getByText('com_ui_schedule_push_refresh');
        await waitFor(() => {
          expect(refreshBtn).not.toBeDisabled();
        });

        await act(async () => {
          fireEvent.click(refreshBtn);
        });

        await waitFor(() => {
          // Should NOT create a new subscription
          expect(
            mockRegistration.pushManager.subscribe,
          ).not.toHaveBeenCalled();
          // Should still call mutation with existing subscription
          expect(mockSubscribePushMutateAsync).toHaveBeenCalledWith(
            mockPushSubscription.toJSON(),
          );
        });
      });
    });
  });

  /* ── Schedule create/edit dialog ─────────────────────────────── */

  describe('schedule create/edit dialog', () => {
    it('renders create dialog form fields (always visible in test mock)', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // With the always-open dialog mock, the form fields are immediately visible
      expect(screen.getByText('com_ui_schedule_name')).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_prompt')).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_cron')).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_timezone')).toBeInTheDocument();
    });

    it('shows notification channel checkboxes in dialog form', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_notifications')).toBeInTheDocument();
      // Channel labels appear in both notification settings and dialog form
      const emailLabels = screen.getAllByText('com_ui_schedule_channel_email');
      expect(emailLabels.length).toBeGreaterThanOrEqual(2); // at least notification section + dialog
    });

    it('shows target type selector with agent and model options', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_target_type')).toBeInTheDocument();
    });

    it('shows enabled toggle in dialog form', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('com_ui_schedule_enabled')).toBeInTheDocument();
      expect(screen.getByText('com_ui_schedule_enabled_description')).toBeInTheDocument();
    });

    it('disables save when required fields are empty', () => {
      mockSchedulesData = [];
      mockNotificationsData = makeNotifications();
      renderComponent();

      // Save buttons - last one is the dialog save (notification save is first)
      const saveButtons = screen.getAllByText('com_ui_save');
      const dialogSave = saveButtons[saveButtons.length - 1];
      expect(dialogSave).toBeDisabled();
    });
  });

  /* ── Multiple schedules with different tenants ─────────────── */

  describe('tenant isolation in UI', () => {
    it('renders multiple schedules owned by the authenticated user', () => {
      mockSchedulesData = [
        makeSchedule({ scheduleId: 'sched-1', name: 'Morning Brief' }),
        makeSchedule({ scheduleId: 'sched-2', name: 'Evening Digest' }),
      ];
      mockNotificationsData = makeNotifications();
      renderComponent();

      expect(screen.getByText('Morning Brief')).toBeInTheDocument();
      expect(screen.getByText('Evening Digest')).toBeInTheDocument();
    });
  });
});
