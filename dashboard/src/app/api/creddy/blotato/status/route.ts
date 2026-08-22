import { requireRole } from "@/lib/auth";
import { syncCreddyBlotatoStatuses } from "@/lib/creddy-blotato-sync";

export async function GET() {
  await requireRole("viewer");
  const result = await syncCreddyBlotatoStatuses();
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
