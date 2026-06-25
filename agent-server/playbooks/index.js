/**
 * Playbook Registry - Chọn playbook phù hợp theo chuỗi cửa hàng và URL.
 * 
 * Cách thêm playbook mới:
 * 1. Tạo file `playbooks/<chainname>.js` export hàm `run(page, payload, sendLog, sendStatus)`
 * 2. Đăng ký chain key trong PLAYBOOKS bên dưới
 */

const PLAYBOOKS = {
  coop: require("./cooponline"),
  cooponline: require("./cooponline"),
  tuoixanhnhanhngon: require("./tuoixanhnhanhngon"),
};

/**
 * Tìm và chạy playbook phù hợp cho chain/URL.
 * Trả về { done: true } nếu playbook xử lý toàn bộ,
 * trả về { done: false } nếu chỉ bootstrap và cần AI tiếp.
 * Trả về null nếu không có playbook nào phù hợp.
 */
async function runPlaybook(page, payload, sendLog, sendStatus) {
  const { chain, url } = payload;

  // 1. Tìm theo chain key trước
  if (chain && PLAYBOOKS[chain.toLowerCase()]) {
    const pb = PLAYBOOKS[chain.toLowerCase()];
    sendLog(`Tìm thấy Playbook cho chuỗi: ${chain.toUpperCase()}`, "info");
    return pb.run(page, payload, sendLog, sendStatus);
  }

  // 2. Tìm theo domain của URL
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace("www.", "");
      for (const [key, pb] of Object.entries(PLAYBOOKS)) {
        if (hostname.includes(key)) {
          sendLog(`Tìm thấy Playbook cho domain: ${hostname}`, "info");
          return pb.run(page, payload, sendLog, sendStatus);
        }
      }
    } catch {}
  }

  return null; // Không có playbook → dùng AI DOM thuần
}

module.exports = { runPlaybook };
