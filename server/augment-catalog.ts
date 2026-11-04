// Only expose fields needed for the encyclopedia and champion-description tooltips.
// Recommendation lists are provider data, not champion-specific win-rate estimates.
export function augmentCatalogView(envelope: any) {
  const positiveId = (id: any) => Number.isInteger(id) && id > 0;
  return {
    version: envelope?.meta?.dataVersion ?? null,
    downloadedAt: envelope?.cache?.downloadedAt ?? null,
    data: Array.isArray(envelope?.data)
      ? envelope.data
          .filter((a: any) => positiveId(a?.id))
          .map((a: any) => ({
            id: a.id,
            name:
              typeof a.name === "string" && a.name.trim()
                ? a.name
                : `증강 ${a.id}`,
            iconUrl: typeof a.iconUrl === "string" ? a.iconUrl : null,
            rarityName: ["silver", "gold", "prismatic"].includes(a.rarityName)
              ? a.rarityName
              : null,
            rarityDisplayName:
              typeof a.rarityDisplayName === "string"
                ? a.rarityDisplayName
                : null,
            description:
              typeof a.description === "string" ? a.description : null,
            tooltip: typeof a.tooltip === "string" ? a.tooltip : null,
            topChampions: Array.isArray(a.topChampions)
              ? [
                  ...new Map(
                    a.topChampions
                      .filter((c: any) => positiveId(c?.id))
                      .map((c: any) => [
                        c.id,
                        {
                          id: c.id,
                          name:
                            typeof c.name === "string" && c.name.trim()
                              ? c.name
                              : `챔피언 ${c.id}`,
                          iconUrl:
                            typeof c.iconUrl === "string" ? c.iconUrl : null,
                        },
                      ]),
                  ).values(),
                ]
              : [],
          }))
      : [],
  };
}
