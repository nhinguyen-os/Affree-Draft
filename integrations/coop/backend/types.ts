export interface CoopSearchParams {
  query: string;
  terminalCode?: string;
  location?: CoopLocationParams;
  page?: number;
  pageSize?: number;
  storeLimit?: number;
}

export interface CoopProductParams {
  sku: string;
  terminalCode?: string;
}

export interface CoopLocationParams {
  lat: number;
  lng: number;
  address?: string;
}

export interface CoopTerminal {
  terminalId?: number | string;
  terminalCode?: string;
  terminalName?: string;
  name?: string;
  address?: string;
  fullAddress?: string;
  distance?: number | string;
  distanceKm?: number | string;
  lat?: number | string;
  lng?: number | string;
  long?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  [key: string]: unknown;
}

export interface CoopRawPrice {
  latestPrice?: string;
  sellPrice?: string;
  terminalPrice?: string;
  supplierRetailPrice?: string;
  discountAmount?: string;
  discountPercent?: number;
}

export interface CoopRawProductInfo {
  sku?: string;
  skuId?: string;
  name?: string;
  imageUrl?: string;
  brand?: { name?: string };
  brands?: Array<{ name?: string }>;
  categories?: Array<{ name?: string }>;
  sellerSku?: string;
  canonical?: string;
  slug?: string;
  uomName?: string;
  barcode?: string;
}

export interface CoopRawProduct {
  productInfo?: CoopRawProductInfo;
  prices?: CoopRawPrice[];
  promotions?: unknown[];
  totalAvailable?: number;
  status?: {
    sellable?: boolean;
    sellingCode?: string;
  };
  productDetail?: {
    description?: string;
    shortDescription?: string;
  };
}

export interface CoopApiEnvelope<T> {
  code?: string | number;
  message?: string;
  result?: T;
  data?: T;
}

export interface CoopNormalizedProduct {
  sku: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  image: string;
  price: number;
  inStock: boolean;
  url: string;
  canonical: string;
  sellerSku?: string;
  barcode?: string;
  totalAvailable?: number;
  raw: CoopRawProduct;
}

export interface CoopSearchResult {
  source: "cooponline";
  endpoint: string;
  terminalCode: string;
  terminal?: CoopTerminal;
  terminals?: CoopTerminal[];
  terminalProducts?: CoopTerminalProductResult[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  products: CoopNormalizedProduct[];
  raw: CoopApiEnvelope<{ products?: CoopRawProduct[] }>;
}

export interface CoopTerminalProductResult {
  terminalCode: string;
  terminal?: CoopTerminal;
  products: CoopNormalizedProduct[];
}
