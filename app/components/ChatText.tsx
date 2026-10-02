// tiny markdown for chat: bold, italic, code, lists. html escaped first.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// inline **bold**, *italic*, `code` on already-escaped text
function inlineHtml(s: string): string {
  let h = esc(s);
  h = h.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  return h;
}

// rendering assistant text with basic markdown, no extra libs
export default function ChatText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const fences = text.split("```");
  fences.forEach((part, fi) => {
    // odd parts sit inside code fences
    if (fi % 2 === 1) {
      blocks.push(
        <pre key={fi} className="overflow-x-auto rounded bg-black/10 p-1.5 text-xs dark:bg-white/10">
          <code>{part.replace(/^\n/, "")}</code>
        </pre>
      );
      return;
    }
    let list: string[] = [];
    const flush = (k: string) => {
      if (!list.length) return;
      const items = list;
      list = [];
      blocks.push(
        <ul key={k} className="list-disc space-y-0.5 pl-4">
          {items.map((li, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: inlineHtml(li) }} />
          ))}
        </ul>
      );
    };
    part.split("\n").forEach((ln, li) => {
      const item = ln.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
      if (item) {
        list.push(item[1]);
      } else {
        flush(`${fi}-${li}`);
        if (ln.trim()) {
          blocks.push(
            <p key={`${fi}-${li}`} dangerouslySetInnerHTML={{ __html: inlineHtml(ln) }} />
          );
        }
      }
    });
    flush(`${fi}-end`);
  });
  return <div className="space-y-1">{blocks}</div>;
}
