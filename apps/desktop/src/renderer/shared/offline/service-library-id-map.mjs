const getServiceItemLayoutKeyAliases = (item) => [
  [item.type, item.refId, item.addedAt, item.groupId ?? "standalone"].join(":"),
  [
    item.type,
    item.refId,
    item.addedAt,
    item.groupId ?? "standalone",
    item.label ?? "",
  ].join(":"),
  [item.type, item.refId, item.addedAt, item.label ?? ""].join(":"),
];

/**
 * Rewrites library IDs everywhere they are embedded in a service. Service
 * layout keys include refId, so changing only items[].refId breaks ordering
 * and makes the item impossible to match when the service is read again.
 */
export function remapServiceLibraryItemIds(service, idBySourceId) {
  const layoutKeyBySourceKey = new Map();
  let didChange = false;
  const items = (Array.isArray(service.items) ? service.items : []).map((item) => {
    if (item.type !== "library") {
      return item;
    }

    const mappedRefId = idBySourceId[item.refId];
    if (!mappedRefId || mappedRefId === item.refId) {
      return item;
    }

    const mappedItem = { ...item, refId: mappedRefId };
    didChange = true;
    const sourceAliases = getServiceItemLayoutKeyAliases(item);
    const mappedAliases = getServiceItemLayoutKeyAliases(mappedItem);
    sourceAliases.forEach((sourceKey, index) => {
      layoutKeyBySourceKey.set(sourceKey, mappedAliases[index]);
    });
    return mappedItem;
  });

  const layout = (Array.isArray(service.layout) ? service.layout : []).map((entry) => {
    if (entry.type !== "item" || !layoutKeyBySourceKey.has(entry.key)) {
      return entry;
    }
    didChange = true;
    return { ...entry, key: layoutKeyBySourceKey.get(entry.key) };
  });

  return didChange ? { ...service, items, layout } : service;
}
