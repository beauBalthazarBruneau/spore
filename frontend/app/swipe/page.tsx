import { listJobs, listNearMisses } from "@/lib/db";
import SwipeClient from "./SwipeClient";

export const dynamic = "force-dynamic";

export default function SwipePage() {
  const jobs = listJobs("new");
  const nearMisses = listNearMisses(15);
  return <SwipeClient initialJobs={jobs} nearMisses={nearMisses} />;
}
