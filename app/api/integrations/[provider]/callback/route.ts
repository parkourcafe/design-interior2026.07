import { NextRequest } from "next/server";
import { GET as oauthCallbackGet } from "../oauth/callback/route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/integrations/[provider]/callback">,
) {
  return oauthCallbackGet(request, { params: context.params });
}
