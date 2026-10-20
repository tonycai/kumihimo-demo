import { expect, test } from "@playwright/test";

/** DP-09 (footer, privacy notice, no Atlas branding, own-origin requests only), DM-06 (CTA), CV-10 (notice). */
test("DP-09 / DM-06: footer links, the privacy notice in both languages, nothing loaded from elsewhere", async ({ page, baseURL }) => {
  const offSite: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(baseURL!) && !/^(data|blob):/.test(r.url())) offSite.push(r.url());
  });
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer).toContainText("Unofficial demo. Not affiliated with or endorsed by Atlas Cloud.");
  await expect(footer.getByRole("link", { name: "Company" })).toHaveAttribute("href", "https://www.solanalink.jp/ja/about-us");
  await expect(footer.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/go/contact");
  await expect(footer.getByRole("link", { name: "Work with SolanaLink" })).toHaveAttribute("href", "/go/contact");
  await expect(page.getByText(/Powered by/i)).toHaveCount(0);
  await expect(page.locator("img[src*='atlas' i], img[alt*='atlas' i]")).toHaveCount(0);

  const cta = await page.request.get("/go/contact", { maxRedirects: 0 });
  expect(cta.status()).toBe(302);
  expect(cta.headers().location).toBe("https://www.solanalink.jp/ja/contact-us/?from=kumihimo&utm_source=kumihimo&utm_medium=demo");

  await footer.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "プライバシーについて（Kumihimo デモ）" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy at Kumihimo (demo)" })).toBeVisible();
  // Demo data only (v0.4): nothing reaches our servers; served from this computer, so no hosting section.
  await expect(page.locator("section[lang=ja]")).toContainText("当社のサーバーには送信されません");
  await expect(page.locator("section[lang=ja]")).not.toContainText("運用環境");
  expect(offSite).toEqual([]);
});

test("CV-10: below 1024 px a notice points to the README and GIF; the page still works", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  const notice = page.getByRole("note");
  await expect(notice).toContainText("desktop Chrome or Edge");
  await expect(notice.getByRole("link", { name: "README" })).toBeVisible();
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole("note")).toHaveCount(0);
});
