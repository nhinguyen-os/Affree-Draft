/**
 * Playbook Registry - Chọn playbook phù hợp theo chuỗi cửa hàng và URL.
 * 
 * Cách thêm playbook mới:
 * 1. Tạo file `playbooks/<chainname>.js` export hàm `run(page, payload, sendLog, sendStatus)` cho agentic bootstrap
 * 2. Nếu chain cần CSS fallback riêng, export thêm `runCss(page, payload, sendLog, sendStatus)`
 * 3. Đăng ký chain key trong PLAYBOOKS bên dưới
 */

const PLAYBOOKS = {
  coop: require("./cooponline"),
  cooponline: require("./cooponline"),
  tuoixanhnhanhngon: require("./tuoixanhnhanhngon"),
  bhx: require("./bachhoaxanh"),
  walmart: require("./walmart"),
};

function resolvePlaybook(payload = {}) {
  const { chain, url } = payload;

  if (chain) {
    const key = chain.toLowerCase();
    if (PLAYBOOKS[key]) {
      return { key, playbook: PLAYBOOKS[key], source: "chain" };
    }
  }

  if (url) {
    try {
      const hostname = new URL(url).hostname.replace("www.", "");
      for (const [key, playbook] of Object.entries(PLAYBOOKS)) {
        if (hostname.includes(key)) {
          return { key, playbook, source: "url", hostname };
        }
      }
    } catch { }
  }

  return null;
}

/**
 * Tìm và chạy playbook phù hợp cho chain/URL.
 * Trả về { done: true } nếu playbook xử lý toàn bộ,
 * trả về { done: false } nếu chỉ bootstrap và cần AI tiếp.
 * Trả về null nếu không có playbook nào phù hợp.
 */
async function runPlaybook(page, payload, sendLog, sendStatus, sendMessage = null, sendScreenshotFrame = null) {
  const resolved = resolvePlaybook(payload);
  if (!resolved) {
    return null; // Không có playbook → dùng AI DOM thuần
  }

  if (resolved.source === "chain") {
    sendLog(`Tìm thấy Playbook cho chuỗi: ${resolved.key.toUpperCase()}`, "info");
  } else {
    sendLog(`Tìm thấy Playbook cho domain: ${resolved.hostname}`, "info");
  }

  return resolved.playbook.run(page, payload, sendLog, sendStatus, sendMessage, sendScreenshotFrame);
}

module.exports = { runPlaybook, resolvePlaybook };
