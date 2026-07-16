import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() || "KB7VPWHTTM";
  const appId = teamId ? `${teamId}.space.arhidom.ios` : null;

  return NextResponse.json(
    {
      applinks: {
        details: appId
          ? [
              {
                appIDs: [appId],
                components: [
                  { "/": "/auth/callback*", comment: "Authentication callbacks" },
                  { "/": "/i/*", comment: "Client intake links" },
                  { "/": "/p/*", comment: "Proposal links" },
                  { "/": "/room/*", comment: "Project room links" },
                ],
              },
            ]
          : [],
      },
      webcredentials: { apps: appId ? [appId] : [] },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Content-Type": "application/json",
      },
    },
  );
}
