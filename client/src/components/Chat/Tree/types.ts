import type {
  TGenerationGraftErrorCode,
  TGenerationGraftLifecycleState,
  TMessage,
} from 'librechat-data-provider';

export type TreeOrientation = 'horizontal' | 'vertical';
export type TreeSemanticDetail = 'far' | 'medium' | 'near';
export type ConversationTreeRole = 'user' | 'assistant' | 'graft_bridge';

export type ConversationTreeMessageLike = Partial<TMessage> & {
  children?: ConversationTreeMessageLike[] | null;
  content?: unknown;
  metadata?: Record<string, unknown>;
};

export type ConversationTreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  message: ConversationTreeMessageLike;
  role: ConversationTreeRole;
  lifecycle: TGenerationGraftLifecycleState;
  generationIndex: number;
  generationCount: number;
  graftId?: string;
  clonedFromMessageId?: string;
  searchableText: string;
};

export type PositionedTreeNode = ConversationTreeNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ConversationTreeGraph = {
  nodes: Map<string, ConversationTreeNode>;
  orderedIds: string[];
  rootIds: string[];
  parentById: Map<string, string | null>;
  childrenByParent: Map<string | null, string[]>;
  activeMessageIds: Set<string>;
};

export type ConversationTreeLayoutEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

export type ConversationTreeLayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type TreeNodePosition = {
  x: number;
  y: number;
};

export type ConversationTreeLayout = {
  nodes: Map<string, PositionedTreeNode>;
  edges: ConversationTreeLayoutEdge[];
  bounds: ConversationTreeLayoutBounds;
  hiddenDescendantCounts: Map<string, number>;
};

export type ConversationTreeLayoutOptions = {
  orientation: TreeOrientation;
  collapsedIds?: Iterable<string>;
  manualPositions?: ReadonlyMap<string, TreeNodePosition> | Record<string, TreeNodePosition>;
};

export type NormalizeConversationGraphOptions = {
  activeMessageIds?: Iterable<string>;
};

export type InvalidGraftReason = TGenerationGraftErrorCode | null;

export type ConversationTreeVisibleItem = {
  id: string;
  node: ConversationTreeNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

export type ConversationTreeTransformState = {
  scale: number;
  positionX: number;
  positionY: number;
};

export type TreeViewportSize = {
  width: number;
  height: number;
};

export type ConversationTreeViewportCommands = {
  fitTree: () => void;
  fitActiveBranch: () => void;
  fitSelection: () => void;
  fitMessageIds: (messageIds: Iterable<string>) => void;
  recenterOnWorldPoint: (point: { x: number; y: number }) => void;
};

export type MiniMapGeometry = {
  bounds: ConversationTreeLayoutBounds;
  width: number;
  height: number;
  padding: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};
