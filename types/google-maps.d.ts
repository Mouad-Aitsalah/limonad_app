export {};

declare global {
  interface Window {
    google?: GoogleMapsApi;
    __comdisGoogleMapsInit?: () => void;
  }

  type GoogleMapsLatLngLiteral = {
    lat: number;
    lng: number;
  };

  type GoogleMapsLatLngBoundsLiteral = {
    north: number;
    south: number;
    east: number;
    west: number;
  };

  type GoogleMapsSymbol = {
    path: number;
    scale?: number;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeWeight?: number;
  };

  type GoogleMapsIcon = {
    url: string;
    scaledSize?: unknown;
    anchor?: unknown;
  };

  type GoogleMapsAdvancedMarkerOptions = {
    map?: GoogleMapsMap | null;
    position?: GoogleMapsLatLngLiteral | null;
    content?: Node | null;
    title?: string;
    zIndex?: number | null;
    gmpDraggable?: boolean;
  };

  /**
   * `map`, `position` and `content` are plain settable properties on
   * AdvancedMarkerElement (unlike legacy Marker's setMap/setPosition/setIcon
   * methods) — that is the API shape Google Maps actually exposes.
   */
  type GoogleMapsAdvancedMarker = {
    map: GoogleMapsMap | null;
    position: GoogleMapsLatLngLiteral | null;
    content: Node | null;
    zIndex: number | null;
    addListener(eventName: string, handler: () => void): GoogleMapsListener;
  };

  type GoogleMapsMarkerLibrary = {
    AdvancedMarkerElement: new (
      options: GoogleMapsAdvancedMarkerOptions,
    ) => GoogleMapsAdvancedMarker;
  };

  type GoogleMapsApi = {
    maps: {
      Map: new (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => GoogleMapsMap;
      Marker: new (options: Record<string, unknown>) => GoogleMapsMarker;
      Polyline: new (options: Record<string, unknown>) => GoogleMapsPolyline;
      Circle: new (options: Record<string, unknown>) => GoogleMapsCircle;
      InfoWindow: new (options?: Record<string, unknown>) => GoogleMapsInfoWindow;
      LatLngBounds: new () => GoogleMapsLatLngBounds;
      Size: new (width: number, height: number) => unknown;
      Point: new (x: number, y: number) => unknown;
      SymbolPath: { CIRCLE: number };
      event: {
        clearListeners(instance: unknown, eventName: string): void;
      };
      importLibrary(name: "marker"): Promise<GoogleMapsMarkerLibrary>;
      importLibrary(name: string): Promise<unknown>;
    };
  };

  type GoogleMapsMap = {
    panTo(position: GoogleMapsLatLngLiteral): void;
    setCenter(position: GoogleMapsLatLngLiteral): void;
    setZoom(zoom: number): void;
    getZoom(): number | undefined;
    fitBounds(bounds: GoogleMapsLatLngBounds | GoogleMapsLatLngBoundsLiteral): void;
    addListener(eventName: string, handler: () => void): GoogleMapsListener;
  };

  type GoogleMapsMarker = {
    setMap(map: GoogleMapsMap | null): void;
    setPosition(position: GoogleMapsLatLngLiteral): void;
    setIcon(icon: GoogleMapsSymbol | GoogleMapsIcon | string | null): void;
    addListener(eventName: string, handler: () => void): GoogleMapsListener;
  };

  type GoogleMapsPolyline = {
    setMap(map: GoogleMapsMap | null): void;
  };

  type GoogleMapsCircle = {
    setMap(map: GoogleMapsMap | null): void;
    setCenter(position: GoogleMapsLatLngLiteral): void;
    setRadius(radius: number): void;
  };

  type GoogleMapsInfoWindow = {
    setContent(content: string): void;
    setPosition(position: GoogleMapsLatLngLiteral): void;
    open(options: {
      map: GoogleMapsMap;
      anchor?: GoogleMapsMarker | GoogleMapsAdvancedMarker;
    }): void;
  };

  type GoogleMapsLatLngBounds = {
    extend(position: GoogleMapsLatLngLiteral): void;
  };

  type GoogleMapsListener = {
    remove(): void;
  };
}
