import { Badge } from './Badge'
import type {
  AlertSeverity,
  DriverStatus,
  ShipmentStatus,
  ZoneType,
} from '../../theme/domain-colors'
import { getStatusColor } from '../../theme/domain-colors'

type StatusPillProps =
  | { category: 'driver'; status: DriverStatus; label?: string }
  | { category: 'shipment'; status: ShipmentStatus; label?: string }
  | { category: 'alert'; status: AlertSeverity; label?: string }
  | { category: 'zone'; status: ZoneType; label?: string }

export function StatusPill({
  category,
  status,
  label = status.toLowerCase().replaceAll('_', ' '),
}: StatusPillProps) {
  return (
    <Badge className={`border-0 capitalize ring-1 ring-inset ${getStatusColor(category, status)}`}>
      {label}
    </Badge>
  )
}
