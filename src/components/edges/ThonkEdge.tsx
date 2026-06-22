import React, { useState, useRef } from 'react'
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { Minus } from 'lucide-react'

export interface ThonkEdgeData {
  relation: string
  isTargetCollapsed: boolean
  targetHasChildren: boolean
  isSourceSelected: boolean
  isTargetSelected: boolean
  hiddenCount?: number
  targetType?: string
  targetTitle?: string
  onCollapse: (id: string) => void
  onExpand: (id: string) => void
}

// De Casteljau subdivision at t=0.5: returns the first-half cubic bezier path
// that ends exactly at (labelX, labelY), the parametric midpoint of the full bezier.
function getHalfBezierPath(edgePath: string, labelX: number, labelY: number): string {
  const nums = edgePath.match(/-?[\d.]+(?:e[+-]?\d+)?/g)
  if (!nums || nums.length < 8) return edgePath
  const [sx, sy, cp1x, cp1y, cp2x, cp2y] = nums.map(Number)
  const hcp1x = (sx + cp1x) / 2
  const hcp1y = (sy + cp1y) / 2
  const hcp2x = (sx + 2 * cp1x + cp2x) / 4
  const hcp2y = (sy + 2 * cp1y + cp2y) / 4
  return `M ${sx},${sy} C ${hcp1x},${hcp1y} ${hcp2x},${hcp2y} ${labelX},${labelY}`
}

function ThonkEdgeComponentFn({
  id,
  target,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition, targetPosition,
  style,
  markerEnd,
  interactionWidth,
  selected,
  data,
}: EdgeProps) {
  const d = data as ThonkEdgeData
  const [hovered, setHovered] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEnter = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setHovered(true) }
  const onLeave = () => { hideTimer.current = setTimeout(() => setHovered(false), 80) }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const isSourceEdge = d?.relation === 'sources'
  const isCollapsed = d?.isTargetCollapsed ?? false
  const adjacentSelected = selected || d?.isSourceSelected || d?.isTargetSelected

  // Collapse button is always rendered (faint when not hovered) so it's discoverable
  // even when the node body covers the edge interaction zone.
  // Any non-source, non-collapsed node can be hidden via its incoming edge.
  const showCollapse = !isSourceEdge && !isCollapsed
  const showExpand  = !isSourceEdge && isCollapsed
  const collapseVisible = hovered
  const strokeColor = (style?.stroke as string | undefined) ?? '#94a3b8'

  // When collapsed, draw only the first half of the bezier (source → badge).
  // Use de Casteljau subdivision so the path ends *exactly* at labelX/labelY.
  const activePath = isCollapsed ? getHalfBezierPath(edgePath, labelX, labelY) : edgePath

  return (
    <>
      <path
        id={id}
        style={style}
        d={activePath}
        fill="none"
        className="react-flow__edge-path"
        markerEnd={isCollapsed ? undefined : markerEnd}
      />
      {!isCollapsed && (
        <path
          d={edgePath}
          fill="none"
          strokeOpacity={0}
          strokeWidth={interactionWidth ?? 20}
          className="react-flow__edge-interaction"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        />
      )}
      {(showCollapse || showExpand) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
            }}
            className="nodrag nopan"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {showExpand ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); d.onExpand(target) }}
                  style={{ backgroundColor: strokeColor }}
                  className={`h-6 px-3 rounded-full flex items-center justify-center cursor-pointer text-sm font-bold transition-opacity hover:opacity-80 ${d?.targetType === 'idea' ? 'text-gray-900' : 'text-white'}`}
                >
                  {d?.hiddenCount ?? 1}
                </button>
                {hovered && d?.targetTitle && (
                  <div
                    style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', width: 'max-content', maxWidth: 280 }}
                    className="bg-gray-900 dark:bg-gray-700 text-white text-sm px-2 py-1 rounded shadow-lg leading-snug"
                  >
                    {d.targetTitle && d.targetTitle.length > 80 ? d.targetTitle.slice(0, 80) + '…' : d.targetTitle}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); d?.onCollapse(target) }}
                style={{ borderColor: strokeColor, color: strokeColor, opacity: collapseVisible ? 1 : 0, pointerEvents: collapseVisible ? 'auto' : 'none' }}
                className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer bg-white dark:bg-gray-950 border-2 transition-opacity duration-75"
              >
                <Minus className="w-3.5 h-3.5" strokeWidth={3} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const ThonkEdgeComponent = React.memo(ThonkEdgeComponentFn)
