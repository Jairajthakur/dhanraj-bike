import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "fos_allocations_cache";
const CACHE_META_KEY = "fos_allocations_meta";
const REPO_CACHE_KEY = "repo_allocations_cache";
const REPO_CACHE_META_KEY = "repo_allocations_meta";
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
  lastSynced: number;
  count: number;
}

// ─── FOS Cache ────────────────────────────────────────────────────────────

export async function saveAllocationsToCache(allocations: CachedAllocation[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(allocations));
  const meta: CacheMeta = { lastSynced: Date.now(), count: allocations.length };
  await AsyncStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
}

export async function loadAllocationsFromCache(): Promise<CachedAllocation[]> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as CachedAllocation[];
}

export async function getCacheMeta(): Promise<CacheMeta | null> {
  const raw = await AsyncStorage.getItem(CACHE_META_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as CacheMeta;
}

export async function isCacheFresh(): Promise<boolean> {
  const meta = await getCacheMeta();
  if (!meta) return false;
  return Date.now() - meta.lastSynced < CACHE_TTL_MS;
}

// ─── Repo Cache ───────────────────────────────────────────────────────────

export async function saveRepoAllocationsToCache(allocations: CachedAllocation[]): Promise<void> {
  await AsyncStorage.setItem(REPO_CACHE_KEY, JSON.stringify(allocations));
  const meta: CacheMeta = { lastSynced: Date.now(), count: allocations.length };
  await AsyncStorage.setItem(REPO_CACHE_META_KEY, JSON.stringify(meta));
}

export async function loadRepoAllocationsFromCache(): Promise<CachedAllocation[]> {
  const raw = await AsyncStorage.getItem(REPO_CACHE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as CachedAllocation[];
}

export async function getRepoCacheMeta(): Promise<CacheMeta | null> {
  const raw = await AsyncStorage.getItem(REPO_CACHE_META_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as CacheMeta;
}

export async function isRepoCacheFresh(): Promise<boolean> {
  const meta = await getRepoCacheMeta();
  if (!meta) return false;
  return Date.now() - meta.lastSynced < CACHE_TTL_MS;
}

// ─── Search Helpers ───────────────────────────────────────────────────────

export function searchByReg(allocations: CachedAllocation[], query: string): CachedAllocation[] {
  const q = query.toUpperCase().trim();
  return allocations.filter((a) => a.registration_no?.toUpperCase().includes(q));
}

export function searchByChassis(allocations: CachedAllocation[], query: string): CachedAllocation[] {
  const q = query.toUpperCase().trim();
  return allocations.filter((a) => a.chassis_no?.toUpperCase().includes(q));
}

export function findById(allocations: CachedAllocation[], id: number): CachedAllocation | null {
  return allocations.find((a) => a.id === id) ?? null;
}

// ─── Clear All Cache (on logout) ──────────────────────────────────────────

export async function clearCache(): Promise<void> {
  await AsyncStorage.multiRemove([
    CACHE_KEY,
    CACHE_META_KEY,
    REPO_CACHE_KEY,
    REPO_CACHE_META_KEY,
  ]);
}
