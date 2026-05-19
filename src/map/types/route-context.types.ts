export interface RouteContextPlace {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  distanceToRouteKm: number;
  routeProgress: number;
  importance?: number;
}

export interface RouteContextResponse {
  places: RouteContextPlace[];
  diagnostics: {
    routeDistanceKm: number;
    rawPlaces: number;
    filteredPlaces: number;
    beforeDedup: number;
    afterDedup: number;
  };
}

export interface RouteContextDiagnostics {
  rawPlaces: number;
  filteredByDistance: number;
  beforeDedup: number;
  afterDedup: number;
}
