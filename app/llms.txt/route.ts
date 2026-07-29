export const dynamic = "force-static";

export function GET() {
  return new Response(
    [
      "# RemHaos",
      "",
      "RemHaos is an AI-assisted pre-sale workflow for interior designers and studios in Russia.",
      "Canonical host: https://remhaos.com",
      "",
      "Public routes:",
      "- https://remhaos.com/",
      "- https://remhaos.com/demo",
      "- https://remhaos.com/demo/brief",
      "- https://remhaos.com/demo/proposal",
      "- https://remhaos.com/designers",
      "- https://remhaos.com/studios",
      "- https://remhaos.com/pilot",
      "- https://remhaos.com/security",
      "",
      "Private, auth, intake-token and proposal-token routes are not intended for indexing.",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
