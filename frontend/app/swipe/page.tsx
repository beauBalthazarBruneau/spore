import { listJobs } from "@/lib/db";
import SwipeClient from "./SwipeClient";

export const dynamic = "force-dynamic";

export default function SwipePage() {
  const jobs = listJobs("new");
  return <SwipeClient initialJobs={jobs} />;
}
