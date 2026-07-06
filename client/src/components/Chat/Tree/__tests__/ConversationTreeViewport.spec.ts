import type { ConversationTreeLayoutBounds } from '../types';
import {
  calculateFitTransform,
  calculateMiniMapLayout,
  mapMiniMapPointToWorld,
  mapWorldPointToMiniMap,
  screenDeltaToWorldDelta,
} from '../viewport';

describe('conversation tree viewport helpers', () => {
  it('converts arrange drag screen deltas by the current scale', () => {
    expect(screenDeltaToWorldDelta({ x: 36, y: -18 }, 0.5)).toEqual({ x: 72, y: -36 });
    expect(screenDeltaToWorldDelta({ x: 36, y: -18 }, 1.5)).toEqual({ x: 24, y: -12 });
  });

  it('calculates exact fit transforms from layout bounds', () => {
    const bounds: ConversationTreeLayoutBounds = {
      minX: -40,
      minY: 20,
      maxX: 360,
      maxY: 220,
      width: 400,
      height: 200,
    };

    expect(calculateFitTransform(bounds, { width: 1000, height: 700 }, 40)).toEqual({
      scale: 2,
      positionX: 180,
      positionY: 110,
    });
  });

  it('maps mini-map coordinates back to world coordinates', () => {
    const bounds: ConversationTreeLayoutBounds = {
      minX: -50,
      minY: 25,
      maxX: 450,
      maxY: 325,
      width: 500,
      height: 300,
    };
    const miniMap = calculateMiniMapLayout(bounds, { width: 180, height: 112, padding: 8 });
    const worldPoint = { x: 200, y: 120 };
    const miniMapPoint = mapWorldPointToMiniMap(worldPoint, miniMap);
    const roundTrip = mapMiniMapPointToWorld(miniMapPoint, miniMap);

    expect(roundTrip.x).toBeCloseTo(worldPoint.x, 6);
    expect(roundTrip.y).toBeCloseTo(worldPoint.y, 6);
  });
});
