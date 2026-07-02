export interface AriaNode {
  role: string;
  name?: string;
  attrs: Record<string, string | boolean>;
  children: AriaNode[];
}

interface StackEntry {
  indent: number;
  node: AriaNode;
}

function parseAttrs(rest: string): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {};
  const bracketPattern = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketPattern.exec(rest)) !== null) {
    const content = match[1] ?? "";
    const eq = content.indexOf("=");
    if (eq === -1) {
      attrs[content.trim()] = true;
    } else {
      const key = content.slice(0, eq).trim();
      const rawValue = content.slice(eq + 1).trim();
      attrs[key] = rawValue.replace(/^"(.*)"$/, "$1");
    }
  }
  return attrs;
}

function parseLine(line: string): { indent: number; node: AriaNode } | undefined {
  const indentMatch = /^(\s*)-\s+(.*)$/.exec(line);
  if (!indentMatch) return undefined;
  const indent = indentMatch[1]?.length ?? 0;
  let rest = (indentMatch[2] ?? "").trimEnd();

  if (rest.endsWith(":")) {
    rest = rest.slice(0, -1).trimEnd();
  }

  const roleMatch = /^(\S+)/.exec(rest);
  if (!roleMatch) return undefined;
  const role = (roleMatch[1] ?? "").replace(/:$/, "");
  rest = rest.slice(roleMatch[0].length).trimStart();

  let name: string | undefined;
  const nameMatch = /^"([^"]*)"/.exec(rest);
  if (nameMatch) {
    name = nameMatch[1];
    rest = rest.slice(nameMatch[0].length).trimStart();
  }

  const attrs = parseAttrs(rest);

  return { indent, node: { role, name, attrs, children: [] } };
}

export function parseAriaSnapshot(raw: string): AriaNode {
  const root: AriaNode = { role: "root", attrs: {}, children: [] };
  const stack: StackEntry[] = [{ indent: -1, node: root }];

  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { indent, node } = parsed;

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.node ?? root;
    parent.children.push(node);
    stack.push({ indent, node });
  }

  return root;
}

export function mapAriaTree(node: AriaNode, fn: (name: string) => string): AriaNode {
  return {
    role: node.role,
    name: node.name !== undefined ? fn(node.name) : undefined,
    attrs: node.attrs,
    children: node.children.map((child) => mapAriaTree(child, fn)),
  };
}

export function filterAriaTree(
  node: AriaNode,
  predicate: (node: AriaNode) => boolean,
): AriaNode {
  return {
    role: node.role,
    name: node.name,
    attrs: node.attrs,
    children: node.children.filter(predicate).map((child) => filterAriaTree(child, predicate)),
  };
}

export function findFirstNode(
  node: AriaNode,
  predicate: (node: AriaNode) => boolean,
): AriaNode | undefined {
  for (const child of node.children) {
    if (predicate(child)) return child;
    const found = findFirstNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function serializeAttrs(attrs: Record<string, string | boolean>): string {
  const keys = Object.keys(attrs).filter((key) => key !== "box");
  return keys
    .map((key) => {
      const value = attrs[key];
      if (value === true) return ` [${key}]`;
      return ` [${key}=${String(value)}]`;
    })
    .join("");
}

export function serializeAriaNode(node: AriaNode, depth = 0): string {
  const lines: string[] = [];
  for (const child of node.children) {
    const indent = "  ".repeat(depth);
    const namePart = child.name !== undefined ? ` "${child.name}"` : "";
    const attrsPart = serializeAttrs(child.attrs);
    lines.push(`${indent}- ${child.role}${namePart}${attrsPart}`);
    if (child.children.length > 0) {
      lines.push(serializeAriaNode(child, depth + 1));
    }
  }
  return lines.join("\n");
}
