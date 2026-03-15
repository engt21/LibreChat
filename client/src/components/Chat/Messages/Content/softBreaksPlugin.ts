import { visit } from 'unist-util-visit';
import type { Node } from 'unist';

type MarkdownNode = Node & {
  children?: MarkdownNode[];
  value?: string;
};

const splitTextNode = (value: string): MarkdownNode[] => {
  const segments = value.split('\n');

  return segments.flatMap((segment, index) => {
    const nodes: MarkdownNode[] = [];

    if (segment.length > 0) {
      nodes.push({ type: 'text', value: segment });
    }

    if (index < segments.length - 1) {
      nodes.push({ type: 'break' });
    }

    return nodes;
  });
};

export function softBreaksPlugin() {
  return (tree: Node) => {
    visit(tree, 'text', (node, index, parent) => {
      const textNode = node as MarkdownNode;
      const parentNode = parent as MarkdownNode | undefined;

      if (
        typeof textNode.value !== 'string' ||
        textNode.value.includes('\n') === false ||
        index == null ||
        parentNode?.children == null
      ) {
        return;
      }

      const segments = splitTextNode(textNode.value);

      if (segments.length === 0) {
        return;
      }

      parentNode.children.splice(index, 1, ...segments);
      return index + segments.length;
    });
  };
}
