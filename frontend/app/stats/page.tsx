import { statusCounts } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function StatsPage() {
  const counts = statusCounts();
  const total = counts.reduce((n, c) => n + c.n, 0);
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">Stats</h1>
      <div className="text-sm text-zinc-400 mb-3">{total} jobs total</div>
      <table className="w-full text-sm">
        <tbody>
          {counts.sort((a, b) => b.n - a.n).map((c) => (
            <tr key={c.status} className="border-b border-zinc-800">
              <td className="py-2">{c.status}</td>
              <td className="py-2 text-right">{c.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
