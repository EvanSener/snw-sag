import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const baseUrl = process.env.SAG_UI_URL ?? "http://127.0.0.1:4173";
const projectId = process.env.SAG_LINEAGE_PROJECT_ID ?? "e19603f8-5338-4e09-8845-d8c0d3f243b1";
const projectName = process.env.SAG_LINEAGE_PROJECT_NAME ?? "warehouse-sql-lineage-typed-v2-fast";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const desktopScreenshot = process.env.SAG_DESKTOP_SCREENSHOT ?? "/tmp/snw-sag-lineage-3d-desktop.png";
const mobileScreenshot = process.env.SAG_MOBILE_SCREENSHOT ?? "/tmp/snw-sag-lineage-3d-mobile.png";
const mobileFiltersScreenshot = process.env.SAG_MOBILE_FILTERS_SCREENSHOT ?? "/tmp/snw-sag-lineage-3d-mobile-filters.png";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"]
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  deviceScaleFactor: 1
});
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});

try {
  await page.addInitScript(() => localStorage.setItem("sag:language-preference:v1", "zh"));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const desktopProjectButton = page.getByRole("button").filter({ hasText: projectName }).first();
  if (await desktopProjectButton.isVisible()) {
    await desktopProjectButton.click();
  } else {
    await page.locator(`select:visible:has(option[value="${projectId}"])`).first().selectOption(projectId);
  }
  await page.waitForTimeout(700);

  await verifyDocumentFilters(page);
  await page.getByRole("button", { name: "图谱", exact: true }).click();
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(3_000);

  const webgl = await inspectWebGlCanvas(page);
  assert.ok(webgl.width >= 900 && webgl.height >= 500, `unexpected desktop canvas size ${webgl.width}x${webgl.height}`);
  assert.ok(webgl.renderer, "WebGL renderer is missing");

  const taskTaskSwitch = page.getByRole("switch", { name: "显示任务 - 任务关系" });
  await page.getByRole("button", { name: "显示筛选" }).click();
  await taskTaskSwitch.click();
  assert.equal(await taskTaskSwitch.getAttribute("aria-checked"), "false");
  await taskTaskSwitch.click();
  assert.equal(await taskTaskSwitch.getAttribute("aria-checked"), "true");
  await page.getByRole("button", { name: "切换关系标签" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "切换关系标签" }).click();
  await page.getByRole("button", { name: "显示筛选" }).click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: desktopScreenshot, fullPage: false });
  const desktopPixels = await inspectGraphPixels(page, canvas);
  assertGraphPixels(desktopPixels, "desktop");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "desktop has horizontal overflow");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: mobileScreenshot, fullPage: false });
  const mobilePixels = await inspectGraphPixels(page, canvas);
  assertGraphPixels(mobilePixels, "mobile");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile has horizontal overflow");

  await page.getByRole("button", { name: "显示筛选" }).click();
  const filterPanel = page.locator("aside").filter({ hasText: "图谱显示" });
  await filterPanel.waitFor({ state: "visible" });
  const filterBox = await filterPanel.boundingBox();
  assert.ok(filterBox && filterBox.x >= 0 && filterBox.x + filterBox.width <= 390, "mobile filter panel exceeds viewport");
  await page.screenshot({ path: mobileFiltersScreenshot, fullPage: false });

  const dependencyResponse = await page.request.get(`${baseUrl}/api/projects/${projectId}/lineage-graph?limit=100`);
  assert.equal(dependencyResponse.ok(), true);
  const dependencyGraph = (await dependencyResponse.json()).graph;
  const dependencyCount = dependencyGraph.edges.filter((edge) => edge.type === "DEPENDS_ON").length;
  assert.ok(dependencyCount > 0, "task-to-task dependencies are missing");

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({
    projectId,
    webgl,
    dependencyCount,
    desktopPixels,
    mobilePixels,
    screenshots: [desktopScreenshot, mobileScreenshot, mobileFiltersScreenshot]
  }, null, 2));
} finally {
  await browser.close();
}

async function verifyDocumentFilters(page) {
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await page.getByRole("button", { name: "事件", exact: true }).click();
  const eventTypeSelect = page.getByLabel("全部事件类型");
  await eventTypeSelect.selectOption("COLUMN_TO_COLUMN_LINEAGE");
  await page.waitForTimeout(100);
  assert.ok(await page.getByText("字段到字段", { exact: true }).count() > 0, "event type badges are missing");

  await page.getByRole("button", { name: "实体", exact: true }).click();
  const entityTypeSelect = page.getByLabel("全部实体类型");
  await entityTypeSelect.selectOption("column");
  await page.waitForTimeout(100);
  assert.ok(await page.getByText("字段", { exact: true }).count() > 0, "entity type labels are missing");
}

async function inspectWebGlCanvas(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort((left, right) => right.width * right.height - left.width * left.height)[0];
    if (!canvas) return { width: 0, height: 0, renderer: "" };
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      renderer: context ? String(context.getParameter(context.RENDERER)) : ""
    };
  });
}

async function inspectGraphPixels(page, canvas) {
  const screenshot = await page.screenshot({ fullPage: false });
  const png = PNG.sync.read(screenshot);
  const box = await canvas.boundingBox();
  assert.ok(box, "canvas bounding box is missing");
  const bounds = {
    left: Math.max(0, Math.floor(box.x)),
    top: Math.max(0, Math.floor(box.y)),
    right: Math.min(png.width, Math.ceil(box.x + box.width)),
    bottom: Math.min(png.height, Math.ceil(box.y + box.height))
  };
  const colors = {
    task: [217, 119, 6],
    table: [2, 132, 199],
    column: [22, 163, 74],
    taskRelation: [219, 39, 119],
    taskTableRelation: [234, 88, 12]
  };
  const counts = Object.fromEntries(Object.keys(colors).map((key) => [key, 0]));
  let nonBackground = 0;
  let whiteBackground = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * png.width + x) * 4;
      const pixel = [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
      if (Math.abs(pixel[0] - 255) + Math.abs(pixel[1] - 255) + Math.abs(pixel[2] - 255) > 45) nonBackground += 1;
      if (nearColor(pixel, [255, 255, 255], 10)) whiteBackground += 1;
      for (const [key, color] of Object.entries(colors)) {
        if (nearColor(pixel, color, 52)) counts[key] += 1;
      }
    }
  }
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return {
    ...counts,
    nonBackground,
    whiteBackgroundRatio: Number((whiteBackground / (width * height)).toFixed(4)),
    width,
    height
  };
}

function assertGraphPixels(pixels, viewport) {
  assert.ok(pixels.nonBackground > 1_000, `${viewport} canvas appears blank`);
  assert.ok(pixels.whiteBackgroundRatio > 0.55, `${viewport} canvas background is not white`);
  assert.ok(pixels.task > 10, `${viewport} task nodes are not visible`);
  assert.ok(pixels.table > 10, `${viewport} table nodes are not visible`);
  assert.ok(pixels.taskRelation + pixels.taskTableRelation > 10, `${viewport} graph relations are not visible`);
}

function nearColor(pixel, target, tolerance) {
  return Math.abs(pixel[0] - target[0]) <= tolerance
    && Math.abs(pixel[1] - target[1]) <= tolerance
    && Math.abs(pixel[2] - target[2]) <= tolerance;
}
