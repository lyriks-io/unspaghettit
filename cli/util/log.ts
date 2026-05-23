import pc from 'picocolors';

export const log = {
  info: (msg: string) => process.stdout.write(`${pc.cyan('›')} ${msg}\n`),
  step: (msg: string) => process.stdout.write(`${pc.cyan('●')} ${msg}\n`),
  ok: (msg: string) => process.stdout.write(`${pc.green('✓')} ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`${pc.yellow('!')} ${msg}\n`),
  err: (msg: string) => process.stderr.write(`${pc.red('✗')} ${msg}\n`),
  dim: (msg: string) => process.stdout.write(`  ${pc.dim(msg)}\n`),
  blank: () => process.stdout.write('\n')
};
