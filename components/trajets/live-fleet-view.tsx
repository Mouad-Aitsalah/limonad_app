"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFleetTracking } from "@/hooks/use-fleet-tracking";
import { LiveFleetPanel } from "@/components/trajets/live-fleet-panel";

const LiveFleetMap = dynamic(
  () => import("@/components/trajets/live-fleet-map").then((module) => ({ default: module.LiveFleetMap })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[560px] rounded-[26px] bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] sm:h-[680px]" />
    ),
  },
);

/**
 * Admin live fleet monitoring - the "C. monitoring" surface. Owns the
 * polling loop (useFleetTracking -> GET /api/trucks/live, every ~7s) and
 * the selection/"Suivre" follow-mode state machine; the map and panel
 * below are purely presentational given this state.
 */
export function LiveFleetView() {
  const { trucks, loading, error, refresh } = useFleetTracking();
  const [selectedTruckId, setSelectedTruckId] = React.useState<string | null>(null);
  const [followedTruckId, setFollowedTruckId] = React.useState<string | null>(null);
  const [followPaused, setFollowPaused] = React.useState(false);

  function handleSelectTruck(truckId: string) {
    setSelectedTruckId(truckId);
  }

  function handleFollow(truckId: string) {
    setSelectedTruckId(truckId);
    setFollowedTruckId(truckId);
    setFollowPaused(false);
  }

  function handleUnfollow() {
    setFollowedTruckId(null);
    setFollowPaused(false);
  }

  function handleManualPan() {
    if (followedTruckId) {
      setFollowPaused(true);
    }
  }

  function handleResumeFollow() {
    setFollowPaused(false);
  }

  // A followed truck that drops out of the live snapshot (tour ended) can't
  // keep being followed - derived at render time rather than reset via an
  // effect, so there is no separate "cleanup" state to fall out of sync.
  const followedTruckStillLive =
    followedTruckId !== null && trucks.some((truck) => truck.truckId === followedTruckId);
  const effectiveFollowedTruckId = followedTruckStillLive ? followedTruckId : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
      <Card className="surface-card overflow-hidden py-0">
        <CardHeader className="border-b border-border/70 px-6 py-5">
          <div>
            <CardTitle>Carte en direct</CardTitle>
            <CardDescription>
              Position GPS actuelle de chaque camion en tournee, mise a jour automatiquement.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <LiveFleetMap
            trucks={trucks}
            selectedTruckId={selectedTruckId}
            onSelectTruck={handleSelectTruck}
            isFollowing={Boolean(effectiveFollowedTruckId) && !followPaused}
            onManualPan={handleManualPan}
          />
        </CardContent>
      </Card>

      <LiveFleetPanel
        trucks={trucks}
        loading={loading}
        error={error}
        selectedTruckId={selectedTruckId}
        onSelectTruck={handleSelectTruck}
        followedTruckId={effectiveFollowedTruckId}
        followPaused={followPaused}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        onResumeFollow={handleResumeFollow}
        onRefresh={() => void refresh()}
      />
    </div>
  );
}
