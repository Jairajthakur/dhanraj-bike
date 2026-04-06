import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "fos_allocations_cache";
const CACHE_META_KEY = "fos_allocations_meta";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CachedAllocation {
  id: number;
  loan_no: string;
  app_id: string;
  customer_name: string;
  registration_no: string;
  chassis_no: string;
  asset_make: string;
  bkt: string;
  pos: number;
  status: string;
  emi: number;
  emi_due: number;
  cbc: number;
  lpp: number;
  cbc_lpp: number;
  customer_address: string;
  first_emi_due_date: string;
  loan_maturity_date: string;
  engine_no: string;
  ten: string;
  number: string;
  detail_fb: string;
}

export interface CacheMeta {
  lastSynced: number; // timestamp
  count: number;
}

/** Save all allocations to device storage */
export async function saveAllocationsToCache(allocations: CachedAllocation[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(allocations));
  const meta: CacheMeta = { lastSynced: Date.now(), count: allocations.length };
  await AsyncStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
}

/** Load all cached allocations */
export async function loadAllocationsFromCache(): Promise<CachedAllocation[]> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as CachedAllocation[];
}

/** Get cache metadata (last sync time, count) */
export async function getCacheMeta(): Promise<CacheMeta | null> {
  const raw = await AsyncStorage.getItem(CACHE_META_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as CacheMeta;
}

/** Returns true if cache exists and is still fresh (< 6 hours old) */
export async function isCacheFresh(): Promise<boolean> {
  const meta = await getCacheMeta();
  if (!meta) return false;
  return Date.now() - meta.lastSynced < CACHE_TTL_MS;
}

/** Search cache by registration number (partial, case-insensitive) */
export function searchByReg(allocations: CachedAllocation[], query: string): CachedAllocation[] {
  const q = query.toUpperCase().trim();
  return allocations.filter((a) =>
    a.registration_no?.toUpperCase().includes(q)
  );
}

/** Search cache by chassis number (partial, case-insensitive) */
export function searchByChassis(allocations: CachedAllocation[], query: string): CachedAllocation[] {
  const q = query.toUpperCase().trim();
  return allocations.filter((a) =>
    a.chassis_no?.toUpperCase().includes(q)
  );
}

/** Find a single allocation by ID from cache */
export function findById(allocations: CachedAllocation[], id: number): CachedAllocation | null {
  return allocations.find((a) => a.id === id) ?? null;
}

/** Clear the cache (e.g. on logout) */
export async function clearCache(): Promise<void> {
  await AsyncStorage.multiRemove([CACHE_KEY, CACHE_META_KEY]);
}
