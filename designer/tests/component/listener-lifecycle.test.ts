// @vitest-environment jsdom
/**
 * State-listener lifecycle regression for components that can be unmounted and
 * reconnected while retaining the same store.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import '../../src/components/flow/flow-view';
import '../../src/components/layout/sidebar-left';
import '../../src/components/layout/template-bar';
import '../../src/components/layout/app-header';

interface LifecycleCase {
  tag: 'pld-flow-view' | 'pld-sidebar-left' | 'pld-template-bar' | 'pld-header';
  seed(store: AppStore): void;
  mutateWhileDisconnected(store: AppStore): void;
  mutateAfterReconnect(store: AppStore): void;
  read(component: Record<string, unknown>): unknown;
  expectedSeed: unknown;
  expectedDisconnected: unknown;
  expectedReseed: unknown;
  expectedReconnect: unknown;
}

const cases: LifecycleCase[] = [
  {
    tag: 'pld-flow-view',
    seed: (store) => store.dispatch((state) => { state.jsonKeys = ['seed']; }),
    mutateWhileDisconnected: (store) => store.dispatch((state) => { state.jsonKeys = ['offline']; }),
    mutateAfterReconnect: (store) => store.dispatch((state) => { state.jsonKeys = ['live']; }),
    read: (component) => component.jsonKeys,
    expectedSeed: ['seed'],
    expectedDisconnected: ['seed'],
    expectedReseed: ['offline'],
    expectedReconnect: ['live'],
  },
  {
    tag: 'pld-sidebar-left',
    seed: (store) => store.dispatch((state) => { state.page.size = 'Letter'; }),
    mutateWhileDisconnected: (store) => store.dispatch((state) => { state.page.size = 'A3'; }),
    mutateAfterReconnect: (store) => store.dispatch((state) => { state.page.size = 'A5'; }),
    read: (component) => component.pageSize,
    expectedSeed: 'Letter',
    expectedDisconnected: 'Letter',
    expectedReseed: 'A3',
    expectedReconnect: 'A5',
  },
  {
    tag: 'pld-template-bar',
    seed: (store) => store.dispatch((state) => { state.template.name = 'Seed'; }),
    mutateWhileDisconnected: (store) => store.dispatch((state) => { state.template.name = 'Offline'; }),
    mutateAfterReconnect: (store) => store.dispatch((state) => { state.template.name = 'Live'; }),
    read: (component) => component.name,
    expectedSeed: 'Seed',
    expectedDisconnected: 'Seed',
    expectedReseed: 'Offline',
    expectedReconnect: 'Live',
  },
  {
    tag: 'pld-header',
    seed: (store) => store.dispatch((state) => { state.view = 'flow'; }),
    mutateWhileDisconnected: (store) => store.dispatch((state) => { state.view = 'design'; }),
    mutateAfterReconnect: (store) => store.dispatch((state) => { state.view = 'flow'; }),
    read: (component) => component.activeView,
    expectedSeed: 'flow',
    expectedDisconnected: 'flow',
    expectedReseed: 'design',
    expectedReconnect: 'flow',
  },
];

afterEach(() => {
  document.body.innerHTML = '';
});

describe.each(cases)('$tag state listener', (testCase) => {
  it('stops callbacks while disconnected and reconnects exactly once with current state', () => {
    const store = new AppStore();
    testCase.seed(store);

    const component = document.createElement(testCase.tag) as HTMLElement & Record<string, unknown>;
    component.store = store;
    const callback = vi.fn(component._onStateChanged as (event: Event) => void);
    component._onStateChanged = callback;

    document.body.appendChild(component);
    expect(testCase.read(component)).toEqual(testCase.expectedSeed);

    component.remove();
    testCase.mutateWhileDisconnected(store);
    expect(callback).not.toHaveBeenCalled();
    expect(testCase.read(component)).toEqual(testCase.expectedDisconnected);

    document.body.appendChild(component);
    expect(testCase.read(component)).toEqual(testCase.expectedReseed);

    callback.mockClear();
    testCase.mutateAfterReconnect(store);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(testCase.read(component)).toEqual(testCase.expectedReconnect);
  });
});
