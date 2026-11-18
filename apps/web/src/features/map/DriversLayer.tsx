import type { DriverPositionEvent } from '@routecommand/shared'
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

import { DriversCanvasLayer } from './DriversCanvasLayer'
import type { Driver } from '../drivers/api/client'
import { livePositionTrail, useLivePositionStore } from '../realtime/store/live-position-store'

type MarkerEntry = {
  marker: L.Marker
  accuracy: L.Circle | null
  trail: L.Polyline
  driver: Driver
  lastPosition: DriverPositionEvent | null
  from: L.LatLng | null
  target: L.LatLng | null
  startedAt: number
  duration: number
}

const statusColor: Record<string, string> = {
  AVAILABLE: 'var(--color-driver-available)',
  BUSY: 'var(--color-driver-busy)',
  OFFLINE: 'var(--color-driver-offline)',
  ON_BREAK: 'var(--color-driver-break)',
}

function positionFor(driver: Driver, event: DriverPositionEvent | undefined): L.LatLng | null {
  if (event) return L.latLng(event.lat, event.lng)
  if (driver.lat !== null && driver.lng !== null) return L.latLng(driver.lat, driver.lng)
  return null
}

function driverIcon(driver: Driver, event: DriverPositionEvent | null, stale: boolean) {
  const color = statusColor[driver.status] ?? 'var(--color-neutral)'
  const angle = Number.isFinite(event?.headingDeg) ? event!.headingDeg! : 0
  return L.divIcon({
    className: 'driver-map-icon-shell',
    html: `<span class="driver-map-icon ${stale ? 'is-stale' : ''}" style="--driver-marker-color:${color}"><span class="driver-map-arrow" style="transform:rotate(${angle}deg)">▲</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function tooltipContent(driver: Driver, event: DriverPositionEvent | null, stale: boolean) {
  const content = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = driver.name
  const detail = document.createElement('div')
  const seen = event?.receivedAt ?? driver.lastSeenAt
  detail.textContent = `${driver.status.replaceAll('_', ' ')} · ${stale ? 'signal lost' : 'live'}${seen ? ` · ${new Date(seen).toLocaleTimeString()}` : ''}`
  content.append(title, detail)
  return content
}

function interpolate(entries: Map<string, MarkerEntry>, now: number): boolean {
  let moving = false
  for (const entry of entries.values()) {
    if (!entry.target || !entry.from) continue
    const progress =
      entry.duration === 0 ? 1 : Math.min(1, (now - entry.startedAt) / entry.duration)
    const point = L.latLng(
      entry.from.lat + (entry.target.lat - entry.from.lat) * progress,
      entry.from.lng + (entry.target.lng - entry.from.lng) * progress,
    )
    entry.marker.setLatLng(point)
    if (entry.accuracy) entry.accuracy.setLatLng(point)
    if (progress < 1) moving = true
  }
  return moving
}

export function DriversLayer(props: {
  drivers: Driver[]
  selectedDriverId: string | null
  onSelect: (driverId: string) => void
  live: boolean
}) {
  if (props.drivers.length >= 120) return <DriversCanvasLayer {...props} />
  return <DomDriversLayer {...props} />
}

function DomDriversLayer({
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
  const entries = useRef(new Map<string, MarkerEntry>())
  const selected = useRef(selectedDriverId)
  const selectHandler = useRef(onSelect)
  const liveRef = useRef(live)
  const animationFrame = useRef(0)

  useEffect(() => {
    selected.current = selectedDriverId
    for (const [driverId, entry] of entries.current) {
      const event = entry.lastPosition
      if (driverId === selectedDriverId && event) {
        entry.accuracy ??= L.circle(entry.marker.getLatLng(), {
          radius: Math.max(0, event.accuracyM),
          color: 'var(--color-primary)',
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(map)
        entry.accuracy.setLatLng(entry.marker.getLatLng()).setRadius(Math.max(0, event.accuracyM))
      } else if (entry.accuracy) {
        map.removeLayer(entry.accuracy)
        entry.accuracy = null
      }
    }
  }, [map, selectedDriverId])

  useEffect(() => {
    selectHandler.current = onSelect
    liveRef.current = live
  }, [onSelect, live])

  useEffect(() => {
    const positions = useLivePositionStore.getState().byDriverId
    const activeIds = new Set(drivers.map((driver) => driver.id))
    for (const [driverId, entry] of entries.current) {
      if (activeIds.has(driverId)) continue
      map.removeLayer(entry.marker)
      map.removeLayer(entry.trail)
      if (entry.accuracy) map.removeLayer(entry.accuracy)
      entries.current.delete(driverId)
    }

    for (const driver of drivers) {
      const event = positions[driver.id]
      const location = positionFor(driver, event)
      if (!location) continue
      const stale =
        !liveRef.current || !event || Date.now() - Date.parse(event.receivedAt) > 180_000
      let entry = entries.current.get(driver.id)
      if (!entry) {
        const marker = L.marker(location, {
          icon: driverIcon(driver, event ?? null, stale),
          opacity: live ? (stale ? 0.88 : 1) : 0.72,
        })
        const trail = L.polyline([], {
          color: 'var(--color-primary)',
          weight: 3,
          opacity: 0.55,
          lineCap: 'round',
        })
        entry = {
          marker,
          accuracy: null,
          trail,
          driver,
          lastPosition: event ?? null,
          from: location,
          target: location,
          startedAt: 0,
          duration: 0,
        }
        marker.on('click', () => selectHandler.current(driver.id))
        marker.bindTooltip(tooltipContent(driver, event ?? null, stale))
        marker.addTo(map)
        trail.addTo(map)
        entries.current.set(driver.id, entry)
      } else {
        entry.driver = driver
        entry.marker.setIcon(driverIcon(driver, event ?? null, stale))
        entry.marker.setOpacity(liveRef.current ? (stale ? 0.88 : 1) : 0.72)
        if (event && entry.lastPosition?.sequence !== event.sequence) {
          entry.from = entry.marker.getLatLng()
          entry.target = location
          entry.startedAt = performance.now()
          entry.duration = document.hidden ? 0 : 800
          entry.lastPosition = event
        }
      }
      entry.marker.setTooltipContent(tooltipContent(driver, event ?? null, stale))
      if (driver.id === selected.current) {
        const points = livePositionTrail(driver.id)
          .filter((point) => Date.now() - Date.parse(point.receivedAt) <= 10 * 60_000)
          .map((point) => L.latLng(point.lat, point.lng))
        entry.trail.setLatLngs(points)
      } else {
        entry.trail.setLatLngs([])
      }
      if (driver.id === selected.current && event) {
        entry.accuracy ??= L.circle(location, {
          radius: Math.max(0, event.accuracyM),
          color: 'var(--color-primary)',
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(map)
      }
    }

    const animate = (now: number) => {
      if (!document.hidden) {
        if (interpolate(entries.current, now))
          animationFrame.current = requestAnimationFrame(animate)
        else animationFrame.current = 0
      }
    }
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current)
    if ([...entries.current.values()].some((entry) => entry.duration > 0)) {
      animationFrame.current = requestAnimationFrame(animate)
    }
    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current)
      animationFrame.current = 0
    }
  }, [drivers, map, selectedDriverId, live])

  useEffect(() => {
    const unsubscribe = useLivePositionStore.subscribe(() => {
      const positions = useLivePositionStore.getState().byDriverId
      for (const [driverId, entry] of entries.current) {
        const event = positions[driverId]
        if (!event || (entry.lastPosition && event.sequence <= entry.lastPosition.sequence))
          continue
        entry.from = entry.marker.getLatLng()
        entry.target = L.latLng(event.lat, event.lng)
        entry.startedAt = performance.now()
        entry.duration = document.hidden ? 0 : 800
        entry.lastPosition = event
        if (driverId === selected.current) {
          const points = livePositionTrail(driverId)
            .filter((point) => Date.now() - Date.parse(point.receivedAt) <= 10 * 60_000)
            .map((point) => L.latLng(point.lat, point.lng))
          entry.trail.setLatLngs(points)
        }
        if (driverId === selected.current) {
          entry.accuracy ??= L.circle(entry.marker.getLatLng(), {
            radius: Math.max(0, event.accuracyM),
            color: 'var(--color-primary)',
            weight: 1,
            fillOpacity: 0.08,
          }).addTo(map)
          entry.accuracy.setRadius(Math.max(0, event.accuracyM))
        }
        entry.marker.setIcon(driverIcon(entry.driver, event, false))
        entry.marker.setOpacity(liveRef.current ? 1 : 0.72)
        entry.marker.setTooltipContent(tooltipContent(entry.driver, event, !liveRef.current))
      }
      if (!document.hidden && [...entries.current.values()].some((entry) => entry.duration > 0)) {
        if (animationFrame.current) cancelAnimationFrame(animationFrame.current)
        const animate = (now: number) => {
          if (interpolate(entries.current, now) && !document.hidden) {
            animationFrame.current = requestAnimationFrame(animate)
          } else {
            animationFrame.current = 0
          }
        }
        animationFrame.current = requestAnimationFrame(animate)
      } else {
        interpolate(entries.current, performance.now())
      }
    })
    return () => unsubscribe()
  }, [map])

  useEffect(
    () => () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current)
      for (const entry of entries.current.values()) {
        map.removeLayer(entry.marker)
        map.removeLayer(entry.trail)
        if (entry.accuracy) map.removeLayer(entry.accuracy)
        entry.marker.off()
      }
      entries.current.clear()
    },
    [map],
  )

  return null
}
