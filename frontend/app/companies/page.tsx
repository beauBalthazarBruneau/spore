import { listCompanies } from "@/lib/db";
import CompaniesClient from "./CompaniesClient";

export const dynamic = "force-dynamic";

export default function CompaniesPage() {
  return <CompaniesClient initial={listCompanies({ includeArchived: false })} />;
}
