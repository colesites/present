export declare const MIRRORED_PREFIXES: string[];
export declare const EXCLUDED_KEYS: Set<string>;
export declare function isMirroredStorageKey(key: string): boolean;
export declare function planStorageStart(state: {
  initialized: boolean;
  firstWindow: boolean;
  storeItems: Record<string, string>;
  localItems: Record<string, string>;
}): {
  importItems: Record<string, string> | null;
  importFromElectron: boolean;
  set: Array<[string, string]>;
  remove: string[];
};
