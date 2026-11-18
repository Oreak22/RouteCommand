import type { DriverPositionEvent } from '@routecommand/shared'
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

import type { Driver } from '../drivers/api/client'
import { livePositionTrail, useLivePositionStore } from '../realtime/store/live-position-store'

type Coordinate = { lat: number; lng: number }
type RenderPosition = { from: Coordinate; to: Coordinate; startedAt: number; duration: number }
type DriverDot = {
  driver: Driver
  point: L.Point
  position: Coordinate
  event: DriverPositionEvent | undefined
}
type Cluster = { key: string; point: L.Point; dots: DriverDot[] }

const colors: Record<string, string> = {
  AVAILABLE: '--driver-available',
  BUSY: '--driver-busy',
  OFFLINE: '--driver-offline',
  ON_BREAK: '--driver-break',
}

function readColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#31c48d'
}

function currentPosition(
  driver: Driver,
  event: DriverPositionEvent | undefined,
  animation: RenderPosition | undefined,
  now: number,
): Coordinate | null {
  if (animation) {
    const ratio = animation.duration
      ? Math.min(1, (now - animation.startedAt) / animation.duration)
      : 1
    return {
      lat: animation.from.lat + (animation.to.lat - animation.from.lat) * ratio,
      lng: animation.from.lng + (animation.to.lng - animation.from.lng) * ratio,
    }
  }
  if (event) return { lat: event.lat, lng: event.lng }
  if (driver.lat !== null && driver.lng !== null) return { lat: driver.lat, lng: driver.lng }
  return null
}

export function DriversCanvasLayer({
  drivers,
  selectedDriverId,
  onSelect,
  live,
}: {
  drivers: Driver[]
  selectedDriverId: string | null
  onSelect: (driverId: string) => void
  live: boolean
}) {
  const map = useMap()
  const driversRef = useRef(drivers)
  const selectedRef = useRef(selectedDriverId)
  const onSelectRef = useRef(onSelect)
  const liveRef = useRef(live)
  const renderPositions = useRef(new Map<string, RenderPosition>())
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef(0)
  const clustersRef = useRef<Cluster[]>([])
  const scheduleDrawRef = useRef<() => void>(() => {})
  const expandedClusterRef = useRef<string | null>(null)

  useEffect(() => {
    driversRef.current = drivers
    selectedRef.current = selectedDriverId
    onSelectRef.current = onSelect
    liveRef.current = live
    scheduleDrawRef.current()
  }, [drivers, selectedDriverId, onSelect, live])

  useEffect(() => {
    const animations = renderPositions.current
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    canvas.className = 'dispatcher-driver-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText =
      'position:absolute;inset:0;z-index:650;width:100%;height:100%;pointer-events:none'
    map.getContainer().append(canvas)
    canvasRef.current = canvas

    const fitCanvas = () => {
      const size = map.getSize()
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.round(size.x * ratio)
      canvas.height = Math.round(size.y * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      scheduleDraw()
    }

    const draw = () => {
      frameRef.current = 0
      const size = map.getSize()
      const now = performance.now()
      context.clearRect(0, 0, size.x, size.y)
      const dots: DriverDot[] = []
      let animating = false
      const state = useLivePositionStore.getState()
      const colorValues = Object.fromEntries(
        Object.values(colors).map((token) => [token, readColor(token)]),
      )
      for (const driver of driversRef.current) {
        const event = state.byDriverId[driver.id]
        const animation = renderPositions.current.get(driver.id)
        const position = currentPosition(driver, event, animation, now)
        if (!position) continue
        if (animation && now - animation.startedAt < animation.duration) animating = true
        else if (animation) renderPositions.current.delete(driver.id)
        const point = map.latLngToContainerPoint([position.lat, position.lng])
        if (point.x < -40 || point.y < -40 || point.x > size.x + 40 || point.y > size.y + 40)
          continue
        dots.push({ driver, point, position, event })
      }

      const zoom = map.getZoom()
      const cellSize = zoom < 10 ? 64 : zoom < 12 ? 48 : zoom < 14 ? 34 : 16
      const grouped = new Map<string, Cluster>()
      if (cellSize) {
        for (const dot of dots) {
          const key = `${Math.floor(dot.point.x / cellSize)}:${Math.floor(dot.point.y / cellSize)}`
          const cluster = grouped.get(key)
          if (cluster) cluster.dots.push(dot)
          else grouped.set(key, { key, point: dot.point, dots: [dot] })
        }
      }
      const clusters = cellSize
        ? [...grouped.values()]
        : dots.map((dot) => ({ key: dot.driver.id, point: dot.point, dots: [dot] }))
      const visibleClusters = clusters.flatMap((cluster) => {
        if (cluster.key !== expandedClusterRef.current || cluster.dots.length < 2) return [cluster]
        const count = cluster.dots.length
        const radius = Math.min(72, Math.max(26, count * 2))
        return cluster.dots.map((dot, index) => {
          const angle = (index / count) * Math.PI * 2
          const point = L.point(
            cluster.point.x + Math.cos(angle) * radius,
            cluster.point.y + Math.sin(angle) * radius,
          )
          return {
            key: dot.driver.id,
            point,
            dots: [{ ...dot, point }],
          }
        })
      })
      clustersRef.current = visibleClusters

      for (const cluster of visibleClusters) {
        const count = cluster.dots.length
        if (count > 1) {
          const center = cluster.dots.reduce(
            (sum, dot) => ({ x: sum.x + dot.point.x / count, y: sum.y + dot.point.y / count }),
            { x: 0, y: 0 },
          )
          cluster.point = L.point(center.x, center.y)
          const dominantStatus = cluster.dots.reduce<Record<string, number>>((totals, dot) => {
            totals[dot.driver.status] = (totals[dot.driver.status] ?? 0) + 1
            return totals
          }, {})
          const status =
            Object.entries(dominantStatus).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'AVAILABLE'
          context.beginPath()
          context.arc(center.x, center.y, 21, 0, Math.PI * 2)
          context.fillStyle = colorValues[colors[status] ?? colors.AVAILABLE!] ?? '#31c48d'
          context.fill()
          context.beginPath()
          context.arc(center.x, center.y, 17, 0, Math.PI * 2)
          context.fillStyle = 'rgba(16, 32, 42, 0.94)'
          context.fill()
          context.lineWidth = 2
          context.strokeStyle = '#ffffff'
          context.stroke()
          context.fillStyle = '#ffffff'
          context.font = '700 12px Inter, sans-serif'
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(String(count), center.x, center.y)
          continue
        }

        const dot = cluster.dots[0]
        if (!dot) continue
        const selected = dot.driver.id === selectedRef.current
        const stale =
          !liveRef.current || !dot.event || Date.now() - Date.parse(dot.event.receivedAt) > 180_000
        const radius = selected ? 11 : 9
        context.globalAlpha = stale ? 0.86 : 1
        if (stale) {
          context.beginPath()
          context.arc(dot.point.x, dot.point.y, radius + 6, 0, Math.PI * 2)
          context.setLineDash([3, 2])
          context.strokeStyle = readColor('--color-warning')
          context.lineWidth = 2
          context.stroke()
          context.setLineDash([])
        }
        if (selected && dot.event) {
          const metersPerPixel =
            (40_075_016.686 * Math.cos((dot.position.lat * Math.PI) / 180)) / (256 * 2 ** zoom)
          context.beginPath()
          context.arc(
            dot.point.x,
            dot.point.y,
            Math.min(120, Math.max(radius + 2, dot.event.accuracyM / metersPerPixel)),
            0,
            Math.PI * 2,
          )
          context.fillStyle = 'rgba(45, 212, 191, 0.12)'
          context.fill()
          context.strokeStyle = readColor('--color-primary')
          context.lineWidth = 1
          context.stroke()
          const trail = livePositionTrail(dot.driver.id)
          if (trail.length > 1) {
            context.beginPath()
            trail.forEach((point, index) => {
              const projected = map.latLngToContainerPoint([point.lat, point.lng])
              if (index === 0) context.moveTo(projected.x, projected.y)
              else context.lineTo(projected.x, projected.y)
            })
            context.strokeStyle = readColor('--color-primary')
            context.globalAlpha = 0.72
            context.lineWidth = 3
            context.stroke()
            context.globalAlpha = stale ? 0.86 : 1
          }
        }
        context.beginPath()
        context.arc(dot.point.x, dot.point.y, radius + 3, 0, Math.PI * 2)
        context.fillStyle = 'rgba(5, 12, 18, 0.88)'
        context.fill()
        context.beginPath()
        context.arc(dot.point.x, dot.point.y, radius + 1.5, 0, Math.PI * 2)
        context.fillStyle = '#ffffff'
        context.fill()
        context.beginPath()
        context.arc(dot.point.x, dot.point.y, radius, 0, Math.PI * 2)
        context.fillStyle = colorValues[colors[dot.driver.status] ?? colors.AVAILABLE!] ?? '#31c48d'
        context.fill()
        context.lineWidth = selected ? 2 : 1
        context.strokeStyle = '#10202a'
        context.stroke()
        const heading = dot.event?.headingDeg
        if (heading !== null && heading !== undefined) {
          context.save()
          context.translate(dot.point.x, dot.point.y)
          context.rotate((heading * Math.PI) / 180)
          context.beginPath()
          context.moveTo(0, -radius - 2)
          context.lineTo(-3, -radius + 3)
          context.lineTo(3, -radius + 3)
          context.closePath()
          context.fillStyle = '#10202a'
          context.fill()
          context.restore()
        }
        context.globalAlpha = 1
      }
      if (animating && !document.hidden) frameRef.current = requestAnimationFrame(draw)
    }

    function scheduleDraw() {
      if (!frameRef.current && !document.hidden) frameRef.current = requestAnimationFrame(draw)
    }
    scheduleDrawRef.current = scheduleDraw

    const onMapClick = (event: L.LeafletMouseEvent) => {
      const click = event.containerPoint
      const cluster = [...clustersRef.current]
        .reverse()
        .find((item) => click.distanceTo(item.point) <= (item.dots.length > 1 ? 20 : 12))
      if (!cluster) return
      if (cluster.dots.length === 1) {
        const driver = cluster.dots[0]?.driver
        if (driver) onSelectRef.current(driver.id)
      } else {
        const bounds = L.latLngBounds(
          cluster.dots.map((dot) => [dot.position.lat, dot.position.lng] as L.LatLngTuple),
        )
        if (map.getZoom() >= 17 || bounds.getNorthEast().equals(bounds.getSouthWest())) {
          expandedClusterRef.current = cluster.key
          scheduleDraw()
        } else {
          expandedClusterRef.current = null
          map.fitBounds(bounds, {
            padding: [48, 48],
            maxZoom: Math.min(16, zoomForCluster(map.getZoom())),
          })
        }
      }
    }
    const onVisibilityChange = () => {
      if (document.hidden && frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      } else scheduleDraw()
    }
    const resizeObserver = new ResizeObserver(fitCanvas)
    resizeObserver.observe(map.getContainer())
    map.on('move zoom resize', scheduleDraw)
    map.on('click', onMapClick)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const unsubscribe = useLivePositionStore.subscribe((state, previous) => {
      for (const driver of driversRef.current) {
        const event = state.byDriverId[driver.id]
        const oldEvent = previous.byDriverId[driver.id]
        if (!event || (oldEvent && event.sequence <= oldEvent.sequence)) continue
        const from = currentPosition(
          driver,
          oldEvent,
          renderPositions.current.get(driver.id),
          performance.now(),
        )
        if (!from) continue
        renderPositions.current.set(driver.id, {
          from,
          to: { lat: event.lat, lng: event.lng },
          startedAt: performance.now(),
          duration: document.hidden ? 0 : 800,
        })
      }
      scheduleDraw()
    })
    fitCanvas()

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      resizeObserver.disconnect()
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      map.off('move zoom resize', scheduleDraw)
      map.off('click', onMapClick)
      canvas.remove()
      canvasRef.current = null
      scheduleDrawRef.current = () => {}
      animations.clear()
    }

    function zoomForCluster(currentZoom: number): number {
      return Math.max(currentZoom + 2, 12)
    }
  }, [map])

  return null
}
