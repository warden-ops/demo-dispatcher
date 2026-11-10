import "server-only";
import { NextResponse } from "next/server";
import { readCustomersResponse } from "@/lib/netsuite/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readCustomersResponse();
  return NextResponse.json(result.body, { status: result.status });
}
