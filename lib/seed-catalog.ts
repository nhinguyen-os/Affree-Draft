import type { Catalog, Chain, Offer, Product } from "./types";
import { STORES, chainSearchUrl } from "./stores";

/**
 * Ảnh sản phẩm thật, lấy từ thẻ og:image trên trang sản phẩm của chuỗi
 * (Co.opmart qua CDN googleusercontent, Friso từ Con Cưng) — thu thập 2026-06-17.
 */
export const PRODUCT_IMAGES: Record<string, string> = {
  // 15 SKU canonical (og:image trên trang sản phẩm BHX/Coop, 2026-06-18)
  "milk-vnm-1l": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2386/79312/bhx/79312-thumb-moi_202410291615089248.jpg",
  "oil-neptune-1l": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2286/226995/bhx/226995-thumb-moi_202411071422115102.jpg",
  "fishsauce-namngu-900": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2289/79053/bhx/nuoc-mam-nam-ngu-chai-pet-900ml-15_202512021341395080.jpg",
  "noodle-haohao-75": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2565/77622/bhx/77622_202410151353279924.jpg",
  "dish-sunlight-725": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2387/76486/bhx/nuoc-rua-chen-sunlight-chanh-100-chiet-xuat-chanh-tuoi-chai-725-ml_202508041540328110.jpg",
  "detergent-omo-matic-2800": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2464/222104/bhx/nuoc-giat-omo-matic-ben-dep-cua-truoc-luu-va-tre-tui-28-lit_202507091408553418.jpg",
  "tea-khongdo-455": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/8938/85739/bhx/85739_202410301432453335.jpg",
  "sugar-bienhoa-1kg": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2804/85200/bhx/85200-thumb-moi_202411112105174163.jpg",
  "coke-15l": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2443/222274/bhx/222274_202411041546303877.jpg",
  "noodle-omachi-suon-80": "https://lh3.googleusercontent.com/TVGYbwOfDW44Sv0-6WKS1LLaU8KKkMRxKtpr5OvUTuk7ezeT3tiIisc8JDBOB5Ssu8L8bNdGh6BCK0XmjjM6X0NiqjGVUYQ",
  "condmilk-ongtho-380": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2526/92440/bhx/92440-thumb-moi_202411221651465413.jpg",
  "yakult-loc5-65": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/7598/323707/bhx/323707-1_202411251322391721.jpg",
  "coffee-g7-3in1-21": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2524/77117/bhx/77117_202411180936179537.jpg",
  "msg-ajinomoto-454": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2806/77081/bhx/bot-ngot-ajinomoto-hat-lon-goi-454g_202511031324186725.jpg",
  "knorr-thitthan-900": "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2806/77241/bhx/77241-thumb-moi_202411051426590872.jpg",
  "oil-tuongan-1l": "https://lh3.googleusercontent.com/lCkjENrANZwwBWsCyWU4H7_vunPFslN_Wf_HLxrZ_BzL5Iew1lB-dksjGIN9I8yRENcGeRjwRZTYdS9xx5hTQdHhTdtrd-AqNw",
  "diaper-bobby-m64": "https://lh3.googleusercontent.com/pwvroJkP4ZlvjDCf37OLOBlnQPqLEpSYuNsR-EV-mWEZJIFOZHivKKCQFaaKmCxecIvI852bkOR-jiuVMnaGyuXc8zcRRTvs",
  "dish-sunlight-750": "https://lh3.googleusercontent.com/DXrB9jAbRgJ_OcoRYJaz6wQ9ZUZ3URUk2alun82zAqPwTY-zaAHkkaAth91as-DHyrGFrevEo-mrzZIS3ft5A9g0hVMplvY",
  "rice-st25-5kg": "https://lh3.googleusercontent.com/EWx0VBPCNcaUXlc4yAc8HHQdzwe6Cl1ju_c-3b0PcOX9VulIYUQPJOHR93zpbUOZBfufTqVGiuxrru_mxBh0JxG5qgTVMw3x",
  "formula-friso4-850": "https://concung.com/2026/02/51147-135060-large_mobile/friso-gold-4-2-6-tuoi-800g-giao-bao-bi-ngau-nhien.webp",
  "noodle-haohao-30": "https://lh3.googleusercontent.com/V_fOcljZbXQfZHJ6tmDE0FtalA07ibYXp4kypiB1rTVzADvFth-6aOSiohj1klnN7o2qNd79VoawilZWBsR9mwp0QXBgy0WT",
  "egg-cp-10": "https://lh3.googleusercontent.com/uDF8CbGQPpcIsv2htRy67Wo5wb5DYPZsNvH14i_Tt_abOkCzJ_X3nVRWCMMRlXTT_8qzkRaO4pOq9ZtmC9J_OJo9duyrcBI4",
};

export const PRODUCTS: Product[] = [
  { id: "milk-vnm-1l", name: "Sữa tươi Vinamilk có đường 1L", brand: "Vinamilk", category: "Sữa", unit: "hộp 1L" },
  { id: "oil-tuongan-1l", name: "Dầu ăn Tường An 1L", brand: "Tường An", category: "Gia vị - Dầu ăn", unit: "chai 1L" },
  { id: "diaper-bobby-m64", name: "Tã dán Bobby size M 64 miếng", brand: "Bobby", category: "Mẹ & Bé", unit: "gói 64" },
  { id: "dish-sunlight-750", name: "Nước rửa chén Sunlight Chanh 750g", brand: "Sunlight", category: "Hóa phẩm", unit: "chai 750g" },
  { id: "rice-st25-5kg", name: "Gạo ST25 túi 5kg", brand: "ST25", category: "Gạo - Mì", unit: "túi 5kg" },
  { id: "formula-friso4-850", name: "Sữa bột Friso Gold 4 850g", brand: "Friso", category: "Mẹ & Bé", unit: "lon 850g" },
  { id: "noodle-haohao-30", name: "Mì Hảo Hảo tôm chua cay thùng 30 gói", brand: "Hảo Hảo", category: "Gạo - Mì", unit: "thùng 30" },
  { id: "egg-cp-10", name: "Trứng gà CP hộp 10 quả", brand: "CP", category: "Trứng - Thịt", unit: "hộp 10" },
].map((p) => ({ ...p, image: PRODUCT_IMAGES[p.id] }));

/** Giá nền theo từng chuỗi (VND). Chuỗi nào không bán thì bỏ trống. */
export const PRICE_BY_CHAIN: Record<string, Partial<Record<Chain, number>>> = {
  "milk-vnm-1l": { bhx: 34000, coop: 33500, aeon: 35000 },
  "oil-tuongan-1l": { bhx: 52000, coop: 49000, aeon: 51000 },
  "diaper-bobby-m64": { bhx: 295000, concung: 279000, coop: 305000 },
  "dish-sunlight-750": { bhx: 32000, coop: 31000, aeon: 33500 },
  "rice-st25-5kg": { bhx: 165000, coop: 159000, aeon: 172000 },
  "formula-friso4-850": { concung: 449000, bhx: 469000 },
  "noodle-haohao-30": { bhx: 110000, coop: 108000, aeon: 115000 },
  "egg-cp-10": { bhx: 32000, coop: 33000, aeon: 31500 },
};

/** Vài cặp (productId|storeId) cố tình hết hàng để minh hoạ trạng thái tồn kho. */
const OUT_OF_STOCK = new Set<string>([
  "milk-vnm-1l|bhx-q1",
  "rice-st25-5kg|coop-bt",
  "diaper-bobby-m64|cc-pn",
]);

function buildOffers(): Offer[] {
  const now = new Date().toISOString();
  const offers: Offer[] = [];
  for (const product of PRODUCTS) {
    const byChain = PRICE_BY_CHAIN[product.id] ?? {};
    for (const store of STORES) {
      const base = byChain[store.chain];
      if (base == null) continue;
      // chênh nhẹ ±2% giữa các cửa hàng cùng chuỗi cho thực tế
      const jitter = Math.round((base * ((store.id.charCodeAt(store.id.length - 1) % 5) - 2)) / 100);
      const price = base + jitter;
      const key = `${product.id}|${store.id}`;
      offers.push({
        productId: product.id,
        storeId: store.id,
        price,
        inStock: !OUT_OF_STOCK.has(key),
        productUrl: chainSearchUrl(store.chain, product.name),
        lastChecked: now,
      });
    }
  }
  return offers;
}

export const SEED_CATALOG: Catalog = {
  products: PRODUCTS,
  offers: buildOffers(),
};
