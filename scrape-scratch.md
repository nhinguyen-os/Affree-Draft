# Scrape scratch — catalog (real prices, 2026-06-18)

Canonical 15 (final specs):
1. milk-vnm-1l — Sữa tươi Vinamilk có đường 1L
2. oil-neptune-1l — Dầu ăn Neptune Light 1L
3. fishsauce-namngu-900 — Nước mắm Nam Ngư 900ml
4. noodle-haohao-75 — Mì Hảo Hảo tôm chua cay gói 75g
5. dish-sunlight-725 — Nước rửa chén Sunlight chanh 725ml
6. detergent-omo-matic-2800 — Nước giặt Omo Matic cửa trước 2.8kg
7. tea-khongdo-455 — Trà xanh Không Độ chanh 455ml  (swap from eggs: private-label, not comparable)
8. sugar-bienhoa-1kg — Đường trắng Biên Hòa 1kg
9. coke-15l — Coca-Cola 1.5L (nguyên bản giảm đường)
10. noodle-omachi-suon-80 — Mì Omachi sườn hầm 80g
11. condmilk-ongtho-380 — Sữa đặc Ông Thọ lon 380g
12. yakult-loc5-65 — Yakult lốc 5 chai 65ml (swap from giấy VS: private-label-heavy)
13. coffee-g7-3in1-21 — Cà phê G7 3in1 hộp 21 gói
14. msg-ajinomoto-454 — Bột ngọt Ajinomoto 454g (real size, not 400g)
15. knorr-thitthan-900 — Hạt nêm Knorr thịt thăn 900g

## BHX (base = https://www.bachhoaxanh.com) — DONE 15/15
1  40500  /sua-tuoi/sttt-vinamilk-dan-bo-cd-1l
2  65000  /dau-an/dau-an-thuong-hang-neptune-light-chai-1-lit
3  62500  /nuoc-mam/nuoc-mam-nam-ngu-chai-pet-900ml-15
4  4400   /mi/mi-hao-hao-tom-chua-cay-goi-75g
5  27500  /nuoc-rua-chen/nuoc-rua-chen-sunlight-chanh-100-chiet-xuat-chanh-tuoi-chai-725-ml
6  200000 /nuoc-giat/nuoc-giat-omo-matic-ben-dep-cua-truoc-luu-va-tre-tui-28-lit
7  11300  /nuoc-tra/tra-xanh-khong-do-chanh-chai-455ml
8  29000  /duong/duong-tui-bien-hoa-pure-1kg-x-20
9  16000  /nuoc-ngot/nuoc-ngot-coca-cola-nguyen-ban-giam-duong-chai-15-lit  (KM, gốc 22000)
10 9500   /mi/mi-omachi-suon-ngu-qua-80g
11 34500  /sua-dac/sua-dac-ong-tho-trang-lon-nap-giat-380g
12 26000  /sua-chua-an/loc-5-chai-sua-uong-len-men-yakultt-65ml
13 85000  /ca-phe-hoa-tan/ca-phe-g7-3in1-hop-21-sachets-16g
14 36000  /hat-nem/bot-ngot-ajinomoto-hat-lon-goi-454g
15 72000  /hat-nem/hat-nem-knorr-tt-xo-900g

## Coop (base = https://cooponline.vn) — DONE (14 found, 1 none)
Method: navigate homepage -> navigate /search?router=productListing&query=<q> -> wait 3s -> find
1  37500  /sua-tuoi-tiet-trung-vinamilk-100-co-duong-hop-giay-1l--s250106405
2  58500  /dau-an-neptune-light-chai-1l--s250110731
3  52800  /nuoc-mam-nam-ngu-3in1-900ml--s250102285  (KM, goc 59000; variant 3in1)
4  4300   /mi-hao-hao-vi-tom-chua-cay-goi-75g--s250100224
5  27400  /nuoc-rua-chen-sunlight-chanh-750g--s250109269  (750g vs BHX 725ml)
6  148900 /nuoc-giat-omo-matic-chuyen-gia-giu-mau-cua-truoc-2-8kg--s250103826  (KM, goc 185000)
7  NONE   (Khong Do khong ban tai Coop)
8  27200  /duong-sach-bien-hoa-1kg--s250101347
9  20600  /nuoc-giai-khat-coca-cola-giam-duong-1-5l--s250102844
10 8200   /mi-dinh-duong-omachi-suon-ham-ngu-qua-80g--s250107848
11 27700  /sua-dac-co-duong-ong-tho-nhan-do-380g--s250515045  (nhan do; BHX vang 34500)
12 25900  /sua-uong-len-men-yakult-loc-5-x-65ml--s250105200
13 75500  /ca-phe-hoa-tan-3in1-g7-hop-21-goi-x-16g--s250107951
14 33000  /bot-ngot-ajinomoto-454g--s250100394  (KM, goc 34800)
15 83900  /hat-nem-knorr-thit-than-xuong-ong-va-tuy-goi-900g--s250110347
## AEON (base = https://aeoneshop.com) — BLOCKED/DEFERRED
- Server-side WebFetch = HTTP 403.
- Browser: /products/search/<q> page never reaches document_idle and repeatedly crashes the Chrome extension worker. Homepage loads fine; results page does not.
- Decision: omit AEON offers for now (aeon-tp store will simply have no offers). Revisit later or get prices manually.
## Con Cung (base = https://concung.com) — DONE via WebFetch (baby store, only Yakult overlaps)
Method: WebFetch https://concung.com/search?search_query=<q> (SSR works; browser results page won't idle)
12 27000  /pho-mai-cho-be/loc-5-chai-sua-uong-len-men-yakult-65ml-55760.html
All others (1-11,13-15): NONE — Con Cung is mom&baby, does not stock these FMCG grocery SKUs
(Vinamilk only 180ml loc4; no Neptune/NamNgu/HaoHao/Sunlight/Omo/OngTho/etc.)

## FAN-OUT (physical stores per chain)
bhx -> bhx-q1, bhx-q3, bhx-bt
coop -> coop-q1, coop-bt
concung -> cc-q3, cc-pn
aeon -> aeon-tp (no offers - blocked)
Catalog chain codes: bhx, coop, concung (note: store ids use cc- but chain field = concung)
