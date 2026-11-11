import { NextResponse } from "next/server";
import { planDispatch } from "@/lib/guertech/plan";
import type { Appel, Tech } from "@/lib/guertech/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const calls = Array.isArray(record.calls) ? (record.calls as Appel[]) : [];
  const techs = Array.isArray(record.techs) ? (record.techs as Tech[]) : [];
  const date = typeof record.date === "string" ? record.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  }
  if (calls.length === 0 || calls.length > 800 || techs.length > 40) {
    return NextResponse.json(
      { error: "La demande doit contenir entre 1 et 800 appels, et au plus 40 techniciens." },
      { status: 400 },
    );
  }

  const durations = record.durations as { preventif?: unknown; reactif?: unknown } | undefined;
  const plan = await planDispatch({
    calls,
    techs,
    startDate: date,
    horizonDays: Math.min(10, Math.max(1, Math.round(asNumber(record.horizonDays, 5)))),
    pmQuotaPerDay: Math.min(80, Math.max(0, Math.round(asNumber(record.pmQuota, 40)))),
    durations: {
      preventif: asNumber(durations?.preventif, 60),
      reactif: asNumber(durations?.reactif, 90),
    },
    allowOvertime: record.allowOvertime === true,
    moveAssigned: record.moveAssigned === true,
    env: process.env,
  });
  return NextResponse.json(plan);
}
