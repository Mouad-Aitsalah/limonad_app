import { redirect } from "next/navigation";

// "Mon camion" was folded into the /driver home screen - this route is kept
// only so old links/bookmarks land somewhere useful instead of a 404.
export default function DriverTruckRedirectPage() {
  redirect("/driver");
}
