/**
 * Affree AI Agentic — Skill Store (v2, MD-only)
 * Quản lý đọc/ghi "skill" (kiến thức tích luỹ) cho từng domain dưới dạng Markdown.
 * Mỗi domain có một file .md riêng trong thư mục agent-server/skills/.
 * File _master.md là skill tổng quát, không bao giờ bị AI ghi đè.
 *
 * Quy định ngôn ngữ: Comments và log tiếng Việt, biến/hàm tiếng Anh.
 */

const fs = require("fs");
const path = require("path");

const SKILLS_DIR = path.join(__dirname, "skills");
const MASTER_SKILL_FILE = "_master.md";

// Đảm bảo thư mục skills tồn tại
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

/**
 * Lấy tên domain từ URL hoặc domain string.
 * Ví dụ: "https://www.lazada.vn/product/..." → "lazada.vn"
 */
function domainFromUrl(urlOrDomain) {
  try {
    const parsed = new URL(urlOrDomain);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return urlOrDomain.replace(/^www\./, "").toLowerCase().trim();
  }
}

/**
 * Tải nội dung master skill instruction (_master.md).
 * Đây là skill tổng quát, ổn định — không bao giờ bị AI cập nhật.
 * Trả về string nội dung, hoặc null nếu chưa có file.
 */
function loadMasterInstruction() {
  const filePath = path.join(SKILLS_DIR, MASTER_SKILL_FILE);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content.length > 0) return content;
    }
  } catch (e) {
    console.warn(`[SkillStore] Không đọc được master skill: ${e.message}`);
  }
  return null;
}

/**
 * Tải skill instruction (markdown) cho một domain cụ thể.
 * File: agent-server/skills/<domain>.md
 * Trả về nội dung text, hoặc null nếu chưa có file.
 */
function loadSkillInstruction(urlOrDomain) {
  const domain = domainFromUrl(urlOrDomain);
  const filePath = path.join(SKILLS_DIR, `${domain}.md`);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content.length > 0) {
        console.log(`[SkillStore] Đã tải skill instruction cho ${domain} (${content.length} ký tự).`);
        return content;
      }
    }
  } catch (e) {
    console.warn(`[SkillStore] Không đọc được skill instruction cho ${domain}: ${e.message}`);
  }
  return null;
}

/**
 * Ghi đè toàn bộ nội dung file skill instruction .md.
 * Từ chối ghi vào _master.md (protected).
 */
function saveSkillInstruction(urlOrDomain, content) {
  const domain = domainFromUrl(urlOrDomain);
  if (domain.startsWith("_")) {
    console.warn(`[SkillStore] Từ chối ghi vào protected skill: ${domain}.md`);
    return;
  }
  const filePath = path.join(SKILLS_DIR, `${domain}.md`);
  try {
    fs.writeFileSync(filePath, content.trim() + "\n", "utf-8");
    console.log(`[SkillStore] Đã lưu skill instruction cho ${domain} (${content.length} ký tự).`);
  } catch (e) {
    console.error(`[SkillStore] Không ghi được skill instruction cho ${domain}: ${e.message}`);
  }
}

/**
 * Append nội dung mới vào cuối file skill instruction .md.
 * Từ chối ghi vào _master.md (protected).
 */
function appendToSkillInstruction(urlOrDomain, section) {
  const domain = domainFromUrl(urlOrDomain);
  if (domain.startsWith("_")) {
    console.warn(`[SkillStore] Từ chối append vào protected skill: ${domain}.md`);
    return;
  }
  const existing = loadSkillInstruction(urlOrDomain) || "";
  const newContent = existing
    ? existing + "\n\n" + section.trim()
    : section.trim();
  saveSkillInstruction(urlOrDomain, newContent);
}

/**
 * Đọc skill file theo tên (không cần domain — dùng cho tool read_skill).
 * Tên có thể là: "cooponline.vn", "cooponline.vn.md", "_master"
 * Trả về { content, name } hoặc null nếu không tìm thấy.
 */
function readSkillByName(name) {
  // Normalize tên file
  const normalized = name.endsWith(".md") ? name : `${name}.md`;
  const filePath = path.join(SKILLS_DIR, normalized);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      return { name: normalized, content };
    }
  } catch (e) {
    console.warn(`[SkillStore] Không đọc được skill '${name}': ${e.message}`);
  }
  return null;
}

/**
 * Liệt kê tất cả skill files (.md) trong thư mục skills.
 * Trả về mảng tên file (không có đường dẫn).
 */
function listSkillFiles() {
  try {
    return fs.readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Ghi nội dung vào skill file theo tên (dùng cho tool update_skill).
 * Nếu mode="append" thì append, mode="overwrite" thì ghi đè.
 * Từ chối ghi vào _master.md.
 */
function writeSkillByName(name, content, mode = "append") {
  const normalized = name.endsWith(".md") ? name : `${name}.md`;
  if (normalized.startsWith("_")) {
    return { success: false, error: `Không thể ghi vào protected skill: ${normalized}` };
  }
  const filePath = path.join(SKILLS_DIR, normalized);
  try {
    if (mode === "append") {
      const existing = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, "utf-8").trim()
        : "";
      const newContent = existing
        ? existing + "\n\n" + content.trim()
        : content.trim();
      fs.writeFileSync(filePath, newContent + "\n", "utf-8");
    } else {
      fs.writeFileSync(filePath, content.trim() + "\n", "utf-8");
    }
    console.log(`[SkillStore] Đã ${mode === "append" ? "append" : "ghi đè"} skill '${normalized}'.`);
    return { success: true, name: normalized };
  } catch (e) {
    console.error(`[SkillStore] Không ghi được skill '${normalized}': ${e.message}`);
    return { success: false, error: e.message };
  }
}

module.exports = {
  domainFromUrl,
  loadMasterInstruction,
  loadSkillInstruction,
  saveSkillInstruction,
  appendToSkillInstruction,
  readSkillByName,
  listSkillFiles,
  writeSkillByName,
};
