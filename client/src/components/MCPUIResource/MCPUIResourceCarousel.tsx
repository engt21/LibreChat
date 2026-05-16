import React, { useMemo } from 'react';
import { useConversationUIResources } from '~/hooks/Messages/useConversationUIResources';
import { useOptionalMessagesConversation } from '~/Providers';
import UIResourceCarousel from '../Chat/Messages/Content/UIResourceCarousel';
import type { UIResource } from 'librechat-data-provider';

interface MCPUIResourceCarouselProps {
  node?: {
    properties?: {
      resourceIds?: string[];
    };
  };
}

const EMPTY_RESOURCE_IDS: string[] = [];

/**
 * Component that renders multiple MCP UI resources in a carousel.
 * Works in both main app and share view.
 */
export function MCPUIResourceCarousel(props: MCPUIResourceCarouselProps) {
  const { conversationId } = useOptionalMessagesConversation();

  const conversationResourceMap = useConversationUIResources(conversationId ?? undefined);
  const resourceIds = props.node?.properties?.resourceIds ?? EMPTY_RESOURCE_IDS;

  const uiResources = useMemo(() => {
    return resourceIds.map((id) => conversationResourceMap.get(id)).filter(Boolean) as UIResource[];
  }, [resourceIds, conversationResourceMap]);

  if (uiResources.length === 0) {
    return null;
  }

  return <UIResourceCarousel uiResources={uiResources} />;
}
