import { create, fromTemplate } from '../lib/dom';

interface DialogOptions {
  label: string;
  closeLabel: string;
  content: Node;
  className?: string;
  onOpen?: (dialog: HTMLDialogElement) => void;
}

export interface OpenDialog {
  element: HTMLDialogElement;
  close: () => void;
}

/** Opens a modal built on the native <dialog>, which supplies the focus trap. */
export function openDialog(options: DialogOptions): OpenDialog {
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const dialog = create('dialog', `modal ${options.className ?? ''}`.trim());
  dialog.setAttribute('aria-label', options.label);

  const top = create('div', 'modal-top');
  top.append(create('span', 'eyebrow', 'NATUREDEX / FIELD STATION'));
  const closeButton = create('button', 'icon-button');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', options.closeLabel);
  closeButton.append(fromTemplate('[data-dialog-close-icon]'));
  top.append(closeButton);
  dialog.append(top, options.content);

  function close() {
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus();
    else document.getElementById('main')?.focus();
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  document.body.append(dialog);
  options.onOpen?.(dialog);
  dialog.showModal();
  return { element: dialog, close };
}
