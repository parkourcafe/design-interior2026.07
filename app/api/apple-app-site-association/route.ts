import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const IOS_BUNDLE_ID = "space.arhidom.ios";

export async function GET() {
  const appleTeamId = process.env.APPLE_TEAM_ID?.trim() || "KB7VPWHTTM";
  const appId = `${appleTeamId}.${IOS_BUNDLE_ID}`;

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: [
              { "/": "/auth/callback*", comment: "Authentication callbacks" },
              { "/": "/app*", comment: "Authenticated mobile entry" },
              { "/": "/dashboard*", comment: "Legacy authenticated workspace" },
              { "/": "/projectceo/*", comment: "Project workspace and guest access" },
              { "/": "/i/*", comment: "Client intake links" },
              { "/": "/p/*", comment: "Proposal links" },
              { "/": "/room/*", comment: "Project room links" },
            ],
          },
        ],
      },
      webcredentials: { apps: [appId] },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "Content-Type": "application/json",
      },
    },
  );
}
