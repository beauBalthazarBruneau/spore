import { listJobs, BOARD_COLUMNS, BOARD_SIDE } from "@/lib/db";
import BoardClient from "./BoardClient";

export const dynamic = "force-dynamic";

export default function BoardPage() {
  const jobs = listJobs([...BOARD_COLUMNS, ...BOARD_SIDE]);
  return <BoardClient initialJobs={jobs} />;
}
