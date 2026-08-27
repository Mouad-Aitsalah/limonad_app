export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type GoogleRouteDto = {
  distanceMeters: number;
  durationSeconds: number | null;
  polyline: MapCoordinate[];
};
