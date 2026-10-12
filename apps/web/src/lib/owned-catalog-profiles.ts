import { ownedActivityCode,type ChannelMapCatalog,type SupplyContractView } from '@cpms/domain';
/** Inactivating a dictionary entry must never hide its existing operational profile. */
export function ownedProfilesOutsideCatalog<T extends SupplyContractView>(profiles:T[],catalog:ChannelMapCatalog|null|undefined):T[] {
  const active=new Set(catalog?.data?.activities.filter(a=>a.supplyType==='INTERNAL').map(a=>a.code)??[]);
  return profiles.filter(p=>!active.has(ownedActivityCode(p)??''));
}
