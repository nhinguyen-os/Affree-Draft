function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}

async function fetchSheetCsv(envKey) {
  const url = String(process.env[envKey] || "").trim();
  if (!url) throw new Error(`Thiếu ${envKey} trong env để đọc sheet.`);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Không đọc được sheet (${envKey}, status ${response.status}).`);
  return parseCsv(await response.text());
}

async function getWalmartAccount() {
  const rows = await fetchSheetCsv("ACCOUNT_ORDER_WALMART_URL");
  if (rows.length < 2) throw new Error("Tab Account Walmart chưa có tài khoản.");

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const usernameIndex = headers.findIndex((value) => /user\s*name|username|email/.test(value));
  const passwordIndex = headers.findIndex((value) => /password|mật khẩu/.test(value));
  const activeIndex = headers.findIndex((value) => /active|status|trạng thái/.test(value));
  if (usernameIndex < 0 || passwordIndex < 0) {
    throw new Error("Sheet Walmart cần có cột User Name và Password.");
  }

  const accounts = rows.slice(1).map((cells) => ({
    email: String(cells[usernameIndex] || "").trim(),
    password: String(cells[passwordIndex] || ""),
    active: activeIndex < 0 || /^(true|1|yes|active)$/i.test(String(cells[activeIndex] || "").trim()),
  })).filter((account) => account.email && account.password);

  const account = accounts.find((item) => item.active) || accounts[0];
  if (!account) throw new Error("Không tìm thấy tài khoản Walmart hợp lệ trong sheet.");
  return { email: account.email, password: account.password };
}

async function getCoopAccount() {
  const rows = await fetchSheetCsv("ACCOUNT_ORDER_COOP_URL");
  if (rows.length < 2) throw new Error("Tab Account Co.op chưa có tài khoản.");

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const phoneIndex = headers.findIndex((value) => /phone|sđt|số điện thoại|username|email/.test(value));
  const passwordIndex = headers.findIndex((value) => /password|mật khẩu/.test(value));
  const activeIndex = headers.findIndex((value) => /active|status|trạng thái/.test(value));
  if (phoneIndex < 0 || passwordIndex < 0) {
    throw new Error("Sheet Co.op cần có cột Phone/Username và Password.");
  }

  const accounts = rows.slice(1).map((cells) => ({
    phone: String(cells[phoneIndex] || "").trim(),
    password: String(cells[passwordIndex] || ""),
    active: activeIndex < 0 || /^(true|1|yes|active)$/i.test(String(cells[activeIndex] || "").trim()),
  })).filter((account) => account.phone && account.password);

  const account = accounts.find((item) => item.active) || accounts[0];
  if (!account) throw new Error("Không tìm thấy tài khoản Co.op hợp lệ trong sheet.");
  return { phone: account.phone, password: account.password };
}

module.exports = { getWalmartAccount, getCoopAccount, parseCsv, fetchSheetCsv };
