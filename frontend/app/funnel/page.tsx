import { getFunnelReport, type FunnelDay } from "@/lib/db";

export const dynamic = "force-dynamic";

function sum(days: FunnelDay[], key: keyof FunnelDay): number {
  return days.reduce((n, d) => n + (d[key] as number), 0);
}

export default function FunnelPage() {
  const { days, top_filter_reasons } = getFunnelReport();

  const cols: { key: keyof FunnelDay; label: string }[] = [
    { key: "date", label: "Date" },
    { key: "fetched", label: "Fetched" },
    { key: "duped", label: "Duped" },
    { key: "hard_filtered", label: "Hard filtered" },
    { key: "prescored", label: "Prescored" },
    { key: "to_review", label: "To review" },
    { key: "approved", label: "Approved" },
    { key: "rejected_by_user", label: "Rejected" },
    { key: "skipped", label: "Skipped" },
  ];

  const numericCols = cols.filter((c) => c.key !== "date");

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Pipeline funnel</h1>
      <p className="text-sm text-zinc-400 mb-6">Last 7 days, bucketed by discovered_at</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-zinc-400 text-left">
              {cols.map((c) => (
                <th key={c.key} className="py-2 pr-4 font-medium whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-b border-zinc-800">
                {cols.map((c) => (
                  <td key={c.key} className="py-2 pr-4 tabular-nums">
                    {c.key === "date" ? (
                      <span className="text-zinc-300">{day.date}</span>
                    ) : (
                      <span className={day[c.key] === 0 ? "text-zinc-600" : ""}>
                        {day[c.key] as number}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="py-4 text-zinc-500 text-center">
                  No data yet
                </td>
              </tr>
            )}
          </tbody>
          {days.length > 0 && (
            <tfoot>
              <tr className="border-t border-zinc-600 text-zinc-300 font-medium">
                <td className="py-2 pr-4">Total</td>
                {numericCols.map((c) => (
                  <td key={c.key} className="py-2 pr-4 tabular-nums">
                    {sum(days, c.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {top_filter_reasons.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3">Top filter reasons</h2>
          <table className="w-full text-sm max-w-md">
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-400 text-left">
                <th className="py-2 pr-4 font-medium">Reason</th>
                <th className="py-2 font-medium text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {top_filter_reasons.map((r) => (
                <tr key={r.reason} className="border-b border-zinc-800">
                  <td className="py-2 pr-4 text-zinc-300">{r.reason}</td>
                  <td className="py-2 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
