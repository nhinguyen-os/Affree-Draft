import type { OrderProviderKey } from "./types";

export interface OrderProviderDefinition {
  key: OrderProviderKey;
  label: string;
  allowedHosts: string[];
}

export const ORDER_PROVIDERS: Record<OrderProviderKey, OrderProviderDefinition> = {
  tuoixanhnhanhngon: {
    key: "tuoixanhnhanhngon",
    label: "Tươi Xanh Nhanh Ngon",
    allowedHosts: ["tuoixanhnhanhngon.timdaythay.com"],
  },
};

export function getOrderProviderDefinition(provider: OrderProviderKey): OrderProviderDefinition {
  return ORDER_PROVIDERS[provider];
}
