import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tell React that updates in these tests are wrapped in act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// UI Kit components only render inside Confluence. Replace each one with a
// plain element of the same name so the test renderer can show the tree,
// and capture what the macro passes to ForgeReconciler.render().
const { bridge, rendered } = vi.hoisted(() => ({
  bridge: { invoke: vi.fn() },
  rendered: { element: null },
}));

vi.mock('@forge/bridge', () => bridge);

vi.mock('@forge/react', async () => {
  const { createElement } = await import('react');
  const element = (name) => (props) => createElement(name, props);
  return {
    default: {
      render: (app) => {
        rendered.element = app;
      },
    },
    Box: element('Box'),
    Button: element('Button'),
    Lozenge: element('Lozenge'),
    Stack: element('Stack'),
    Text: element('Text'),
    Tooltip: element('Tooltip'),
    // Render the trigger, and the content only while the popup is open.
    Popup: ({ isOpen, label, role, trigger, content }) =>
      createElement('Popup', { isOpen, label, role }, trigger({}), isOpen ? content() : null),
  };
});

await import('../src/frontend/index.jsx');

// Renders the macro and lets its loading effect finish.
const renderMacro = async () => {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(rendered.element);
  });
  return renderer.root;
};

const lozengeTexts = (root) => root.findAll((node) => node.type === 'Lozenge').map((node) => node.props.children);
const tooltip = (root) => root.find((node) => node.type === 'Tooltip').props.content;
const clickableButtons = (root) =>
  root.findAll((node) => node.type === 'Button' && node.props.onClick && !node.props.isDisabled);

const saved = { status: 'notAccepted', statusChangedAt: '2026-11-01T08:00:00.000Z' };

beforeEach(() => {
  bridge.invoke.mockReset();
});

describe('Status macro', () => {
  it('shows the saved status', async () => {
    bridge.invoke.mockResolvedValue(saved);

    const root = await renderMacro();

    expect(lozengeTexts(root)).toEqual(['NOT ACCEPTED']);
    expect(bridge.invoke).toHaveBeenCalledWith('getStatus');
  });

  it('shows "STATUS UNAVAILABLE", not a default status, when loading fails', async () => {
    bridge.invoke.mockRejectedValue(new Error('Could not load the status.'));

    const root = await renderMacro();

    expect(lozengeTexts(root)).toEqual(['STATUS UNAVAILABLE']);
    expect(tooltip(root)).toBe('Could not load the status. Click to try again.');
    // No status picker while the saved status is unknown.
    expect(root.findAll((node) => node.type === 'Popup')).toHaveLength(0);
  });

  it('loads the status again when STATUS UNAVAILABLE is clicked', async () => {
    let confluenceIsBack = false;
    bridge.invoke.mockImplementation(async () => {
      if (!confluenceIsBack) throw new Error('Could not load the status.');
      return saved;
    });
    const root = await renderMacro();
    expect(lozengeTexts(root)).toEqual(['STATUS UNAVAILABLE']);

    confluenceIsBack = true;
    // The lozenge is a real button, so keyboard users can reach it as well.
    await act(async () => clickableButtons(root)[0].props.onClick());

    expect(lozengeTexts(root)).toEqual(['NOT ACCEPTED']);
  });

  it("hides @forge/bridge's consent diagnostic behind a readable message", async () => {
    bridge.invoke.mockRejectedValue({ message: 'Expected reject to be called with Error' });

    const root = await renderMacro();

    expect(tooltip(root)).toBe('Could not load the status. Click to try again.');
  });

  it('gives the status picker an accessible name', async () => {
    bridge.invoke.mockResolvedValue(saved);

    const root = await renderMacro();

    const popup = root.find((node) => node.type === 'Popup');
    expect(popup.props).toMatchObject({ label: 'Change status', role: 'dialog' });
  });

  it('goes back to the previous status when saving fails, even without an Error object', async () => {
    bridge.invoke.mockImplementation(async (functionKey) => {
      if (functionKey === 'getStatus') return saved;
      // @forge/bridge can reject with values that are not Error instances.
      throw undefined;
    });
    const root = await renderMacro();

    // Open the picker, then choose "ACCEPTED FOR RELEASE".
    await act(async () => clickableButtons(root)[0].props.onClick());
    const option = clickableButtons(root).find((button) =>
      button.findAll((node) => node.type === 'Lozenge' && node.props.children === 'ACCEPTED FOR RELEASE').length,
    );
    await act(async () => option.props.onClick());

    expect(bridge.invoke).toHaveBeenCalledWith('setStatus', { status: 'acceptedForRelease' });
    expect(lozengeTexts(root)).toEqual(['NOT ACCEPTED']);
    expect(tooltip(root)).toMatch(/\| Could not save the status\.$/);
  });
});
