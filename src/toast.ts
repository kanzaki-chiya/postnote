/**
 * PostNote's only feedback surface.
 *
 * Saving happens straight from the click, so there is no dialog to carry the
 * outcome: progress, failures, and the scale that was actually used are reported
 * next to the page, and an error never disappears without being read.
 */

export type ToastKind = 'progress' | 'info' | 'error';

export type Toast = {
  update(text: string, kind: ToastKind): void;
  dismiss(): void;
};

const TOAST_TIMEOUT: Record<ToastKind, number> = {
  progress: 0,
  info: 6_000,
  error: 12_000,
};

export function showToast(message: string, kind: ToastKind, rootClass: string): Toast {
  const container =
    document.querySelector<HTMLElement>('.postnote-toasts') ?? createContainer(rootClass);
  const toast = document.createElement('div');
  container.appendChild(toast);

  let timer: number | undefined;
  const dismiss = () => {
    window.clearTimeout(timer);
    toast.remove();
    if (container.childElementCount === 0) container.remove();
  };
  const update = (text: string, nextKind: ToastKind) => {
    window.clearTimeout(timer);
    toast.className = `postnote-toast is-${nextKind}`;
    toast.setAttribute('role', nextKind === 'error' ? 'alert' : 'status');
    toast.textContent = text;
    const timeout = TOAST_TIMEOUT[nextKind];
    if (timeout > 0) timer = window.setTimeout(dismiss, timeout);
  };

  toast.addEventListener('click', dismiss);
  update(message, kind);
  return { update, dismiss };
}

function createContainer(rootClass: string): HTMLElement {
  const container = document.createElement('div');
  container.className = `postnote-toasts ${rootClass}`;
  document.body.appendChild(container);
  return container;
}
