export type DialogTone = 'default' | 'danger' | 'info' | 'success' | 'warning';

export type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type AlertOpts = {
  title: string;
  message: string;
  buttonLabel?: string;
  tone?: DialogTone;
};

export type ChecklistItem = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultChecked?: boolean;
};

export type ChecklistOpts = {
  title: string;
  message: string;
  items: readonly ChecklistItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type ChecklistResult = {
  readonly confirmed: boolean;
  readonly selectedIds: readonly string[];
};

export type ChoiceOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type ChoiceOpts = {
  title: string;
  message: string;
  options: readonly ChoiceOption[];
  cancelLabel?: string;
  tone?: DialogTone;
};

/**
 * Single free-text input dialog. Used for passphrase entry on the
 * encrypted-bundle export/import flows, but generic enough for any
 * one-field prompt. `password: true` masks the input and suppresses
 * autofill/autocorrect/etc. so the value stays private.
 */
export type PromptOpts = {
  title: string;
  message: string;
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  password?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  /** Optional client-side validator. Return a message to block submit; return null to allow. */
  validate?: (value: string) => string | null;
};

export type DialogRequest =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (value: boolean) => void }
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void }
  | {
      kind: 'checklist';
      opts: ChecklistOpts;
      resolve: (value: ChecklistResult) => void;
    }
  | {
      kind: 'choice';
      opts: ChoiceOpts;
      resolve: (value: string | null) => void;
    }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (value: string | null) => void };

class DialogStore {
  current = $state<DialogRequest | null>(null);

  confirm(opts: ConfirmOpts): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.current = { kind: 'confirm', opts, resolve };
    });
  }

  alert(opts: AlertOpts): Promise<void> {
    return new Promise<void>((resolve) => {
      this.current = { kind: 'alert', opts, resolve };
    });
  }

  checklist(opts: ChecklistOpts): Promise<ChecklistResult> {
    return new Promise<ChecklistResult>((resolve) => {
      this.current = { kind: 'checklist', opts, resolve };
    });
  }

  choose(opts: ChoiceOpts): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.current = { kind: 'choice', opts, resolve };
    });
  }

  prompt(opts: PromptOpts): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.current = { kind: 'prompt', opts, resolve };
    });
  }

  resolveCurrent(value: boolean, selectedIds: readonly string[] = []): void {
    if (!this.current) return;
    const req = this.current;
    this.current = null;
    if (req.kind === 'confirm') req.resolve(value);
    else if (req.kind === 'alert') req.resolve();
    else if (req.kind === 'checklist') req.resolve({ confirmed: value, selectedIds });
    else req.resolve(null);
  }

  resolveChoice(id: string): void {
    if (!this.current || this.current.kind !== 'choice') return;
    const req = this.current;
    this.current = null;
    req.resolve(id);
  }

  resolvePrompt(value: string | null): void {
    if (!this.current || this.current.kind !== 'prompt') return;
    const req = this.current;
    this.current = null;
    req.resolve(value);
  }
}

export const dialogStore = new DialogStore();

export const confirmDialog = (opts: ConfirmOpts): Promise<boolean> => dialogStore.confirm(opts);
export const alertDialog = (opts: AlertOpts): Promise<void> => dialogStore.alert(opts);
export const checklistDialog = (opts: ChecklistOpts): Promise<ChecklistResult> =>
  dialogStore.checklist(opts);
export const chooseDialog = (opts: ChoiceOpts): Promise<string | null> =>
  dialogStore.choose(opts);
export const promptDialog = (opts: PromptOpts): Promise<string | null> =>
  dialogStore.prompt(opts);
