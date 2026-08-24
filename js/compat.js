export const nativeDialog =
  typeof window.HTMLDialogElement !== 'undefined' &&
  typeof window.HTMLDialogElement.prototype.showModal === 'function';

let backdrop = null;
const stack = [];

function ensureBackdrop() {
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'dlg-backdrop';
    document.body.appendChild(backdrop);
  }
}

function focusFirst(dlg) {
  const el = dlg.querySelector('input, textarea, select, button');
  if (el) setTimeout(() => el.focus(), 30);
}

function polyShow(dlg) {
  if (dlg.hasAttribute('open')) return;
  ensureBackdrop();
  dlg.setAttribute('open', '');
  dlg.classList.add('modal');
  backdrop.classList.add('on');
  stack.push(dlg);
  focusFirst(dlg);
}

function polyHide(dlg, rv) {
  if (!dlg.hasAttribute('open')) return;
  if (rv !== undefined) dlg.returnValue = String(rv);
  dlg.removeAttribute('open');
  dlg.classList.remove('modal');
  const i = stack.indexOf(dlg);
  if (i > -1) stack.splice(i, 1);
  if (!stack.length && backdrop) backdrop.classList.remove('on');
  dlg.dispatchEvent(new window.CustomEvent('close'));
}

export function openDlg(dlg) {
  if (nativeDialog) dlg.showModal();
  else polyShow(dlg);
}

export function closeDlg(dlg, returnValue) {
  if (nativeDialog) {
    if (returnValue === undefined) dlg.close();
    else dlg.close(String(returnValue));
  } else {
    polyHide(dlg, returnValue);
  }
}

if (!nativeDialog) {
  document.documentElement.classList.add('legacy-browser');
}
