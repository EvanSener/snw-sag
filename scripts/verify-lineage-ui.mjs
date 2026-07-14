import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";

const baseUrl = process.env.SAG_UI_URL ?? "http://127.0.0.1:4173";
const projectId = process.env.SAG_LINEAGE_PROJECT_ID ?? "e19603f8-5338-4e09-8845-d8c0d3f243b1";
const projectName = process.env.SAG_LINEAGE_PROJECT_NAME ?? "warehouse-sql-lineage-typed-v2-fast";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const desktopScreenshot = process.env.SAG_DESKTOP_SCREENSHOT ?? "/tmp/snw-sag-lineage-2d-desktop.png";
const desktopTraversalScreenshot = process.env.SAG_DESKTOP_TRAVERSAL_SCREENSHOT ?? "/tmp/snw-sag-lineage-2d-depth-desktop.png";
const mobileScreenshot = process.env.SAG_MOBILE_SCREENSHOT ?? "/tmp/snw-sag-lineage-2d-mobile.png";
const mobileTraversalScreenshot = process.env.SAG_MOBILE_TRAVERSAL_SCREENSHOT ?? "/tmp/snw-sag-lineage-2d-depth-mobile.png";
const mobileFiltersScreenshot = process.env.SAG_MOBILE_FILTERS_SCREENSHOT ?? "/tmp/snw-sag-lineage-2d-mobile-filters.png";

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1720, height: 960 },
  locale: "zh-CN",
  deviceScaleFactor: 1
});
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.stack ?? error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});

try {
  await page.addInitScript(() => localStorage.setItem("sag:language-preference:v1", "zh"));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await selectProject(page);
  await verifyDocumentFilters(page);
  await page.getByRole("button", { name: "图谱", exact: true }).click();

  const workbench = page.getByTestId("lineage-2d-workbench");
  const canvas = page.getByTestId("lineage-canvas");
  await workbench.waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("lineage-node-task").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_200);

  const workbenchBox = await workbench.boundingBox();
  const canvasBox = await canvas.boundingBox();
  assert.ok(workbenchBox && workbenchBox.width >= 900 && workbenchBox.height >= 500, "desktop workbench is too small");
  assert.ok(canvasBox && canvasBox.width >= 500 && canvasBox.height >= 500, "desktop graph canvas is too small");
  assert.ok(await page.locator(".react-flow__edge-path").count() > 0, "React Flow relations are missing");
  assert.ok(await page.locator("marker polyline").count() > 0, "directional arrow markers are missing");

  const dependencyGraph = await fetchSkeleton(page);
  const dependencyCount = dependencyGraph.edges.filter((edge) => edge.type === "DEPENDS_ON").length;
  assert.ok(dependencyCount > 0, "task-to-task dependencies are missing");

  const explorer = page.locator("aside:visible").filter({ hasText: "血缘视图" }).first();
  await explorer.waitFor({ state: "visible" });
  const taskTaskToggle = explorer.getByRole("button", { name: "显示任务 - 任务" });
  await taskTaskToggle.click();
  assert.equal(await taskTaskToggle.getAttribute("aria-pressed"), "false");
  await taskTaskToggle.click();
  assert.equal(await taskTaskToggle.getAttribute("aria-pressed"), "true");
  await explorer.getByRole("button", { name: "切换关系标签" }).click();
  await page.waitForTimeout(250);
  assert.ok(await page.locator(".react-flow__edge-text").count() > 0, "relation labels are missing");
  await explorer.getByRole("button", { name: "切换关系标签" }).click();

  await page.screenshot({ path: desktopScreenshot, fullPage: false });
  const desktopPixels = await inspectGraphPixels(page, canvas);
  assertGraphPixels(desktopPixels, "desktop");
  const traversal = await verifyTraversalHighlight(page, explorer, dependencyGraph.edges.length);
  await page.screenshot({ path: desktopTraversalScreenshot, fullPage: false });
  const groupedFieldCount = await verifyTableFieldRows(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "desktop has horizontal overflow");

  await page.getByRole("button", { name: "恢复任务骨架" }).click();
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.getByTestId("lineage-node-task").first().waitFor({ state: "visible" });
  await page.screenshot({ path: mobileScreenshot, fullPage: false });
  const mobilePixels = await inspectGraphPixels(page, canvas);
  assertGraphPixels(mobilePixels, "mobile");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile has horizontal overflow");
  await verifyMobileSelection(page);

  await page.getByRole("button", { name: "显示筛选" }).click();
  const mobileExplorer = page.locator("aside:visible").filter({ hasText: "血缘视图" });
  await mobileExplorer.waitFor({ state: "visible" });
  const filterBox = await mobileExplorer.boundingBox();
  assert.ok(filterBox && filterBox.x >= 0 && filterBox.x + filterBox.width <= 390, "mobile filter panel exceeds viewport");
  await page.screenshot({ path: mobileFiltersScreenshot, fullPage: false });

  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({
    projectId,
    dependencyCount,
    traversal,
    desktopPixels,
    mobilePixels,
    semanticNodes: {
      tasks: await page.getByTestId("lineage-node-task").count(),
      tables: await page.getByTestId("lineage-node-table").count(),
      groupedFields: groupedFieldCount
    },
    screenshots: [
      desktopScreenshot,
      desktopTraversalScreenshot,
      mobileScreenshot,
      mobileTraversalScreenshot,
      mobileFiltersScreenshot
    ]
  }, null, 2));
} finally {
  await browser.close();
}

async function selectProject(page) {
  const desktopProjectButton = page.getByRole("button").filter({ hasText: projectName }).first();
  if (await desktopProjectButton.isVisible()) {
    await desktopProjectButton.click();
  } else {
    await page.locator(`select:visible:has(option[value="${projectId}"])`).first().selectOption(projectId);
  }
  await page.waitForTimeout(700);
}

async function fetchSkeleton(page) {
  const response = await page.request.get(`${baseUrl}/api/projects/${projectId}/lineage-graph?limit=100`);
  assert.equal(response.ok(), true);
  return (await response.json()).graph;
}

async function verifyDocumentFilters(page) {
  await page.getByRole("button", { name: "文档", exact: true }).click();
  await page.getByRole("button", { name: "事件", exact: true }).click();
  await page.getByLabel("全部事件类型").selectOption("COLUMN_TO_COLUMN_LINEAGE");
  assert.ok(await page.getByText("字段到字段", { exact: true }).count() > 0, "event type badges are missing");

  await page.getByRole("button", { name: "实体", exact: true }).click();
  await page.getByLabel("全部实体类型").selectOption("column");
  assert.ok(await page.getByText("字段", { exact: true }).count() > 0, "entity type labels are missing");
}

async function verifyTraversalHighlight(page, explorer, initialEdgeCount) {
  await page.getByTestId("lineage-node-task").first().click();
  const counts = page.getByTestId("lineage-highlight-counts").filter({ visible: true });
  await counts.waitFor({ state: "visible", timeout: 12_000 });
  const direct = await waitForHighlightCounts(counts, (value) => value.edgeCount > 0);
  assert.ok(direct.edgeCount < initialEdgeCount, "one-hop selection did not narrow graph relations");

  await explorer.getByRole("button", { name: "2", exact: true }).click();
  const indirect = await waitForHighlightCounts(counts, (value) => (
    value.nodeCount > direct.nodeCount || value.edgeCount > direct.edgeCount
  ));
  assert.ok(indirect.nodeCount >= direct.nodeCount, "two-hop traversal lost related nodes");
  assert.ok(indirect.edgeCount >= direct.edgeCount, "two-hop traversal lost related relations");
  return { direct, indirect };
}

async function verifyTableFieldRows(page) {
  const table = page.getByTestId("lineage-node-table").first();
  await table.waitFor({ state: "visible", timeout: 12_000 });
  await table.click();
  const fieldRows = page.getByTestId("lineage-field-row");
  await fieldRows.first().waitFor({ state: "visible", timeout: 12_000 });
  const count = await fieldRows.count();
  assert.ok(count > 0, "table fields were not grouped into table cards");
  return count;
}

async function verifyMobileSelection(page) {
  await page.getByTestId("lineage-node-task").first().click();
  const panel = page.locator('[data-testid="lineage-selected-node-panel"]:visible');
  await panel.waitFor({ state: "visible", timeout: 12_000 });
  const box = await panel.boundingBox();
  assert.ok(
    box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844,
    "mobile lineage inspector exceeds viewport"
  );
  await page.screenshot({ path: mobileTraversalScreenshot, fullPage: false });
  await panel.getByRole("button", { name: "清除选择" }).click();
  await panel.waitFor({ state: "hidden" });
}

async function waitForHighlightCounts(locator, predicate) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const counts = await locator.evaluate((element) => ({
      nodeCount: Number(element.dataset.nodeCount ?? 0),
      edgeCount: Number(element.dataset.edgeCount ?? 0)
    }));
    if (predicate(counts)) return counts;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("lineage highlight counts did not reach the expected state");
}

async function inspectGraphPixels(page, canvas) {
  const screenshot = await page.screenshot({ fullPage: false });
  const png = PNG.sync.read(screenshot);
  const box = await canvas.boundingBox();
  assert.ok(box, "graph canvas bounding box is missing");
  const bounds = {
    left: Math.max(0, Math.floor(box.x)),
    top: Math.max(0, Math.floor(box.y)),
    right: Math.min(png.width, Math.ceil(box.x + box.width)),
    bottom: Math.min(png.height, Math.ceil(box.y + box.height))
  };
  const colors = {
    task: [180, 83, 9],
    table: [3, 105, 161],
    column: [21, 128, 61],
    taskRelation: [190, 24, 93],
    taskTableRelation: [194, 65, 12]
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
        if (nearColor(pixel, color, 45)) counts[key] += 1;
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
  assert.ok(pixels.nonBackground > 1_000, `${viewport} graph appears blank`);
  assert.ok(pixels.whiteBackgroundRatio > 0.45, `${viewport} graph background is not white`);
  assert.ok(pixels.task > 10, `${viewport} task nodes are not visible`);
  assert.ok(pixels.table > 10, `${viewport} table nodes are not visible`);
  assert.ok(pixels.taskRelation + pixels.taskTableRelation > 10, `${viewport} graph relations are not visible`);
}

function nearColor(pixel, target, tolerance) {
  return Math.abs(pixel[0] - target[0]) <= tolerance
    && Math.abs(pixel[1] - target[1]) <= tolerance
    && Math.abs(pixel[2] - target[2]) <= tolerance;
}
