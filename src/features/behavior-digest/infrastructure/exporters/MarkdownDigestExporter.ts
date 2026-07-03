import type { DigestLine, DigestSpec } from '../../domain/DigestSpec';
import type { DigestExporter } from '../../domain/ports/DigestExporter';

/**
 * Serializes a `DigestSpec` to Markdown for pasting into a pull request,
 * README, or wiki. Pure string building. The title becomes an `#` heading, the
 * purpose a blockquote, each section an `##` heading, and each line a bullet
 * (its label bolded). Consumes the same spec the panel renders, so the copied
 * text always matches what the reader saw.
 */

const bullet = (line: DigestLine): string => {
  const head = !line.label
    ? `- ${line.text}`
    : line.text
      ? `- **${line.label}**: ${line.text}`
      : `- **${line.label}**`;
  if (!line.details || line.details.length === 0) return head;
  return `${head}\n${line.details.map((detail) => `  - ${detail}`).join('\n')}`;
};

export const markdownDigestExporter: DigestExporter = {
  id: 'markdown',
  label: 'Markdown',

  export(spec: DigestSpec): string {
    const blocks: string[] = [`# ${spec.title || 'Summary'}`];
    if (spec.purposeLine) blocks.push(`> ${spec.purposeLine}`);

    for (const section of spec.sections) {
      if (section.lines.length === 0) continue;
      blocks.push(`## ${section.heading}`);
      blocks.push(section.lines.map(bullet).join('\n'));
    }

    return blocks.join('\n\n');
  }
};
