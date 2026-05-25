import prompts, { type Answers, type PromptObject } from 'prompts';
import { log } from './log';

// Single entry point for interactive CLI prompts. `prompts` resolves a
// cancelled prompt (ESC / Ctrl+C) with `undefined`, which call sites tended
// to coalesce into a default — turning a cancel into a silent auto-select.
// Routing every prompt through `ask` makes ESC / Ctrl+C abort the whole CLI
// run with the conventional SIGINT exit code (130).
export const ask = async <T extends string = string>(
  questions: PromptObject<T> | PromptObject<T>[]
): Promise<Answers<T>> =>
  prompts(questions, {
    onCancel: () => {
      log.warn('Cancelled.');
      process.exit(130);
    }
  });
