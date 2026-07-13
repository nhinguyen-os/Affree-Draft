#!/usr/bin/env python3
"""Generate catalog.csv for the curated cross-chain price comparison.

Real scraped prices (2026-06-18) for ~15 canonical SKUs across BHX & Coop
(+ Yakult at Con Cung). AEON omitted (site blocked automation).
Each chain price is fanned out to every physical store of that chain.
Columns match the Google Sheet `catalog` tab.
"""
import csv

LAST_CHECKED = "2026-06-18"

# product_id, name, brand, category, unit
PRODUCTS = [
    ("milk-vnm-1l",            "Sữa tươi Vinamilk có đường 1L",        "Vinamilk",  "Sữa",        "Hộp 1L"),
    ("oil-neptune-1l",         "Dầu ăn Neptune Light 1L",              "Neptune",   "Dầu ăn",     "Chai 1L"),
    ("fishsauce-namngu-900",   "Nước mắm Nam Ngư 900ml",               "Nam Ngư",   "Gia vị",     "Chai 900ml"),
    ("noodle-haohao-75",       "Mì Hảo Hảo tôm chua cay 75g",          "Hảo Hảo",   "Mì gói",     "Gói 75g"),
    ("dish-sunlight-725",      "Nước rửa chén Sunlight chanh",         "Sunlight",  "Hóa phẩm",   "Chai 725-750g"),
    ("detergent-omo-matic-2800","Nước giặt Omo Matic cửa trước 2.8kg", "Omo",       "Giặt giũ",   "Túi 2.8kg"),
    ("tea-khongdo-455",        "Trà xanh Không Độ chanh 455ml",        "Không Độ",  "Đồ uống",    "Chai 455ml"),
    ("sugar-bienhoa-1kg",      "Đường trắng Biên Hòa 1kg",             "Biên Hòa",  "Thực phẩm",  "Túi 1kg"),
    ("coke-15l",               "Coca-Cola 1.5L",                       "Coca-Cola", "Đồ uống",    "Chai 1.5L"),
    ("noodle-omachi-suon-80",  "Mì Omachi sườn hầm 80g",               "Omachi",    "Mì gói",     "Gói 80g"),
    ("condmilk-ongtho-380",    "Sữa đặc Ông Thọ lon 380g",             "Ông Thọ",   "Sữa",        "Lon 380g"),
    ("yakult-loc5-65",         "Sữa chua uống Yakult lốc 5 x 65ml",    "Yakult",    "Sữa",        "Lốc 5 x 65ml"),
    ("coffee-g7-3in1-21",      "Cà phê G7 3in1 hộp 21 gói",            "G7",        "Cà phê",     "Hộp 21 gói"),
    ("msg-ajinomoto-454",      "Bột ngọt Ajinomoto 454g",              "Ajinomoto", "Gia vị",     "Gói 454g"),
    ("knorr-thitthan-900",     "Hạt nêm Knorr thịt thăn 900g",         "Knorr",     "Gia vị",     "Gói 900g"),
]

# chain -> physical store ids (fan-out targets) + base url
CHAINS = {
    "bhx":     {"stores": ["bhx-q1", "bhx-q3", "bhx-bt"], "base": "https://www.bachhoaxanh.com"},
    "coop":    {"stores": ["coop-q1", "coop-bt"],          "base": "https://cooponline.vn"},
    "concung": {"stores": ["cc-q3", "cc-pn"],              "base": "https://concung.com"},
}

# product_id -> chain -> (price, url_path). Missing = not sold at that chain.
OFFERS = {
    "milk-vnm-1l": {
        "bhx":  (40500, "/sua-tuoi/sttt-vinamilk-dan-bo-cd-1l"),
        "coop": (37500, "/sua-tuoi-tiet-trung-vinamilk-100-co-duong-hop-giay-1l--s250106405"),
    },
    "oil-neptune-1l": {
        "bhx":  (65000, "/dau-an/dau-an-thuong-hang-neptune-light-chai-1-lit"),
        "coop": (58500, "/dau-an-neptune-light-chai-1l--s250110731"),
    },
    "fishsauce-namngu-900": {
        "bhx":  (62500, "/nuoc-mam/nuoc-mam-nam-ngu-chai-pet-900ml-15"),
        "coop": (52800, "/nuoc-mam-nam-ngu-3in1-900ml--s250102285"),
    },
    "noodle-haohao-75": {
        "bhx":  (4400, "/mi/mi-hao-hao-tom-chua-cay-goi-75g"),
        "coop": (4300, "/mi-hao-hao-vi-tom-chua-cay-goi-75g--s250100224"),
    },
    "dish-sunlight-725": {
        "bhx":  (27500, "/nuoc-rua-chen/nuoc-rua-chen-sunlight-chanh-100-chiet-xuat-chanh-tuoi-chai-725-ml"),
        "coop": (27400, "/nuoc-rua-chen-sunlight-chanh-750g--s250109269"),
    },
    "detergent-omo-matic-2800": {
        "bhx":  (200000, "/nuoc-giat/nuoc-giat-omo-matic-ben-dep-cua-truoc-luu-va-tre-tui-28-lit"),
        "coop": (148900, "/nuoc-giat-omo-matic-chuyen-gia-giu-mau-cua-truoc-2-8kg--s250103826"),
    },
    "tea-khongdo-455": {
        "bhx":  (11300, "/nuoc-tra/tra-xanh-khong-do-chanh-chai-455ml"),
        # coop: NONE (Khong Do not sold at Coop)
    },
    "sugar-bienhoa-1kg": {
        "bhx":  (29000, "/duong/duong-tui-bien-hoa-pure-1kg-x-20"),
        "coop": (27200, "/duong-sach-bien-hoa-1kg--s250101347"),
    },
    "coke-15l": {
        "bhx":  (16000, "/nuoc-ngot/nuoc-ngot-coca-cola-nguyen-ban-giam-duong-chai-15-lit"),
        "coop": (20600, "/nuoc-giai-khat-coca-cola-giam-duong-1-5l--s250102844"),
    },
    "noodle-omachi-suon-80": {
        "bhx":  (9500, "/mi/mi-omachi-suon-ngu-qua-80g"),
        "coop": (8200, "/mi-dinh-duong-omachi-suon-ham-ngu-qua-80g--s250107848"),
    },
    "condmilk-ongtho-380": {
        "bhx":  (34500, "/sua-dac/sua-dac-ong-tho-trang-lon-nap-giat-380g"),
        "coop": (27700, "/sua-dac-co-duong-ong-tho-nhan-do-380g--s250515045"),
    },
    "yakult-loc5-65": {
        "bhx":     (26000, "/sua-chua-an/loc-5-chai-sua-uong-len-men-yakultt-65ml"),
        "coop":    (25900, "/sua-uong-len-men-yakult-loc-5-x-65ml--s250105200"),
        "concung": (27000, "/pho-mai-cho-be/loc-5-chai-sua-uong-len-men-yakult-65ml-55760.html"),
    },
    "coffee-g7-3in1-21": {
        "bhx":  (85000, "/ca-phe-hoa-tan/ca-phe-g7-3in1-hop-21-sachets-16g"),
        "coop": (75500, "/ca-phe-hoa-tan-3in1-g7-hop-21-goi-x-16g--s250107951"),
    },
    "msg-ajinomoto-454": {
        "bhx":  (36000, "/hat-nem/bot-ngot-ajinomoto-hat-lon-goi-454g"),
        "coop": (33000, "/bot-ngot-ajinomoto-454g--s250100394"),
    },
    "knorr-thitthan-900": {
        "bhx":  (72000, "/hat-nem/hat-nem-knorr-tt-xo-900g"),
        "coop": (83900, "/hat-nem-knorr-thit-than-xuong-ong-va-tuy-goi-900g--s250110347"),
    },
}

# product_id -> ảnh sản phẩm thật (thẻ og:image trên trang sản phẩm, 2026-06-18)
IMAGES = {
    "milk-vnm-1l":             "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2386/79312/bhx/79312-thumb-moi_202410291615089248.jpg",
    "oil-neptune-1l":          "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2286/226995/bhx/226995-thumb-moi_202411071422115102.jpg",
    "fishsauce-namngu-900":    "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2289/79053/bhx/nuoc-mam-nam-ngu-chai-pet-900ml-15_202512021341395080.jpg",
    "noodle-haohao-75":        "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2565/77622/bhx/77622_202410151353279924.jpg",
    "dish-sunlight-725":       "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2387/76486/bhx/nuoc-rua-chen-sunlight-chanh-100-chiet-xuat-chanh-tuoi-chai-725-ml_202508041540328110.jpg",
    "detergent-omo-matic-2800":"https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2464/222104/bhx/nuoc-giat-omo-matic-ben-dep-cua-truoc-luu-va-tre-tui-28-lit_202507091408553418.jpg",
    "tea-khongdo-455":         "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/8938/85739/bhx/85739_202410301432453335.jpg",
    "sugar-bienhoa-1kg":       "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2804/85200/bhx/85200-thumb-moi_202411112105174163.jpg",
    "coke-15l":                "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2443/222274/bhx/222274_202411041546303877.jpg",
    "noodle-omachi-suon-80":   "https://lh3.googleusercontent.com/TVGYbwOfDW44Sv0-6WKS1LLaU8KKkMRxKtpr5OvUTuk7ezeT3tiIisc8JDBOB5Ssu8L8bNdGh6BCK0XmjjM6X0NiqjGVUYQ",
    "condmilk-ongtho-380":     "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2526/92440/bhx/92440-thumb-moi_202411221651465413.jpg",
    "yakult-loc5-65":          "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/7598/323707/bhx/323707-1_202411251322391721.jpg",
    "coffee-g7-3in1-21":       "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2524/77117/bhx/77117_202411180936179537.jpg",
    "msg-ajinomoto-454":       "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2806/77081/bhx/bot-ngot-ajinomoto-hat-lon-goi-454g_202511031324186725.jpg",
    "knorr-thitthan-900":      "https://cdnv2.tgdd.vn/bhx-static/bhx/Products/Images/2806/77241/bhx/77241-thumb-moi_202411051426590872.jpg",
}

HEADER = ["product_id", "product_name", "brand", "category", "unit", "image",
          "chain", "store_id", "price", "in_stock", "product_url", "last_checked"]

rows = []
for pid, name, brand, category, unit in PRODUCTS:
    image = IMAGES.get(pid, "")
    chain_offers = OFFERS.get(pid, {})
    for chain, (price, path) in chain_offers.items():
        base = CHAINS[chain]["base"]
        url = base + path
        for store_id in CHAINS[chain]["stores"]:
            rows.append([pid, name, brand, category, unit, image, chain, store_id,
                         price, "TRUE", url, LAST_CHECKED])

with open("catalog.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(HEADER)
    w.writerows(rows)

print(f"Wrote catalog.csv: {len(rows)} rows, {len(PRODUCTS)} products")
# overlap summary
for pid, name, *_ in PRODUCTS:
    chains = sorted(OFFERS.get(pid, {}).keys())
    print(f"  {name}: {', '.join(chains) if chains else 'NONE'}")
