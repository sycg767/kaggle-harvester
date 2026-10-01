export interface TooltipBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const TOOLTIP_WIDTH = 244;
export const TOOLTIP_HEIGHT = 124;

export function placeTrajectoryTooltip(x: number, y: number, bounds: TooltipBounds) {
  const gap = 16;
  // Flip before clamping: clamping an above/right box alone can cover its own point.
  const left = x + gap + TOOLTIP_WIDTH <= bounds.right ? x + gap : x - gap - TOOLTIP_WIDTH;
  const top = y - gap - TOOLTIP_HEIGHT >= bounds.top ? y - gap - TOOLTIP_HEIGHT : y + gap;
  return {
    left: Math.max(bounds.left, Math.min(left, bounds.right - TOOLTIP_WIDTH)),
    top: Math.max(bounds.top, Math.min(top, bounds.bottom - TOOLTIP_HEIGHT)),
  };
}
