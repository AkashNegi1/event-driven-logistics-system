export class TrackingResponseDto {
  orderId: string;
  shipmentId: string;
  status:
    | 'PENDING'
    | 'PICKED_UP'
    | 'IN_TRANSIT'
    | 'ARRIVING_SOON'
    | 'DELIVERED'
    | 'FAILED';
  driver: {
    id: string;
    name: string;
    vehicleId: string;
  } | null;
  pickup: {
    label: string;
    lat: number;
    lng: number;
  };
  destination: {
    label: string;
    lat: number;
    lng: number;
  };
  currentLocation: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    timestamp: number;
  } | null;
  eta: string | null;
}
