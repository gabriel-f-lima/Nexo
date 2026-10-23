import { Fragment, useState, type ReactNode } from 'react';

/**
 * Markdown leve para as respostas do assistente: títulos, negrito/itálico, listas, citações, código,
 * tabelas, links e imagens. Monta elementos React (sem HTML cru), então nada do texto vira código na página.
 * Tolera texto incompleto, porque também é usado enquanto a resposta chega aos poucos.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' };

type ListItem = { lines: string[]; sub: { ordered: boolean; items: string[][] } | null };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

const startsBlock = (line: string, next?: string) =>
  HEADING.test(line) || HR.test(line) || FENCE.test(line) || BULLET.test(line) || ORDERED.test(line)
  || QUOTE.test(line) || (TABLE_ROW.test(line) && next !== undefined && TABLE_SEP.test(next));

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) { body.push(lines[i]); i += 1; }
      i += 1; // Fecha o bloco (ou termina o texto, se ainda estiver chegando).
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR.test(line)) { blocks.push({ kind: 'hr' }); i += 1; continue; }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(splitRow(lines[i])); i += 1; }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) { quoted.push(QUOTE.exec(lines[i])![1]); i += 1; }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const list: Extract<Block, { kind: 'list' }> = {
        kind: 'list', ordered: isOrdered, start: ordered ? Number(ordered[2]) : 1, items: [],
      };
      while (i < lines.length) {
        const current = lines[i];
        const b = BULLET.exec(current);
        const o = ORDERED.exec(current);
        const item = b ?? o;
        if (item) {
          const indent = item[1].length;
          // Um item no primeiro nível de outro tipo começa uma lista nova.
          if (indent < 2 && (isOrdered ? !!b : !!o)) break;
          const content = o ? o[3] : b![2];
          const parent = list.items[list.items.length - 1];
          // Itens recuados viram uma sublista do item anterior.
          if (indent >= 2 && parent) {
            parent.sub ??= { ordered: !!o, items: [] };
            parent.sub.items.push([content]);
          } else {
            list.items.push({ lines: [content], sub: null });
          }
          i += 1;
          continue;
        }
        if (!current.trim()) {
          // Linha em branco entre itens da mesma lista não a interrompe.
          const next = lines[i + 1];
          if (next !== undefined && (BULLET.test(next) || ORDERED.test(next))) { i += 1; continue; }
          break;
        }
        if (startsBlock(current, lines[i + 1])) break;
        // Continuação do item anterior (por exemplo, o link de uma fonte na linha seguinte).
        const parent = list.items[list.items.length - 1];
        (parent.sub ? parent.sub.items[parent.sub.items.length - 1] : parent.lines).push(current.trim());
        i += 1;
      }
      blocks.push(list);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif)(\?[^\s]*)?$/i;

/** Mostra só o domínio e o começo do caminho, para links longos não ocuparem a mensagem toda. */
const shortUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    if (!path) return host;
    return `${host}${path.length > 28 ? `${path.slice(0, 26)}…` : path}`;
  } catch {
    return url;
  }
};

const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <a href={src} target="_blank" rel="noopener noreferrer" title={src}>{alt || shortUrl(src)}</a>;
  }
  return (
    <a className="md-image" href={src} target="_blank" rel="noopener noreferrer" title={alt || 'Abrir imagem'}>
      <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>
  );
}

const INLINE = new RegExp([
  /(`+)([^`]+?)\1/.source, // 1-2 código
  /!\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.source, // 3-4 imagem
  /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.source, // 5-6 link
  /\*\*(?=\S)(.+?)\*\*/.source, // 7 negrito
  /__(?=\S)(.+?)__/.source, // 8 negrito
  /~~(?=\S)(.+?)~~/.source, // 9 riscado
  /\*(?=[^\s*])(.+?)\*/.source, // 10 itálico
  /_(?=[^\s_])(.+?)_/.source, // 11 itálico
  /<?(https?:\/\/[^\s<>"]*[^\s<>"'.,;:!?)\]*_])>?/.source, // 12 link solto
].join('|'), 'g');

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let plain = '';
  const flush = () => {
    if (plain) nodes.push(<Fragment key={`${keyPrefix}-t${nodes.length}`}>{plain}</Fragment>);
    plain = '';
  };
  let match: RegExpExecArray | null;
  const pattern = new RegExp(INLINE.source, 'g');

  while ((match = pattern.exec(text))) {
    const before = text.slice(last, match.index);
    const prev = text[match.index - 1] ?? '';
    // "_" ou "*" colados em letras ou números (nomes_de_arquivo, 2*3) não viram itálico.
    if ((match[10] !== undefined || match[11] !== undefined) && /[\p{L}\p{N}]/u.test(prev)) {
      plain += before + match[0][0];
      last = match.index + 1;
      pattern.lastIndex = last;
      continue;
    }
    plain += before;
    flush();
    const key = `${keyPrefix}-${nodes.length}`;

    if (match[2] !== undefined) {
      nodes.push(<code key={key}>{match[2]}</code>);
    } else if (match[4] !== undefined) {
      nodes.push(<ChatImage key={key} src={match[4]} alt={match[3]} />);
    } else if (match[6] !== undefined) {
      const href = safeUrl(match[6]);
      const label = match[5].trim();
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={href}>{renderInline(label === href ? shortUrl(href) : label, key)}</a>
        : <Fragment key={key}>{match[0]}</Fragment>);
    } else if (match[7] !== undefined || match[8] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(match[7] ?? match[8], key)}</strong>);
    } else if (match[9] !== undefined) {
      nodes.push(<del key={key}>{renderInline(match[9], key)}</del>);
    } else if (match[10] !== undefined || match[11] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[10] ?? match[11], key)}</em>);
    } else if (match[12] !== undefined) {
      const url = match[12];
      nodes.push(IMAGE_URL.test(url)
        ? <ChatImage key={key} src={url} alt="" />
        : <a key={key} href={url} target="_blank" rel="noopener noreferrer" title={url}>{shortUrl(url)}</a>);
    }
    last = match.index + match[0].length;
  }
  plain += text.slice(last);
  flush();
  return nodes;
}

/** Linhas de um mesmo bloco, separadas por quebra de linha. */
const renderLines = (lines: string[], key: string) =>
  lines.map((line, index) => (
    <Fragment key={`${key}-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInline(line, `${key}-${index}`)}
    </Fragment>
  ));

const HEADING_TAGS = ['h3', 'h3', 'h4', 'h5', 'h5', 'h5'] as const;

/** Enquanto a resposta chega, fecha um negrito ainda aberto para não mostrar os "**" soltos. */
const closeOpenBold = (text: string) => ((text.match(/\*\*/g)?.length ?? 0) % 2 ? `${text}**` : text);

/**
 * Texto em Markdown; `trailing` (o cursor de digitação) fica no fim do último bloco.
 * Com `streaming`, tolera marcações que ainda não terminaram de chegar.
 */
export default function Markdown({ text, trailing, streaming }: { text: string; trailing?: ReactNode; streaming?: boolean }) {
  const blocks = parseBlocks(streaming ? closeOpenBold(text) : text);
  const lastIndex = blocks.length - 1;

  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const tail = index === lastIndex ? trailing : null;
        switch (block.kind) {
          case 'heading': {
            const Tag = HEADING_TAGS[block.level - 1];
            return <Tag key={key}>{renderInline(block.text, key)}{tail}</Tag>;
          }
          case 'paragraph':
            return <p key={key}>{renderLines(block.lines, key)}{tail}</p>;
          case 'quote':
            return <blockquote key={key}>{renderLines(block.lines, key)}{tail}</blockquote>;
          case 'code':
            return <Fragment key={key}><pre><code>{block.text}</code></pre>{tail}</Fragment>;
          case 'hr':
            return <Fragment key={key}><hr />{tail}</Fragment>;
          case 'table':
            return (
              <Fragment key={key}>
                <div className="md-table">
                  <table>
                    <thead><tr>{block.header.map((cell, c) => <th key={c}>{renderInline(cell, `${key}-h${c}`)}</th>)}</tr></thead>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r}>
                          {block.header.map((_, c) => <td key={c}>{renderInline(row[c] ?? '', `${key}-${r}-${c}`)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tail}
              </Fragment>
            );
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            const itemsLast = block.items.length - 1;
            return (
              <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}>
                {block.items.map((item, itemIndex) => {
                  const itemKey = `${key}-${itemIndex}`;
                  const SubTag = item.sub?.ordered ? 'ol' : 'ul';
                  return (
                    <li key={itemIndex}>
                      {renderLines(item.lines, itemKey)}
                      {item.sub ? (
                        <SubTag>
                          {item.sub.items.map((lines, subIndex) => (
                            <li key={subIndex}>{renderLines(lines, `${itemKey}-${subIndex}`)}</li>
                          ))}
                        </SubTag>
                      ) : null}
                      {itemIndex === itemsLast ? tail : null}
                    </li>
                  );
                })}
              </Tag>
            );
          }
          default:
            return null;
        }
      })}
      {blocks.length === 0 ? trailing : null}
    </div>
  );
}
