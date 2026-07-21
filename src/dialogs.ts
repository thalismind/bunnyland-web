export interface DialogOptions {
  cancelLabel?: string;
  confirmLabel?: string;
  title?: string;
  tone?: 'danger' | 'default';
}

export interface PromptDialogOptions extends DialogOptions {
  autocomplete?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'password' | 'text';
  value?: string;
}

interface SharedDialogApi {
  confirmDialog(message: string, options?: DialogOptions): Promise<boolean>;
  promptDialog(message: string, options?: PromptDialogOptions): Promise<string | null>;
}

const dialogGlobals = globalThis as typeof globalThis & { BunnylandUI: SharedDialogApi };

export function confirmDialog(message: string, options?: DialogOptions): Promise<boolean> {
  return dialogGlobals.BunnylandUI.confirmDialog(message, options);
}

export function promptDialog(message: string, options?: PromptDialogOptions): Promise<string | null> {
  return dialogGlobals.BunnylandUI.promptDialog(message, options);
}
