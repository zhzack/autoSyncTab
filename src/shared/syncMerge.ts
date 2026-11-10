import {
  computeContentDigest,
  createId,
  mergeDeletedTombstones,
  pruneDeletedGroups,
} from './storage';
import type {
  AppStoreData,
  SyncConflictItem,
  TabGroup,
  TabItem,
} from './types';

export function areTabsEqual(a: TabItem, b: TabItem): boolean {
  return (
    a.id === b.id &&
    a.url === b.url &&
    a.title === b.title &&
    (a.favIconUrl ?? '') === (b.favIconUrl ?? '') &&
    Boolean(a.pinned) === Boolean(b.pinned)
  );
}

export function areGroupsEqual(a: TabGroup, b: TabGroup): boolean {
  if (
    a.id !== b.id ||
    a.title !== b.title ||
    a.locked !== b.locked ||
    a.tabs.length !== b.tabs.length
  ) {
    return false;
  }
  return a.tabs.every((tab, idx) => areTabsEqual(tab, b.tabs[idx]));
}

export function mergeConflictingGroup(localGroup: TabGroup, remoteGroup: TabGroup): TabGroup {
  const preferRemoteMeta = remoteGroup.updatedAt > localGroup.updatedAt;
  const primary = preferRemoteMeta ? remoteGroup : localGroup;
  const secondary = preferRemoteMeta ? localGroup : remoteGroup;

  const mergedTabs: TabItem[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const tab of [...primary.tabs, ...secondary.tabs]) {
    if (seenUrls.has(tab.url)) continue;
    seenUrls.add(tab.url);
    const resolvedId = seenIds.has(tab.id) ? createId('tab') : tab.id;
    seenIds.add(resolvedId);
    mergedTabs.push(resolvedId === tab.id ? tab : { ...tab, id: resolvedId });
  }

  return {
    id: localGroup.id,
    title: primary.title || secondary.title,
    createdAt: Math.min(localGroup.createdAt, remoteGroup.createdAt),
    updatedAt: Math.max(localGroup.updatedAt, remoteGroup.updatedAt),
    locked: primary.locked || secondary.locked,
    tabs: mergedTabs,
  };
}

export interface ReconcileResult {
  mergedStore: AppStoreData;
  conflicts: SyncConflictItem[];
  hasChangesForLocal: boolean;
  hasChangesForRemote: boolean;
}

export function reconcileStores(
  localStore: AppStoreData,
  remoteStore: AppStoreData,
  lastSyncedAt: number | null,
  now = Date.now()
): ReconcileResult {
  const baseTime = lastSyncedAt ?? 0;
  const hasBaseSync = lastSyncedAt !== null;

  const localGroupMap = new Map(localStore.groups.map((g) => [g.id, g]));
  const remoteGroupMap = new Map(remoteStore.groups.map((g) => [g.id, g]));
  const localDelMap = new Map(localStore.deletedGroups.map((d) => [d.id, d.deletedAt]));
  const remoteDelMap = new Map(remoteStore.deletedGroups.map((d) => [d.id, d.deletedAt]));

  const conflicts: SyncConflictItem[] = [];
  const mergedLocalOrdered: TabGroup[] = [];
  const addedFromRemote: TabGroup[] = [];
  let hasChangesForLocal = false;
  let hasChangesForRemote = false;

  for (const localGroup of localStore.groups) {
    const remoteGroup = remoteGroupMap.get(localGroup.id);
    const remoteDel = remoteDelMap.get(localGroup.id);

    if (remoteGroup) {
      if (areGroupsEqual(localGroup, remoteGroup)) {
        mergedLocalOrdered.push(localGroup);
      } else if (hasBaseSync && localGroup.updatedAt <= baseTime && remoteGroup.updatedAt > baseTime) {
        mergedLocalOrdered.push(remoteGroup);
        hasChangesForLocal = true;
      } else if (hasBaseSync && remoteGroup.updatedAt <= baseTime && localGroup.updatedAt > baseTime) {
        mergedLocalOrdered.push(localGroup);
        hasChangesForRemote = true;
      } else {
        conflicts.push({
          groupId: localGroup.id,
          reason: 'both-modified',
          localGroup,
          remoteGroup,
        });
        mergedLocalOrdered.push(mergeConflictingGroup(localGroup, remoteGroup));
        hasChangesForLocal = true;
        hasChangesForRemote = true;
      }
      continue;
    }

    if (remoteDel !== undefined) {
      if (hasBaseSync && localGroup.updatedAt <= baseTime && remoteDel > baseTime) {
        hasChangesForLocal = true;
      } else if (!hasBaseSync && remoteDel > localGroup.updatedAt) {
        hasChangesForLocal = true;
      } else if (hasBaseSync && localGroup.updatedAt > baseTime && remoteDel > baseTime) {
        conflicts.push({
          groupId: localGroup.id,
          reason: 'local-edited-remote-deleted',
          localGroup,
          remoteGroup: null,
        });
        mergedLocalOrdered.push(localGroup);
        hasChangesForRemote = true;
      } else {
        mergedLocalOrdered.push(localGroup);
        hasChangesForRemote = true;
      }
      continue;
    }

    // Group exists only locally
    mergedLocalOrdered.push(localGroup);
    hasChangesForRemote = true;
  }

  for (const remoteGroup of remoteStore.groups) {
    if (localGroupMap.has(remoteGroup.id)) continue;
    const localDel = localDelMap.get(remoteGroup.id);

    if (localDel !== undefined) {
      if (hasBaseSync && remoteGroup.updatedAt <= baseTime && localDel > baseTime) {
        hasChangesForRemote = true;
      } else if (!hasBaseSync && localDel > remoteGroup.updatedAt) {
        hasChangesForRemote = true;
      } else if (hasBaseSync && remoteGroup.updatedAt > baseTime && localDel > baseTime) {
        conflicts.push({
          groupId: remoteGroup.id,
          reason: 'remote-edited-local-deleted',
          localGroup: null,
          remoteGroup,
        });
        addedFromRemote.push(remoteGroup);
        hasChangesForLocal = true;
      } else {
        addedFromRemote.push(remoteGroup);
        hasChangesForLocal = true;
      }
      continue;
    }

    addedFromRemote.push(remoteGroup);
    hasChangesForLocal = true;
  }

  // Sort newly arrived remote groups newest-first and prepend newer ones while preserving local manual order.
  const sortedRemoteAdditions = [...addedFromRemote].sort((a, b) => b.createdAt - a.createdAt);
  const newestLocalCreatedAt = mergedLocalOrdered[0]?.createdAt ?? 0;
  const newerRemote = sortedRemoteAdditions.filter((g) => g.createdAt >= newestLocalCreatedAt);
  const olderRemote = sortedRemoteAdditions.filter((g) => g.createdAt < newestLocalCreatedAt);
  const mergedGroups = [...newerRemote, ...mergedLocalOrdered, ...olderRemote];

  // Check if local group order differs from remote group order when both sides have the exact same groups
  if (
    !hasChangesForLocal &&
    !hasChangesForRemote &&
    localStore.groups.length === remoteStore.groups.length &&
    localStore.groups.some((g, idx) => remoteStore.groups[idx]?.id !== g.id)
  ) {
    hasChangesForRemote = true;
  }

  const combinedTombstones = mergeDeletedTombstones(
    localStore.deletedGroups,
    remoteStore.deletedGroups,
    now
  );
  const mergedDeletedGroups = pruneDeletedGroups(
    combinedTombstones.filter((del) => {
      const surviving = mergedGroups.find((g) => g.id === del.id);
      return !surviving || del.deletedAt > surviving.updatedAt;
    }),
    now
  );

  const isLocalDirty =
    localStore.sync.lastSyncedHash !== null &&
    computeContentDigest(localStore) !== localStore.sync.lastSyncedHash;

  const settings = !isLocalDirty ? remoteStore.settings : localStore.settings;
  if (
    JSON.stringify(settings) !== JSON.stringify(localStore.settings)
  ) {
    hasChangesForLocal = true;
  }
  if (
    JSON.stringify(settings) !== JSON.stringify(remoteStore.settings)
  ) {
    hasChangesForRemote = true;
  }

  return {
    mergedStore: {
      ...localStore,
      updatedAt: hasChangesForLocal || hasChangesForRemote ? now : localStore.updatedAt,
      groups: mergedGroups,
      deletedGroups: mergedDeletedGroups,
      settings,
    },
    conflicts,
    hasChangesForLocal,
    hasChangesForRemote,
  };
}
