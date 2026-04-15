import { getProfile } from "@/lib/db";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <ProfileClient initial={getProfile()} />;
}
