"use client";

import * as React from "react";
import { Marker, TileLayer, useMap, useMapEvents, MapContainer, ZoomControl } from "react-leaflet";
import { divIcon, type LatLngExpression, type LeafletEvent } from "leaflet";

import { DEFAULT_MAP_CENTER } from "@/lib/gps/gps-config";

const defaultCenter = DEFAULT_MAP_CENTER as LatLngExpression;

const customerLocationIcon = divIcon({
  className: "",
  html: `
    <span class="customer-location-picker-marker">
      <span class="customer-location-picker-marker__dot"></span>
    </span>
  `,
  iconSize: [28, 40],
  iconAnchor: [14, 36],
});

type CustomerLocationPickerMapProps = {
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  selectedPosition: { latitude: number; longitude: number } | null;
  onSelect: (position: { latitude: number; longitude: number }) => void;
};

export function CustomerLocationPickerMap({
  initialLatitude,
  initialLongitude,
  selectedPosition,
  onSelect,
}: CustomerLocationPickerMapProps) {
  const mapCenter = selectedPosition
    ? ([selectedPosition.latitude, selectedPosition.longitude] as LatLngExpression)
    : initialLatitude !== null &&
        initialLatitude !== undefined &&
        initialLongitude !== null &&
        initialLongitude !== undefined
      ? ([initialLatitude, initialLongitude] as LatLngExpression)
      : defaultCenter;

  return (
    <MapContainer center={mapCenter} zoom={selectedPosition ? 16 : 13} zoomControl={false} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="bottomleft" />

      <MapClickHandler selectedPosition={selectedPosition} onSelect={onSelect} />
      <MapViewportController selectedPosition={selectedPosition} />

      {selectedPosition ? (
        <Marker
          position={[selectedPosition.latitude, selectedPosition.longitude]}
          icon={customerLocationIcon}
          draggable
          eventHandlers={{
            dragend: (event: LeafletEvent) => {
              const target = event.target as { getLatLng: () => { lat: number; lng: number } };
              const latLng = target.getLatLng();
              onSelect({
                latitude: latLng.lat,
                longitude: latLng.lng,
              });
            },
          }}
        />
      ) : null}
    </MapContainer>
  );
}

function MapClickHandler({
  selectedPosition,
  onSelect,
}: {
  selectedPosition: { latitude: number; longitude: number } | null;
  onSelect: (position: { latitude: number; longitude: number }) => void;
}) {
  useMapEvents({
    click(event) {
      onSelect({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    },
  });

  return selectedPosition ? null : null;
}

function MapViewportController({
  selectedPosition,
}: {
  selectedPosition: { latitude: number; longitude: number } | null;
}) {
  const map = useMap();
  const lastPositionRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!selectedPosition) {
      return;
    }

    const key = `${selectedPosition.latitude}:${selectedPosition.longitude}`;
    if (lastPositionRef.current === key) {
      return;
    }

    lastPositionRef.current = key;
    map.flyTo([selectedPosition.latitude, selectedPosition.longitude], Math.max(map.getZoom(), 16), {
      animate: true,
      duration: 0.6,
    });
  }, [map, selectedPosition]);

  return null;
}
